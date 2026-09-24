import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clearLoginFailures, loginAddress, loginAllowed, recordLoginFailure } from "@/lib/auth/login-rate-limit";
import { createSessionToken, SESSION_COOKIE, SESSION_TTL_SECONDS, sessionConfigurationReady } from "@/lib/auth/session";
import { enforceSameOrigin } from "@/lib/security/http";

const Schema = z.object({ pin: z.string().regex(/^\d{6,8}$/) });
const genericError = "The PIN could not be accepted. Please wait and try again.";

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request);
    if (!sessionConfigurationReady()) return NextResponse.json({ error: "Clinic login is not configured." }, { status: 503 });
    const address = loginAddress(request.headers);
    if (!loginAllowed(address)) return NextResponse.json({ error: genericError }, { status: 429 });
    const parsed = Schema.safeParse(await request.json().catch(() => ({})));
    const accepted = parsed.success && await bcrypt.compare(parsed.data.pin, process.env.ADMIN_PIN_HASH || "");
    if (!accepted) {
      recordLoginFailure(address);
      await new Promise((resolve) => setTimeout(resolve, 250));
      return NextResponse.json({ error: genericError }, { status: 401 });
    }
    clearLoginFailures(address);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, await createSessionToken(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS });
    return response;
  } catch { return NextResponse.json({ error: genericError }, { status: 400 }); }
}
