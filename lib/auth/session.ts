export const SESSION_COOKIE = "radiance_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

type SessionPayload = { role: "admin"; issuedAt: number; expiresAt: number; nonce: string };
const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export function sessionConfigurationReady() {
  return Boolean(process.env.ADMIN_PIN_HASH && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32);
}

export async function createSessionToken(secret = process.env.SESSION_SECRET || "") {
  if (secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { role: "admin", issuedAt: now, expiresAt: now + SESSION_TTL_SECONDS, nonce: crypto.randomUUID() };
  const encoded = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(encoded)));
  return `${encoded}.${base64UrlEncode(signature)}`;
}

export async function verifySessionToken(token: string | undefined | null, secret = process.env.SESSION_SECRET || "") {
  if (!token || secret.length < 32) return false;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;
  try {
    const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), base64UrlDecode(signature), encoder.encode(encoded));
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as SessionPayload;
    return payload.role === "admin" && Number.isFinite(payload.expiresAt) && payload.expiresAt > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
