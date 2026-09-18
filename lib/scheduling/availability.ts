import { addDays } from "date-fns";
import { getDatabase, nowIso } from "@/db";
import { appointmentWeekdays, emptyAppointmentConfiguration, type AppointmentConfiguration, type BlockedSlot, type TimeRange } from "./appointment-types";

export { appointmentWeekdays, emptyAppointmentConfiguration, type AppointmentConfiguration, type AppointmentWeekday, type BlockedSlot, type TimeRange } from "./appointment-types";

function timeIsValid(value: unknown) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validRange(value: unknown): value is TimeRange {
  return Boolean(value && typeof value === "object" && timeIsValid((value as TimeRange).start) && timeIsValid((value as TimeRange).end) && (value as TimeRange).start < (value as TimeRange).end);
}

function json(value: string | undefined) {
  try { return JSON.parse(value || "null") as unknown; } catch { return null; }
}

function configuredSettings() {
  const rows = getDatabase().prepare("SELECT `key` AS settingKey,value FROM settings").all() as Array<{ settingKey: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.settingKey, row.value])) as Record<string, string>;
}

export function appointmentConfiguration(settings = configuredSettings()): AppointmentConfiguration {
  const raw = json(settings.appointmentScheduleJson);
  const fallback = emptyAppointmentConfiguration();
  if (!raw || typeof raw !== "object") return fallback;
  const candidate = raw as Partial<AppointmentConfiguration>;
  const weekly = { ...fallback.weekly };
  for (const day of appointmentWeekdays) {
    const ranges = Array.isArray(candidate.weekly?.[day]) ? candidate.weekly?.[day] : [];
    weekly[day] = ranges.filter(validRange).map((range) => ({ start: range.start, end: range.end }));
  }
  const slotMinutes = Number(candidate.slotMinutes);
  const bookingLeadMinutes = Number(candidate.bookingLeadMinutes);
  const maxAdvanceDays = Number(candidate.maxAdvanceDays);
  const closedDates = Array.isArray(candidate.closedDates) ? candidate.closedDates.filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) : [];
  const blockedSlots = Array.isArray(candidate.blockedSlots)
    ? candidate.blockedSlots.filter((slot): slot is BlockedSlot => Boolean(slot && typeof slot === "object" && /^\d{4}-\d{2}-\d{2}$/.test(String((slot as BlockedSlot).date)) && timeIsValid((slot as BlockedSlot).time)))
    : [];
  return {
    weekly,
    slotMinutes: Number.isInteger(slotMinutes) && slotMinutes >= 10 && slotMinutes <= 180 ? slotMinutes : 0,
    bookingLeadMinutes: Number.isInteger(bookingLeadMinutes) && bookingLeadMinutes >= 0 && bookingLeadMinutes <= 1440 ? bookingLeadMinutes : 30,
    maxAdvanceDays: Number.isInteger(maxAdvanceDays) && maxAdvanceDays >= 1 && maxAdvanceDays <= 365 ? maxAdvanceDays : 0,
    closedDates: [...new Set(closedDates)],
    blockedSlots: [...new Map(blockedSlots.map((slot) => [`${slot.date}T${slot.time}`, slot])).values()],
  };
}

export function appointmentConfigurationMissing(config = appointmentConfiguration()) {
  const missing: string[] = [];
  if (!Object.values(config.weekly).some((ranges) => ranges.length)) missing.push("Weekly consultation schedule");
  if (!config.slotMinutes) missing.push("Slot duration");
  if (!config.maxAdvanceDays) missing.push("Maximum advance booking days");
  return missing;
}

function formatIstDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function timesForRanges(ranges: TimeRange[], minutes: number) {
  const times: string[] = [];
  for (const range of ranges) {
    const [startHour, startMinute] = range.start.split(":").map(Number);
    const [endHour, endMinute] = range.end.split(":").map(Number);
    for (let at = startHour * 60 + startMinute; at + minutes <= endHour * 60 + endMinute; at += minutes) {
      times.push(`${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`);
    }
  }
  return [...new Set(times)];
}

/** Rebuilds only future offerable slots. Confirmed appointments remain untouched. */
export function refreshAppointmentAvailability(config = appointmentConfiguration(), now = new Date()) {
  const missing = appointmentConfigurationMissing(config);
  const db = getDatabase();
  const today = formatIstDate(now);
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM available_slots WHERE date >= ?").run(today);
    if (missing.length) return { generated: 0, missing };
    const blocked = new Set(config.blockedSlots.map((slot) => `${slot.date}T${slot.time}`));
    const insert = db.prepare("INSERT OR IGNORE INTO available_slots (id,date,time,active) VALUES (?,?,?,1)");
    let generated = 0;
    for (let offset = 0; offset <= config.maxAdvanceDays; offset += 1) {
      const date = formatIstDate(addDays(now, offset));
      if (config.closedDates.includes(date)) continue;
      const weekday = appointmentWeekdays[new Date(`${date}T12:00:00+05:30`).getUTCDay()];
      for (const time of timesForRanges(config.weekly[weekday], config.slotMinutes)) {
        if (blocked.has(`${date}T${time}`)) continue;
        insert.run(`slot_${date}_${time.replace(":", "")}`, date, time);
        generated += 1;
      }
    }
    return { generated, missing };
  });
  return transaction();
}

export function saveAppointmentConfiguration(config: AppointmentConfiguration) {
  const normalized = appointmentConfiguration({ appointmentScheduleJson: JSON.stringify(config) });
  getDatabase().prepare("INSERT OR REPLACE INTO settings (`key`,value,updated_at) VALUES (?,?,?)").run("appointmentScheduleJson", JSON.stringify(normalized), nowIso());
  const refreshed = refreshAppointmentAvailability(normalized);
  return { configuration: normalized, ...refreshed };
}
