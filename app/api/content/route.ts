import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase, makeId, nowIso } from "@/db";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const ContentSchema = z.object({ id: z.string().optional(), type: z.enum(["youtube", "website", "before_after", "faq", "instruction"]), title: z.string().min(2), description: z.string().min(2), url: z.string().url(), treatmentSlug: z.string().nullable().optional(), tags: z.array(z.string()).default([]), whenToSend: z.string().min(2), priority: z.number().int().min(1).max(20).default(5), active: z.boolean().default(true), approvedForAi: z.boolean().default(true), approvedForProduction: z.boolean().default(false) });

function approvedUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || /(?:example\.com|localhost|placeholder|\/demo(?:\/|$))/i.test(value)) return false;
  if (url.hostname === "radianceclinics.com" || url.hostname.endsWith(".radianceclinics.com")) return true;
  if (url.hostname === "www.youtube.com" && url.pathname.replace(/\/$/, "") === "/@RadianceClinics") return true;
  if (url.hostname === "www.youtube.com" && url.pathname === "/watch" && url.searchParams.get("v") === "8qYMw935MF8") return true;
  return url.hostname === "youtu.be" && url.pathname.replace(/^\//, "") === "8qYMw935MF8";
}

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request); enforceRateLimit(request, "content", 30);
    const item = ContentSchema.parse(await request.json());
    if (item.approvedForProduction && !approvedUrl(item.url)) throw new Error("Production-approved content must use an approved Radiance Clinics URL.");
    const id = item.id || makeId("cnt");
    const db = getDatabase();
    const existing = db.prepare("SELECT created_at AS createdAt FROM content_items WHERE id=?").get(id) as { createdAt?: string } | undefined;
    db.prepare("INSERT OR REPLACE INTO content_items (id,type,title,description,url,thumbnail_url,treatment_slug,tags_json,when_to_send,priority,active,approved_for_ai,approved_for_production,created_at) VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?,?,?)").run(id, item.type, item.title, item.description, item.url, item.treatmentSlug ?? null, JSON.stringify(item.tags), item.whenToSend, item.priority, Number(item.active), Number(item.approvedForAi), Number(item.approvedForProduction), existing?.createdAt || nowIso());
    return NextResponse.json({ ok: true, id });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid content" }, { status: 400 }); }
}

export async function DELETE(request: NextRequest) {
  try { enforceSameOrigin(request); enforceRateLimit(request, "content", 30); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Request rejected" }, { status: 400 }); }
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  getDatabase().prepare("UPDATE content_items SET active=0 WHERE id=?").run(id);
  return NextResponse.json({ ok: true });
}
