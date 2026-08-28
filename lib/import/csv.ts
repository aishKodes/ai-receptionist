import { getDatabase, makeId, nowIso } from "@/db";
import { addAudit } from "@/lib/services/repository";
import { normalizeIndianPhone } from "@/lib/channels/pipeline";

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export type DuplicateMode = "skip" | "update" | "merge";
export type CsvMapping = Partial<Record<"name" | "phone" | "treatment" | "concern" | "date" | "status" | "notes" | "source" | "consent", string>>;

const aliases: Record<keyof CsvMapping, string[]> = {
  name: ["name", "patient name", "full name"], phone: ["mobile", "phone", "whatsapp", "number", "mobile number"],
  treatment: ["treatment", "service"], concern: ["concern", "problem"], date: ["date", "last contacted", "last contact"],
  status: ["status", "stage"], notes: ["notes", "remarks"], source: ["source", "lead source"], consent: ["opt in", "opt-in", "consent", "whatsapp consent"],
};

export function escapeSpreadsheetFormula(value: string) {
  const trimmed = value.trimStart();
  return /^[=+\-@]/.test(trimmed) ? `'${value}` : value;
}

export function parseCsv(text: string) {
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) throw new Error("CSV exceeds the 2 MB limit.");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
  if (!rows.length) throw new Error("CSV is empty.");
  const headers = rows[0].map((value) => value.replace(/^\uFEFF/, "").trim());
  if (!headers.some(Boolean)) throw new Error("CSV must have a header row.");
  return { headers, rows: rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, escapeSpreadsheetFormula((values[index] || "").trim())]))) };
}

export function detectCsvMapping(headers: string[]): CsvMapping {
  const normalized = headers.map((header) => [header, header.toLowerCase().trim()] as const);
  return Object.fromEntries(Object.entries(aliases).map(([field, options]) => [field, normalized.find(([, value]) => options.includes(value))?.[0]]).filter(([, value]) => value)) as CsvMapping;
}

function treatmentSlug(value: string) {
  const text = value.toLowerCase();
  if (/hair transplant/.test(text)) return "hair_transplant";
  if (/hair (fall|loss|thin)/.test(text)) return "hair_loss";
  if (/acne scar/.test(text)) return "acne_scars";
  if (/acne|pimple/.test(text)) return "acne";
  if (/melasma/.test(text)) return "melasma";
  if (/pigment|dark spot/.test(text)) return "pigmentation";
  if (/\bprp\b/.test(text)) return "prp";
  if (/\bgfc\b/.test(text)) return "gfc";
  if (/laser/.test(text)) return "laser";
  return null;
}

function explicitConsent(value: string) {
  return /^(yes|y|true|1|confirmed|consented|opted in)$/i.test(value.trim()) ? "CONFIRMED" : /^(no|n|false|0|revoked|opted out)$/i.test(value.trim()) ? "REVOKED" : "UNKNOWN";
}

export function validateCsvRows(text: string, mapping?: CsvMapping) {
  const parsed = parseCsv(text);
  const resolved = { ...detectCsvMapping(parsed.headers), ...mapping };
  if (!resolved.phone) throw new Error("Map a phone, mobile, or WhatsApp column.");
  const seen = new Set<string>();
  const rows = parsed.rows.map((source, index) => {
    const phone = normalizeIndianPhone(source[resolved.phone!] || "");
    const duplicateInFile = phone ? seen.has(phone) : false;
    if (phone) seen.add(phone);
    const rawConcern = source[resolved.concern || ""] || source[resolved.treatment || ""] || "";
    const consent = explicitConsent(source[resolved.consent || ""] || "");
    const formulaFields = Object.values(source).filter((value) => value.startsWith("'")).length;
    return {
      row: index + 2, name: (source[resolved.name || ""] || "Imported Patient").slice(0, 120), phone,
      treatmentSlug: treatmentSlug(`${source[resolved.treatment || ""] || ""} ${rawConcern}`), concern: rawConcern.slice(0, 300),
      source: (source[resolved.source || ""] || "csv_import").slice(0, 80), notes: (source[resolved.notes || ""] || "").slice(0, 1000),
      consent, duplicateInFile, formulaFields, valid: Boolean(phone) && !duplicateInFile,
      issues: [...(!phone ? ["INVALID_PHONE"] : []), ...(duplicateInFile ? ["DUPLICATE_IN_FILE"] : []), ...(formulaFields ? ["FORMULA_ESCAPED"] : [])],
    };
  });
  return { headers: parsed.headers, mapping: resolved, rows, summary: { total: rows.length, valid: rows.filter((row) => row.valid).length, invalid: rows.filter((row) => !row.valid).length, duplicates: rows.filter((row) => row.duplicateInFile).length, consentUnknown: rows.filter((row) => row.consent === "UNKNOWN").length } };
}

