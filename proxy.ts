import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

const publicPaths = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/api/whatsapp/webhook", "/api/health", "/api/internal/process-jobs"]);

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (publicPaths.has(path)) return NextResponse.next();
  const valid = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (valid) return NextResponse.next();
  if (path.startsWith("/api/")) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const login = new URL("/login", request.url);
  login.searchParams.set("returnTo", `${path}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|radiance-logo-mark.png|apple-touch-icon.png|site.webmanifest|og.png).*)"] };
