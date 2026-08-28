type Attempt = { failures: number; lockedUntil: number; resetAt: number };
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

export function loginAddress(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "local";
}

export function loginAllowed(address: string) {
  const now = Date.now();
  const attempt = attempts.get(address);
  if (!attempt || attempt.resetAt <= now) { attempts.delete(address); return true; }
  return attempt.lockedUntil <= now;
}

export function recordLoginFailure(address: string) {
  const now = Date.now();
  const current = attempts.get(address);
  const next = !current || current.resetAt <= now ? { failures: 1, resetAt: now + WINDOW_MS, lockedUntil: 0 } : { ...current, failures: current.failures + 1 };
  if (next.failures >= MAX_FAILURES) next.lockedUntil = now + LOCK_MS;
  attempts.set(address, next);
}

export function clearLoginFailures(address: string) { attempts.delete(address); }