export function importCsvLeads(fileName: string, text: string, mapping?: CsvMapping, duplicateMode: DuplicateMode = "skip") {
  const validated = validateCsvRows(text, mapping);
  const db = getDatabase();
  const importId = makeId("import");
  const now = nowIso();
  let imported = 0, skipped = 0, errors = 0;
  const rowErrors: Array<{ row: number; reason: string }> = [];
  db.prepare("INSERT INTO lead_imports (id,file_name,status,total_rows,created_at) VALUES (?,?,?, ?,?)").run(importId, fileName.slice(0, 200), "PROCESSING", validated.rows.length, now);
  const tx = db.transaction(() => {
    for (const row of validated.rows) {
      if (!row.valid || !row.phone) { errors += 1; rowErrors.push({ row: row.row, reason: row.issues.join(", ") }); continue; }
      const existing = db.prepare("SELECT id,name,primary_concern AS concern,treatment_slug AS treatmentSlug FROM patients WHERE phone=? LIMIT 1").get(row.phone) as { id: string; name: string; concern: string | null; treatmentSlug: string | null } | undefined;
      if (existing) {
        if (duplicateMode === "skip") { skipped += 1; continue; }
        if (duplicateMode === "merge") {
          db.prepare("UPDATE patients SET name=CASE WHEN name LIKE 'Imported Patient%' THEN ? ELSE name END,name_source=CASE WHEN name LIKE 'Imported Patient%' THEN 'csv_import' ELSE name_source END,name_verified=CASE WHEN name LIKE 'Imported Patient%' THEN 1 ELSE name_verified END,primary_concern=COALESCE(primary_concern,?),treatment_slug=COALESCE(treatment_slug,?),whatsapp_opt_in_status=CASE WHEN whatsapp_opt_in_status='UNKNOWN' THEN ? ELSE whatsapp_opt_in_status END,updated_at=? WHERE id=?").run(row.name, row.concern || null, row.treatmentSlug, row.consent, now, existing.id);
        } else {
          db.prepare("UPDATE patients SET name=?,name_source='csv_import',name_verified=1,primary_concern=?,treatment_slug=COALESCE(?,treatment_slug),source=?,whatsapp_opt_in_status=?,whatsapp_opt_in_date=CASE WHEN ?='CONFIRMED' THEN COALESCE(whatsapp_opt_in_date,?) ELSE whatsapp_opt_in_date END,whatsapp_opt_in_source=CASE WHEN ?='CONFIRMED' THEN 'csv_import' ELSE whatsapp_opt_in_source END,do_not_contact=CASE WHEN ?='REVOKED' THEN 1 ELSE do_not_contact END,updated_at=? WHERE id=?").run(row.name, row.concern || null, row.treatmentSlug, row.source, row.consent, row.consent, now, row.consent, row.consent, now, existing.id);
        }
        imported += 1;
        continue;
      }
      const patientId = makeId("pat"), conversationId = makeId("con");
      db.prepare("INSERT INTO patients (id,name,name_source,name_verified,phone,primary_concern,treatment_slug,lead_score,lead_temperature,lead_stage,source,ai_summary,assigned_to,ai_enabled,whatsapp_opt_in_status,whatsapp_opt_in_date,whatsapp_opt_in_source,do_not_contact,created_at,updated_at) VALUES (?,?,'csv_import',1,?,?,?,10,'COLD','new',?,?,'AI Reception',1,?,?,?,?,?,?)").run(patientId, row.name, row.phone, row.concern || null, row.treatmentSlug, row.source, row.notes || "Imported lead; conversation has not started.", row.consent, row.consent === "CONFIRMED" ? now : null, row.consent === "CONFIRMED" ? "csv_import" : null, row.consent === "REVOKED" ? 1 : 0, now, now);
      db.prepare("INSERT INTO conversations (id,patient_id,channel,status,unread_count,ai_enabled,last_message_at,created_at) VALUES (?,?,'whatsapp','open',0,1,?,?)").run(conversationId, patientId, now, now);
      db.prepare("INSERT INTO conversation_state (conversation_id,offered_slots_json,sent_content_ids_json,created_at,updated_at) VALUES (?,'[]','[]',?,?)").run(conversationId, now, now);
      imported += 1;
    }
    db.prepare("UPDATE lead_imports SET status='COMPLETED',imported_rows=?,skipped_rows=?,error_rows=?,errors_json=?,completed_at=? WHERE id=?").run(imported, skipped, errors, JSON.stringify(rowErrors.slice(0, 100)), nowIso(), importId);
  });
  tx();
  addAudit("CSV_IMPORTED", "lead_import", importId, `${imported} leads imported; ${skipped} skipped; ${errors} invalid`, "ADMIN", { fileName: fileName.slice(0, 200) });
  return { importId, imported, skipped, errors, rowErrors, summary: validated.summary };
}
