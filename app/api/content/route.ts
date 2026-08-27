import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSqlite, makeId, nowIso } from "@/db";

const ContentSchema = z.object({ id: z.string().optional(), type: z.enum(["youtube", "website", "before_after", "faq"]), title: z.string().min(2), description: z.string().min(2), url: z.string().url(), treatmentSlug: z.string().nullable().optional(), tags: z.array(z.string()).default([]), whenToSend: z.string().min(2), priority: z.number().int().min(1).max(20).default(5), active: z.boolean().default(true) });

export async function POST(request: NextRequest) {
  try {
    const item = ContentSchema.parse(await request.json());
    const id = item.id || makeId("cnt");
    getSqlite().prepare("INSERT OR REPLACE INTO content_items (id,type,title,description,url,thumbnail_url,treatment_slug,tags_json,when_to_send,priority,active,created_at) VALUES (?,?,?,?,?,NULL,?,?,?,?,?,COALESCE((SELECT created_at FROM content_items WHERE id=?),?))").run(id, item.type, item.title, item.description, item.url, item.treatmentSlug ?? null, JSON.stringify(item.tags), item.whenToSend, item.priority, Number(item.active), id, nowIso());
    return NextResponse.json({ ok: true, id });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid content" }, { status: 400 }); }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  getSqlite().prepare("UPDATE content_items SET active=0 WHERE id=?").run(id);
  return NextResponse.json({ ok: true });
}
