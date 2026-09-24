"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";

export function LoginForm() {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) window.location.assign("/inbox");
    else { setError(body.error || "The PIN could not be accepted."); setPin(""); setBusy(false); }
  }
  return <form className="login-card" onSubmit={submit}>
    <div className="login-mark"><LockKeyhole size={23}/></div>
    <div><span className="eyebrow">Radiance Clinics · Bhubaneswar</span><h1>Radiance AI Reception</h1></div>
    <label><span>Enter PIN</span><input autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,8}" minLength={6} maxLength={8} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••••" aria-label="Enter PIN"/></label>
    {error && <p className="login-error" role="alert">{error}</p>}
    <button className="primary-button full" disabled={busy || pin.length !== 8}>{busy ? <LoaderCircle className="spin"/> : <LockKeyhole size={17}/>}Unlock</button>
  </form>;
}
