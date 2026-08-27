"use client";

import { Bot, CalendarCheck2, CheckCheck, ExternalLink, FileQuestion, Globe2, Image as ImageIcon, Play, UserRound } from "lucide-react";
import type { Message, Patient } from "@/lib/ui-types";

export const titleCase = (value?: string | null) => value ? value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase()) : "Not identified";
export const initials = (name: string) => name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
export const shortTime = (value?: string | null) => value ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
export const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
export const relativeDate = (value?: string | null) => {
  if (!value) return "—";
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "Now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(value));
};

export function Avatar({ patient, size = "md" }: { patient: Pick<Patient, "name" | "leadTemperature">; size?: "sm" | "md" | "lg" }) {
  return <div className={`avatar avatar-${size} temp-${patient.leadTemperature.toLowerCase()}`}>{initials(patient.name)}</div>;
}

export function StatusBadge({ value, kind = "neutral" }: { value: string; kind?: "temperature" | "stage" | "source" | "neutral" }) {
  return <span className={`status-badge badge-${kind} badge-${value.toLowerCase().replaceAll("_", "-")}`}>{titleCase(value)}</span>;
}

function contentIcon(type: string) {
  if (type === "youtube") return <Play size={17} fill="currentColor"/>;
  if (type === "website") return <Globe2 size={17}/>;
  if (type === "before_after") return <ImageIcon size={17}/>;
  return <FileQuestion size={17}/>;
}

export function MessageBubble({ message, patientView = false }: { message: Message; patientView?: boolean }) {
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(message.metadataJson || "{}"); } catch {}
  if (message.senderType === "system" || message.messageType === "system") {
    return <div className="system-message"><span>{message.content}</span><time>{shortTime(message.createdAt)}</time></div>;
  }
  const isPatient = message.senderType === "patient";
  const own = patientView ? isPatient : !isPatient;
  if (["youtube", "website", "before_after", "faq", "instruction"].includes(message.messageType)) {
    const verifiedRadiance = meta.verifiedRadiance === true;
    return <div className={`message-row ${own ? "own" : ""}`}><div className="content-message-card">
      <div className={`content-art type-${message.messageType}`}>{contentIcon(message.messageType)}<span>{verifiedRadiance ? "OFFICIAL RADIANCE VIDEO" : "DEMO CONTENT"}</span></div>
      <div className="content-card-body"><span className="message-sender"><Bot size={13}/>Recommended for you</span><strong>{String(meta.title || "Radiance patient guide")}</strong><p>{message.content}</p>{message.mediaUrl && <a href={message.mediaUrl} target="_blank" rel="noreferrer">{verifiedRadiance ? "Watch on YouTube" : "Open demo resource"} <ExternalLink size={13}/></a>}</div>
      <time>{shortTime(message.createdAt)}</time>
    </div></div>;
  }
  if (message.messageType === "appointment") {
    return <div className={`message-row ${own ? "own" : ""}`}><div className="appointment-message-card"><div className="appointment-icon"><CalendarCheck2 size={22}/></div><div><span>CONSULTATION CONFIRMED</span><p>{message.content}</p></div><time>{shortTime(message.createdAt)}</time></div></div>;
  }
  return <div className={`message-row ${own ? "own" : ""}`}><div className={`message-bubble sender-${message.senderType}`}>
    {!isPatient && !patientView && <span className="message-sender">{message.senderType === "human" ? <UserRound size={12}/> : <Bot size={12}/>} {message.senderType === "human" ? "Radiance reception" : message.senderType === "automation" ? "Automation" : "Radiance AI"}</span>}
    <p>{message.content}</p><div className="message-meta"><time>{shortTime(message.createdAt)}</time>{own && <CheckCheck size={14}/>}</div>
  </div></div>;
}
