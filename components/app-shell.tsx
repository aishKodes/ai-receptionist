"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, ChevronRight, Inbox, Library, LogOut, Megaphone, PhoneCall, Settings, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

const nav = [
  ["/inbox", "Inbox", Inbox], ["/leads", "Leads", Users], ["/human", "Attention", PhoneCall], ["/appointments", "Appointments", CalendarDays],
  ["/outreach", "Outreach", Megaphone], ["/content", "Content", Library], ["/analytics", "Analytics", BarChart3], ["/settings", "Settings", Settings],
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
        <div className="system-status"><span className="pulse-dot"/><div><strong>Clinic systems</strong><small>Production operations</small></div></div>
        <form action="/api/auth/logout" method="post"><button className="nav-logout" type="submit"><LogOut size={14}/>Logout</button></form>
      </div>
    </aside>
    <main className="app-main">
      {(title || eyebrow || action) && <header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1></div>{action}</header>}
      {children}
    </main>
    <Toaster richColors position="top-right" closeButton />
  </div>;
}

export function PageLoader() {
  return <div className="page-loader"><div className="skeleton-card wide"/><div className="skeleton-grid"><div className="skeleton-card"/><div className="skeleton-card"/><div className="skeleton-card"/></div><div className="skeleton-table"/></div>;
}
