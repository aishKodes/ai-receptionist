import type { NextRequest } from "next/server";

const buckets = new Map<string, { count: number; resetAt: number }>();

export function enforceRateLimit(request: NextRequest, scope: string, limit = 60, windowMs = 60_000) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${scope}:${address}`;
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return; }
  current.count += 1;
  if (current.count > limit) throw new Error("Too many requests. Please wait a moment.");
}

export function enforceSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  // Managed hosts commonly terminate TLS before forwarding to Next.js. In
  // that setup request.nextUrl.origin can be the internal HTTP origin even
  // though a legitimate browser request originated from the public HTTPS
  // application URL. APP_URL is the explicit, deployment-controlled public
  // origin, so accept it alongside Next's observed origin.
  const allowedOrigins = new Set([request.nextUrl.origin]);
  if (process.env.APP_URL) {
    try { allowedOrigins.add(new URL(process.env.APP_URL).origin); } catch { /* ignore malformed optional configuration */ }
  }
  if (!allowedOrigins.has(origin)) throw new Error("Request origin was not accepted.");
}
