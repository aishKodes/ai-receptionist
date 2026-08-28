"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, Bot, CalendarPlus, CircleAlert, FileText, Flame, Info, MoreHorizontal, Search, Sparkles, UserRound, Video } from "lucide-react";
import { AppShell, PageLoader } from "@/components/app-shell";
import { Avatar, dateTime, MessageBubble, relativeDate, StatusBadge, titleCase } from "@/components/shared";
import { useRadianceState } from "@/components/use-radiance-state";

const filters = ["All", "Unread", "Hot Leads", "AI Active", "Human"] as const;

export function InboxView({ initialPatientId = "" }: { initialPatientId?: string }) {
  const [patientId, setPatientId] = useState(initialPatientId);
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [search, setSearch] = useState("");
  const { data, error } = useRadianceState(patientId);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const messageCount = data?.selected?.messages.length || 0;
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messageCount, patientId]);
  const patients = useMemo(() => (data?.patients || []).filter((patient) => {
    const term = search.toLowerCase();
    const matchSearch = !term || `${patient.name} ${patient.lastMessage || ""} ${patient.treatmentSlug || ""}`.toLowerCase().includes(term);
    const matchFilter = filter === "All" || (filter === "Unread" && patient.unreadCount > 0) || (filter === "Hot Leads" && patient.leadTemperature === "HOT") || (filter === "AI Active" && Boolean(patient.aiEnabled)) || (filter === "Human" && !patient.aiEnabled);
    return matchSearch && matchFilter;
  }), [data?.patients, filter, search]);
  const selected = data?.selected;
  const patient = selected?.patient;

  return <AppShell>{!data ? <PageLoader/> : <div className="inbox-shell">
    <section className="conversation-list-panel">
      <header className="inbox-brand"><div><span className="eyebrow">24/7 patient reception</span><h1>Inbox</h1></div><button className="icon-button" aria-label="Inbox options"><MoreHorizontal size={20}/></button></header>
      <label className="search-field"><Search size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations"/></label>
      <div className="filter-strip">{filters.map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? "active" : ""}>{item}</button>)}</div>
      <div className="conversation-list">{patients.map((item) => <button className={`conversation-card ${patientId === item.id ? "selected" : ""}`} key={item.id} onClick={() => setPatientId(item.id)}>
        <Avatar patient={item}/><div className="conversation-copy"><div className="conversation-line"><strong>{item.name}</strong><time>{relativeDate(item.lastMessageAt)}</time></div><div className="conversation-line"><p>{item.lastMessage || "No messages yet"}</p>{item.unreadCount > 0 && <span className="unread-count">{item.unreadCount}</span>}</div><div className="conversation-tags"><StatusBadge value={item.treatmentSlug || "New enquiry"}/><span className={`temperature-label ${item.leadTemperature.toLowerCase()}`}>{item.leadTemperature === "HOT" && <Flame size={11}/>} {item.leadTemperature}</span></div></div>
      </button>)}{patients.length === 0 && <div className="empty-list"><Search size={22}/><strong>No conversations found</strong><span>Try a different filter or search.</span></div>}</div>
    </section>
    {selected && patient ? <>
      <section className="chat-panel">
        <header className="chat-header"><div className="patient-heading"><Avatar patient={patient}/><div><strong>{patient.name}</strong><span>{titleCase(patient.treatmentSlug)} · {patient.phone}</span></div></div><div className={`mode-badge ${patient.aiEnabled ? "ai" : "human"}`}>{patient.aiEnabled ? <Bot size={15}/> : <UserRound size={15}/>} {patient.aiEnabled ? "AI Active" : "Human Mode"}</div></header>
        <div className="chat-context-bar"><Info size={14}/><span>Radiance Clinics · Bhubaneswar</span><span className="context-separator"/> <span>Conversation context is saved to CRM</span></div>
        <div className="message-stream"><div className="day-divider"><span>Today</span></div>{selected.messages.length ? selected.messages.map((message) => <MessageBubble key={message.id} message={message}/>) : <div className="conversation-empty"><div className="empty-spark"><Sparkles size={24}/></div><h3>No messages yet</h3><p>New WhatsApp patient messages will appear here automatically.</p></div>}<div ref={messagesEnd}/></div>
        <div className="composer-wrap"><div className="ai-composer-note"><Info size={14}/>This inbox is read-only. Receptionists reply from the official WhatsApp Business app; their replies appear here automatically and pause AI for the human-lock window.</div></div>
      </section>
      <aside className="intelligence-panel">
        <div className="intel-scroll">
          <div className="intel-heading"><div><span className="eyebrow">Patient intelligence</span><h2>AI Understanding</h2></div><Sparkles size={18}/></div>
          <div className="score-card"><div className="score-ring" style={{ "--score": `${patient.leadScore * 3.6}deg` } as React.CSSProperties}><span>{patient.leadScore}</span></div><div><span>LEAD SCORE</span><strong className={patient.leadTemperature.toLowerCase()}>{patient.leadTemperature}</strong><small>{patient.leadScore >= 70 ? "High consultation intent" : patient.leadScore >= 40 ? "Engaged lead" : "Early enquiry"}</small></div></div>
          <div className="intel-grid"><div><span>Treatment</span><strong>{titleCase(patient.treatmentSlug)}</strong></div><div><span>Lead stage</span><strong>{titleCase(patient.leadStage)}</strong></div><div><span>Age</span><strong>{patient.age || "Not shared"}</strong></div><div><span>Source</span><strong>{titleCase(patient.source)}</strong></div></div>
          <div className="intel-section"><span className="section-label">PRIMARY CONCERN</span><p>{patient.primaryConcern || "Waiting for the patient to describe their concern."}</p>{patient.concernDuration && <small>Duration · {patient.concernDuration}</small>}</div>
          {selected.appointment && <div className="intel-section appointment-intel"><div className="section-title"><CalendarPlus size={16}/><span>Appointment</span></div><strong>{dateTime(selected.appointment.dateTime)}</strong><StatusBadge value={selected.appointment.status}/></div>}
          <div className="intel-section"><span className="section-label">AI SUMMARY</span><p>{patient.aiSummary || "A grounded patient summary will appear after the first message."}</p></div>
          <div className="intel-section"><span className="section-label">CONTENT SENT</span>{selected.sentContent.length ? selected.sentContent.map((item) => <div className="mini-content" key={item.id}>{item.type === "youtube" ? <Video size={15}/> : <FileText size={15}/>}<span>{item.title}</span></div>) : <p className="muted">No content sent yet.</p>}</div>
          <div className="activity-feed"><div className="section-title"><Activity size={16}/><span>Live AI Activity</span><span className="live-dot">LIVE</span></div>{selected.events.slice(0, 10).map((event) => <div className="activity-item" key={event.id}><span className="event-dot"/><div><strong>{event.title}</strong>{event.details && <p>{event.details}</p>}<time>{new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(event.createdAt))}</time></div></div>)}{!selected.events.length && <p className="muted">Waiting for live activity…</p>}</div>
        </div>
        <div className="intel-actions"><Link href={`/leads/${patient.id}`} className="secondary-button"><UserRound size={16}/>Open Patient</Link><Link href="/appointments" className="secondary-button"><CalendarPlus size={16}/>Book</Link></div>
      </aside>
    </> : <div className="empty-state">Select a conversation</div>}
    {error && <div className="connection-warning"><CircleAlert size={16}/>{error}</div>}
  </div>}</AppShell>;
}
