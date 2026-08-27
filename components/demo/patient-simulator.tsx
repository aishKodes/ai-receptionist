"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCheck, ChevronDown, MoreVertical, Paperclip, Phone, Plus, Send, Sparkles, Video } from "lucide-react";
import { toast } from "sonner";
import { MessageBubble, shortTime } from "@/components/shared";
import { useRadianceState } from "@/components/use-radiance-state";

export function PatientSimulator() {
  const [patientId, setPatientId] = useState("pat_rahul");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const { data, refresh } = useRadianceState(patientId);
  const endRef = useRef<HTMLDivElement>(null);
  const selected = data?.selected;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [selected?.messages.length, sending]);
  async function send() {
    if (!draft.trim() || sending) return;
    const content = draft.trim(); setDraft(""); setSending(true);
    const response = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, content, senderType: "patient" }) });
    setSending(false); if (!response.ok) { const body = await response.json(); toast.error(body.error || "Message failed"); } refresh();
  }
  async function freshPatient() {
    const response = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "fresh_patient" }) });
    const result = await response.json(); if (result.patientId) { setPatientId(result.patientId); toast.success("Fresh demo patient created"); }
  }
  const patient = selected?.patient;
  return <div className="simulator-page">
    <div className="simulator-tools"><div><span className="eyebrow">LIVE PATIENT VIEW</span><h1>Patient simulator</h1><p>Send real free-form messages into the same reception pipeline.</p></div><div className="simulator-controls"><label>Demo patient<ChevronDown size={14}/><select value={patientId} onChange={(event) => setPatientId(event.target.value)}>{data?.patients.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.phone}</option>)}</select></label><button className="secondary-button" onClick={freshPatient}><Plus size={16}/>Fresh patient</button><Link href="/inbox" className="primary-button">Open inbox</Link></div></div>
    <div className="phone-frame"><div className="phone-speaker"/><div className="patient-chat">
      <header className="patient-chat-header"><ArrowLeft size={20}/><div className="clinic-avatar"><Sparkles size={17}/></div><div className="clinic-heading"><strong>Radiance Clinics</strong><span>Bhubaneswar · typically replies instantly</span></div><Video size={19}/><Phone size={18}/><MoreVertical size={19}/></header>
      <div className="patient-chat-bg"><div className="encryption-note">This local demo simulates an encrypted messaging experience. No WhatsApp connection is required.</div>{selected?.messages.length ? selected.messages.map((message) => <MessageBubble key={message.id} message={message} patientView/>) : <div className="patient-welcome"><div className="clinic-avatar large"><Sparkles size={22}/></div><strong>Radiance Clinics</strong><span>Bhubaneswar</span><p>Hi {patient?.name.split(" ")[0] || "there"} 👋<br/>How can we help you today?</p></div>}{sending && <div className="typing-bubble"><span/><span/><span/></div>}<div ref={endRef}/></div>
      <div className="patient-composer"><button aria-label="Attach"><Paperclip size={20}/></button><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }}} placeholder="Message" rows={1}/><button className="patient-send" onClick={send} disabled={!draft.trim() || sending}><Send size={18}/></button></div>
    </div><div className="phone-home"/></div>
    <div className="simulator-status"><div><span className="pulse-dot"/><strong>Live local pipeline</strong></div><span>Last synced {shortTime(data?.serverTime)}</span><div><CheckCheck size={15}/><span>CRM + inbox connected</span></div></div>
  </div>;
}
