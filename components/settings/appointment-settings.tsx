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
  function updateSpecial(index: number, key: "date" | "openingTime" | "closingTime" | "isClosed" | "label", value: string | boolean) {
    if (!configuration) return;
    setConfiguration({ ...configuration, specialHours: configuration.specialHours.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value, ...(key === "isClosed" && value === false ? { openingTime: item.openingTime || "10:00", closingTime: item.closingTime || "18:00" } : {}) } : item) });
  }
  function addSpecial() {
    if (!configuration) return;
    setConfiguration({ ...configuration, specialHours: [...configuration.specialHours, { date: new Date().toISOString().slice(0, 10), openingTime: null, closingTime: null, isClosed: true, label: "Holiday" }] });
  }
  function removeSpecial(index: number) {
    if (!configuration) return;
    setConfiguration({ ...configuration, specialHours: configuration.specialHours.filter((_, itemIndex) => itemIndex !== index) });
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
      <aside className="surface privacy-card"><div className="privacy-icon"><CalendarClock/></div><h2>Booking policy</h2><label>Booking interval (minutes)<input type="number" min="10" max="180" value={configuration.slotMinutes || ""} onChange={(event) => setConfiguration({ ...configuration, slotMinutes: Number(event.target.value) })}/></label><label>Minimum same-day lead time (minutes)<input type="number" min="0" max="1440" value={configuration.bookingLeadMinutes} onChange={(event) => setConfiguration({ ...configuration, bookingLeadMinutes: Number(event.target.value) })}/></label><label>Maximum advance days<input type="number" min="1" max="365" value={configuration.maxAdvanceDays || ""} onChange={(event) => setConfiguration({ ...configuration, maxAdvanceDays: Number(event.target.value) })}/></label><label className="check-row"><input type="checkbox" checked={configuration.autoConfirm} onChange={(event) => setConfiguration({ ...configuration, autoConfirm: event.target.checked })}/><span>Auto-confirm valid appointments</span></label><label className="check-row"><input type="checkbox" checked={configuration.sameDayBooking} onChange={(event) => setConfiguration({ ...configuration, sameDayBooking: event.target.checked })}/><span>Allow same-day booking</span></label><label className="check-row"><input type="checkbox" checked={configuration.arbitraryTimes} onChange={(event) => setConfiguration({ ...configuration, arbitraryTimes: event.target.checked })}/><span>Allow arbitrary times (for example 3:15 PM)</span></label><p>Radiance now books whenever the clinic is open; it does not treat ordinary times as scarce inventory.</p></aside>
      <section className="surface provider-card"><div className="section-head"><div><h2>Holidays and special clinic hours</h2><p>Add a closed date, a partial closure, or special opening hours. These rules take priority over weekly hours.</p></div><button className="secondary-button" onClick={addSpecial}><Plus size={15}/>Add date rule</button></div><div className="form-grid">{configuration.specialHours.map((item, index) => <div className="span-2 inline-form" key={`${item.date}-${index}`}><input aria-label="Special date" type="date" value={item.date} onChange={(event) => updateSpecial(index, "date", event.target.value)}/><input aria-label="Reason" placeholder="Holiday / special hours" value={item.label} onChange={(event) => updateSpecial(index, "label", event.target.value)}/><label className="check-row"><input type="checkbox" checked={item.isClosed} onChange={(event) => updateSpecial(index, "isClosed", event.target.checked)}/><span>Closed</span></label>{!item.isClosed && <><input aria-label="Special opening time" type="time" value={item.openingTime || "10:00"} onChange={(event) => updateSpecial(index, "openingTime", event.target.value)}/><span>to</span><input aria-label="Special closing time" type="time" value={item.closingTime || "18:00"} onChange={(event) => updateSpecial(index, "closingTime", event.target.value)}/></>}<button className="icon-button danger" onClick={() => removeSpecial(index)} title="Remove date rule"><Trash2 size={15}/></button></div>)}{!configuration.specialHours.length && <p className="muted span-2">No special closures or hours configured.</p>}</div><label>Legacy full-day closed dates (one YYYY-MM-DD date per line)<textarea rows={3} value={configuration.closedDates.join("\n")} onChange={(event) => setConfiguration({ ...configuration, closedDates: event.target.value.split(/\s+/).filter(Boolean) })}/></label><label>Temporarily blocked times (one YYYY-MM-DD HH:MM row per line)<textarea rows={4} value={configuration.blockedSlots.map((slot) => `${slot.date} ${slot.time}`).join("\n")} onChange={(event) => setConfiguration({ ...configuration, blockedSlots: event.target.value.split("\n").map((line) => line.trim().match(/^(\d{4}-\d{2}-\d{2})\s+([0-2]\d:[0-5]\d)$/)).filter((match): match is RegExpMatchArray => Boolean(match)).map((match) => ({ date: match[1], time: match[2] })) })}/></label></section>
    </div>
  </AppShell>;
}
