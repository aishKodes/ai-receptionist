"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, LoaderCircle, RotateCcw, Send, ShieldCheck, Sparkles, WifiOff } from "lucide-react";
import { MessageBubble, titleCase } from "@/components/shared";
import type { Appointment, Message, Patient } from "@/lib/ui-types";

type TestContext = {
  patient: Patient;
  messages: Message[];
  appointment: Appointment | null;
  state: Record<string, unknown>;
};

const suggestions = ["Hi", "Mujhe acne hai", "Hindi please", "Odia please", "Tomorrow 5 PM", "Hair transplant ka video guide share kijiye"];

export function ReceptionTestPanel() {
  const [context, setContext] = useState<TestContext | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stream = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/testing/reception", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { context?: TestContext; error?: string };
        if (!response.ok || !body.context) throw new Error(body.error || "Could not open the local test conversation.");
        if (active) setContext(body.context);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load test panel."); });
    return () => { active = false; };
  }, []);
  useEffect(() => { stream.current?.scrollTo({ top: stream.current.scrollHeight, behavior: "smooth" }); }, [context?.messages.length, busy]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/testing/reception", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
      const body = await response.json() as { context?: TestContext; error?: string };
      if (!response.ok || !body.context) throw new Error(body.error || "The receptionist could not answer.");
      setContext(body.context);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The receptionist could not answer."); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/testing/reception", { method: "DELETE" });
      const body = await response.json() as { context?: TestContext; error?: string };
      if (!response.ok || !body.context) throw new Error(body.error || "Could not reset the test conversation.");
      setContext(body.context); setMessage("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reset the test conversation."); }
    finally { setBusy(false); }
  }

  const state = context?.state || {};
  return <main className="simulator-page reception-test-page">
    <section className="simulator-tools">
      <Link className="test-back-link" href="/inbox"><ArrowLeft size={15}/>Back to dashboard</Link>
      <div><span className="eyebrow">Temporary · Local testing only</span><h1>Test your AI receptionist</h1><p>Chat exactly like a patient. Replies use the real Radiance conversation engine with DeepSeek and two Gemini fallback tiers.</p></div>
      <div className="test-safety-note"><WifiOff size={18}/><div><strong>No WhatsApp messages are sent</strong><span>Everything stays inside this one local test conversation.</span></div></div>
      <div className="test-suggestions"><span>Try a message</span>{suggestions.map((item) => <button type="button" key={item} onClick={() => setMessage(item)} disabled={busy}>{item}</button>)}</div>
      <button className="secondary-button test-reset" type="button" onClick={reset} disabled={busy}><RotateCcw size={15}/>New test conversation</button>
    </section>

    <section className="phone-frame" aria-label="Local patient chat simulator">
      <div className="phone-speaker"/><div className="phone-home"/>
      <div className="patient-chat">
        <header className="patient-chat-header"><div className="clinic-avatar"><Sparkles size={17}/></div><div className="clinic-heading"><strong>Radiance Clinics</strong><span>{busy ? "Receptionist is typing…" : "AI Reception · Bhubaneswar"}</span></div><ShieldCheck size={16}/></header>
        <div className="patient-chat-bg" ref={stream}>
          <div className="encryption-note">LOCAL TEST · Messages are not delivered to WhatsApp</div>
          {!context?.messages.length && <div className="patient-welcome"><div className="clinic-avatar large"><Bot size={23}/></div><strong>Start a patient conversation</strong><span>Use English, Hindi, Hinglish or Odia</span><p>Try “Hi” first, then ask about a concern, consultation, price, video or appointment.</p></div>}
          {context?.messages.map((item) => <MessageBubble key={item.id} message={item} patientView/>)}
          {busy && <div className="typing-bubble" aria-label="Receptionist typing"><span/><span/><span/></div>}
          {error && <div className="test-chat-error">{error}</div>}
        </div>
        <form className="patient-composer" onSubmit={send}><Bot size={17}/><textarea aria-label="Patient message" placeholder="Type as a patient…" value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}/><button className="patient-send" aria-label="Send test message" disabled={busy || !message.trim()}>{busy ? <LoaderCircle className="spin" size={16}/> : <Send size={16}/>}</button></form>
      </div>
    </section>

    <aside className="simulator-status test-state-card">
      <span className="eyebrow">Live conversation state</span>
      <div><Bot size={15}/><span>Language<br/><strong>{titleCase(String(state.preferredLanguage || "AUTO"))}</strong></span></div>
      <div><Sparkles size={15}/><span>Conversation phase<br/><strong>{titleCase(String(state.conversationPhase || "DISCOVERY"))}</strong></span></div>
      <div><span className="test-state-dot"/><span>Readiness<br/><strong>{String(state.readinessScore || 0)} / 100</strong></span></div>
      <div><span className="test-state-dot"/><span>Main objection<br/><strong>{titleCase(String(state.primaryObjection || "None"))}</strong></span></div>
      <div><span className="test-state-dot"/><span>Next best action<br/><strong>{titleCase(String(state.nextBestAction || "ANSWER"))}</strong></span></div>
      <div><ShieldCheck size={15}/><span>AI mode<br/><strong>{titleCase(String(state.aiMode || "AI"))}</strong></span></div>
      <div><span className="test-state-dot"/><span>Lead score<br/><strong>{context?.patient.leadScore ?? 10} · {context?.patient.leadTemperature || "COLD"}</strong></span></div>
      <div><span className="test-state-dot"/><span>Treatment<br/><strong>{titleCase(context?.patient.treatmentSlug)}</strong></span></div>
      <div><span className="test-state-dot"/><span>Appointment<br/><strong>{context?.appointment ? titleCase(context.appointment.status) : "Not booked"}</strong></span></div>
      <p>Use “New test conversation” whenever you want to clear the state and start again.</p>
    </aside>
  </main>;
}
