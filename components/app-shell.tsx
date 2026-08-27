"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Bot, CalendarDays, ChevronRight, FlaskConical, Inbox, Library, Settings, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

const nav = [
  ["/inbox", "Inbox", Inbox], ["/leads", "Leads", Users], ["/appointments", "Appointments", CalendarDays],
  ["/automations", "Automations", Activity], ["/content", "Content", Library], ["/analytics", "Analytics", BarChart3],
  ["/demo/control", "Demo Control", FlaskConical], ["/settings", "Settings", Settings],
] as const;

export function AppShell({ children, title, eyebrow, action }: { children: ReactNode; title?: string; eyebrow?: string; action?: ReactNode }) {
  const pathname = usePathname();
  return <div className="app-shell">
    <aside className="side-nav">
      <div className="brand-lockup"><div className="brand-mark"><Sparkles size={19} /></div><div><strong>Radiance AI</strong><span>Reception</span></div></div>
      <nav aria-label="Main navigation">{nav.map(([href, label, Icon]) => {
        const active = pathname === href || (href !== "/inbox" && pathname.startsWith(`${href}/`));
        return <Link className={`nav-link ${active ? "active" : ""}`} href={href} key={href}><Icon size={18} strokeWidth={1.9}/><span>{label}</span>{active && <ChevronRight className="nav-chevron" size={14}/>}</Link>;
      })}</nav>
      <div className="nav-bottom">
        <div className="system-status"><span className="pulse-dot"/><div><strong>AI Online</strong><small>Local systems healthy</small></div></div>
        <div className="demo-pill"><Bot size={14}/>Demo Mode</div>
      </div>
    </aside>
    <main className="app-main">
      {pathname !== "/inbox" && <div className="demo-banner"><FlaskConical size={14}/><strong>DEMO MODE</strong><span>Follow-up timings are compressed for presentation.</span></div>}
      {(title || eyebrow || action) && <header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1></div>{action}</header>}
      {children}
    </main>
    <Toaster richColors position="top-right" closeButton />
  </div>;
}

export function PageLoader() {
  return <div className="page-loader"><div className="skeleton-card wide"/><div className="skeleton-grid"><div className="skeleton-card"/><div className="skeleton-card"/><div className="skeleton-card"/></div><div className="skeleton-table"/></div>;
}
