"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, LoaderCircle, Settings2 } from "lucide-react";
import { AppShell, PageLoader } from "@/components/app-shell";

type Check = { label: string; status: "CONFIGURED" | "MISSING" | "INVALID" | "UNVERIFIED"; detail?: string };
type Readiness = { status: "PRODUCTION READY" | "BLOCKED"; sections: Array<{ title: string; checks: Check[] }>; blockers: string[] };

export function ProductionReadinessPage() {
  const [data, setData] = useState<Readiness | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { const response = await fetch("/api/settings/readiness", { cache: "no-store" }); setData(await response.json()); } finally { setLoading(false); } };
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, []);
  if (!data) return <AppShell title="Production readiness"><PageLoader/></AppShell>;
  const ready = data.status === "PRODUCTION READY";
  return <AppShell eyebrow="Deployment gate" title="Production readiness" action={<button className="secondary-button" onClick={() => void load()} disabled={loading}>{loading ? <LoaderCircle className="spin"/> : <Settings2 size={16}/>}Refresh checks</button>}>
    <div className="page-content">
      <section className={`surface ${ready ? "safe-note" : "readiness-blocked"}`}><div className="section-head"><div><span className="eyebrow">{ready ? "ALL REQUIRED CHECKS PASSED" : "DO NOT DEPLOY YET"}</span><h2>{data.status}</h2><p>{ready ? "The configured production checks are complete. Complete the controlled WhatsApp acceptance test before enabling automatic outreach." : "Only the unresolved, evidence-based items below block deployment. Secret values are never displayed."}</p></div>{ready ? <CheckCircle2 size={32}/> : <CircleAlert size={32}/>}</div>{!ready && <ul>{data.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}</section>
      <div className="readiness-grid">{data.sections.map((section) => <section className="surface readiness-card" key={section.title}><h2>{section.title}</h2>{section.checks.map((check) => <div className="readiness-row" key={check.label}><div><strong>{check.label}</strong>{check.detail && <span>{check.detail}</span>}</div><em className={`readiness-${check.status.toLowerCase()}`}>{check.status}</em></div>)}</section>)}</div>
      <div className="campaign-actions"><Link className="secondary-button" href="/settings/appointments">Configure appointment calendar</Link><Link className="secondary-button" href="/settings/meta">Open Meta diagnostics</Link></div>
    </div>
  </AppShell>;
}
