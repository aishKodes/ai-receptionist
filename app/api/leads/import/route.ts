import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase } from "@/db";
import { importCsvLeads, validateCsvRows } from "@/lib/import/csv";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const Schema = z.object({ action: z.enum(["preview", "import"]), fileName: z.string().max(200).default("leads.csv"), csv: z.string().max(2_100_000), mapping: z.record(z.string(), z.string()).optional(), duplicateMode: z.enum(["skip", "update", "merge"]).default("skip") });

export function GET() {
  const history = getDatabase().prepare("SELECT id,file_name AS fileName,status,total_rows AS totalRows,imported_rows AS importedRows,skipped_rows AS skippedRows,error_rows AS errorRows,created_at AS createdAt,completed_at AS completedAt FROM lead_imports ORDER BY created_at DESC LIMIT 20").all();
  return NextResponse.json({ history });
}

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "csv-import", 12);
    const input = Schema.parse(await request.json());
    const mapping = input.mapping as Parameters<typeof validateCsvRows>[1];
    return NextResponse.json(input.action === "preview" ? validateCsvRows(input.csv, mapping) : importCsvLeads(input.fileName, input.csv, mapping, input.duplicateMode));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CSV could not be processed" }, { status: 400 });
  }
}
