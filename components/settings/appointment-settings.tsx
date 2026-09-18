"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageLoader } from "@/components/app-shell";
import { appointmentWeekdays, emptyAppointmentConfiguration, type AppointmentConfiguration, type AppointmentWeekday } from "@/lib/scheduling/appointment-types";

const dayLabel = (day: string) => `${day.slice(0, 1).toUpperCase()}${day.slice(1)}`;

export function AppointmentSettingsPage() {
  const [configuration, setConfiguration] = useState<AppointmentConfiguration | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/appointments", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => setConfiguration(body.configuration || emptyAppointmentConfiguration()))
      .catch(() => toast.error("Appointment settings could not be loaded."));
  }, []);

  function updateDay(day: AppointmentWeekday, index: number, key: "start" | "end", value: string) {
    if (!configuration) return;
    const weekly = { ...configuration.weekly, [day]: configuration.weekly[day].map((range, rangeIndex) => rangeIndex === index ? { ...range, [key]: value } : range) };
    setConfiguration({ ...configuration, weekly });
  }
  function addRange(day: AppointmentWeekday) {
    if (!configuration || configuration.weekly[day].length >= 4) return;
    setConfiguration({ ...configuration, weekly: { ...configuration.weekly, [day]: [...configuration.weekly[day], { start: "10:00", end: "13:00" }] } });
  }
  function removeRange(day: AppointmentWeekday, index: number) {
    if (!configuration) return;
    setConfiguration({ ...configuration, weekly: { ...configuration.weekly, [day]: configuration.weekly[day].filter((_, rangeIndex) => rangeIndex !== index) } });
  }
  async function save() {
    if (!configuration) return;
    setSaving(true);
    try {
      const response = await fetch("/api/settings/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configuration) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save appointment settings.");
      setConfiguration(body.configuration);
      toast.success(`Calendar saved — ${body.generated} future appointment slots are available.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save appointment settings."); }
    finally { setSaving(false); }
  }

  if (!configuration) return <AppShell title="Appointment settings"><PageLoader/></AppShell>;
  return <AppShell eyebrow="Live calendar rules" title="Appointment settings" action={<button className="primary-button" onClick={save} disabled={saving}><Save size={16}/>{saving ? "Saving…" : "Save calendar"}</button>}>
    <div className="page-content settings-layout">
      <section className="surface provider-card">
        <div className="section-head"><div><h2>Weekly consultation hours</h2><p>Only these configured slots can be offered by the receptionist. Leave a day empty to close it; add two ranges to represent a midday break.</p></div><CalendarClock/></div>
        <div className="form-grid">{appointmentWeekdays.map((day) => <div className="span-2" key={day}><strong>{dayLabel(day)}</strong>{configuration.weekly[day].length === 0 ? <p className="muted">Closed</p> : configuration.weekly[day].map((range, index) => <div className="inline-form" key={`${day}-${index}`}><input aria-label={`${day} start`} type="time" value={range.start} onChange={(event) => updateDay(day, index, "start", event.target.value)}/><span>to</span><input aria-label={`${day} end`} type="time" value={range.end} onChange={(event) => updateDay(day, index, "end", event.target.value)}/><button className="icon-button danger" onClick={() => removeRange(day, index)} title="Remove range"><Trash2 size={15}/></button></div>)}<button className="secondary-button" onClick={() => addRange(day)} disabled={configuration.weekly[day].length >= 4}><Plus size={15}/>Add hours / break</button></div>)}</div>
      </section>
      <aside className="surface privacy-card"><div className="privacy-icon"><CalendarClock/></div><h2>Slot rules</h2><label>Appointment length (minutes)<input type="number" min="10" max="180" value={configuration.slotMinutes || ""} onChange={(event) => setConfiguration({ ...configuration, slotMinutes: Number(event.target.value) })}/></label><label>Minimum booking lead time (minutes)<input type="number" min="0" max="1440" value={configuration.bookingLeadMinutes} onChange={(event) => setConfiguration({ ...configuration, bookingLeadMinutes: Number(event.target.value) })}/></label><label>Maximum advance days<input type="number" min="1" max="365" value={configuration.maxAdvanceDays || ""} onChange={(event) => setConfiguration({ ...configuration, maxAdvanceDays: Number(event.target.value) })}/></label><p>Future availability is rebuilt on save. Confirmed appointments are never changed.</p></aside>
      <section className="surface provider-card"><div className="section-head"><div><h2>Exceptions</h2><p>Use dates for full-day closures and date/time rows for temporary blocked appointment slots.</p></div></div><label>Closed dates (one YYYY-MM-DD date per line)<textarea rows={4} value={configuration.closedDates.join("\n")} onChange={(event) => setConfiguration({ ...configuration, closedDates: event.target.value.split(/\s+/).filter(Boolean) })}/></label><label>Temporarily blocked slots (one YYYY-MM-DD HH:MM row per line)<textarea rows={5} value={configuration.blockedSlots.map((slot) => `${slot.date} ${slot.time}`).join("\n")} onChange={(event) => setConfiguration({ ...configuration, blockedSlots: event.target.value.split("\n").map((line) => line.trim().match(/^(\d{4}-\d{2}-\d{2})\s+([0-2]\d:[0-5]\d)$/)).filter((match): match is RegExpMatchArray => Boolean(match)).map((match) => ({ date: match[1], time: match[2] })) })}/></label></section>
    </div>
  </AppShell>;
}
