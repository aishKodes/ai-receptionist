import { addDays } from "date-fns";
import { appointmentConfiguration, type AppointmentConfiguration, type TimeRange } from "./availability";

export type BookingCheck = {
  ok: boolean;
  code: "OPEN" | "INVALID_DATE" | "INVALID_TIME" | "PAST" | "SAME_DAY_DISABLED" | "TOO_FAR" | "CLOSED" | "OUTSIDE_HOURS" | "BLOCKED";
  date: string;
  time: string;
  ranges: TimeRange[];
  nextOpenDate: string | null;
};

const istParts = (value = new Date()) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(value).map((part) => [part.type, part.value]));

export function istToday(now = new Date()) {
  const parts = istParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function dateForOffset(offset: number, now = new Date()) {
  const base = new Date(`${istToday(now)}T12:00:00+05:30`);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(addDays(base, offset));
}

export function isIsoDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00+05:30`).getTime()); }
export function isClockTime(value: string) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }

function rangesForDate(date: string, config: AppointmentConfiguration) {
  const special = config.specialHours.find((item) => item.date === date);
  if (special?.isClosed || config.closedDates.includes(date)) return [];
  if (special?.openingTime && special.closingTime) return [{ start: special.openingTime, end: special.closingTime }];
  const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date(`${date}T12:00:00+05:30`).getUTCDay()] as keyof AppointmentConfiguration["weekly"];
  return config.weekly[weekday] || [];
}

function isInRanges(time: string, ranges: TimeRange[], config: AppointmentConfiguration) {
  const inRange = ranges.some((range) => time >= range.start && time <= range.end);
  if (!inRange) return false;
  if (config.arbitraryTimes) return true;
  return ranges.some((range) => {
    if (time === range.end) return true;
    const [h, m] = time.split(":").map(Number);
    const [sh, sm] = range.start.split(":").map(Number);
    return (h * 60 + m - sh * 60 - sm) % config.slotMinutes === 0;
  });
}

export function nextOpenClinicDate(fromDate: string, config = appointmentConfiguration()) {
  if (!isIsoDate(fromDate)) return null;
  for (let offset = 1; offset <= Math.max(config.maxAdvanceDays, 60); offset += 1) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(addDays(new Date(`${fromDate}T12:00:00+05:30`), offset));
    if (rangesForDate(date, config).length) return date;
  }
  return null;
}

/**
 * Radiance booking policy: an appointment is bookable when the clinic is open
 * at that date/time. This deliberately does not inspect appointment counts.
 */
export function checkAppointmentTime(date: string, time: string, now = new Date(), config = appointmentConfiguration()): BookingCheck {
  const empty = (code: BookingCheck["code"], ranges: TimeRange[] = []): BookingCheck => ({ ok: false, code, date, time, ranges, nextOpenDate: code === "CLOSED" ? nextOpenClinicDate(date, config) : null });
  if (!isIsoDate(date)) return empty("INVALID_DATE");
  if (!isClockTime(time)) return empty("INVALID_TIME");
  const today = istToday(now);
  if (date < today) return empty("PAST");
  const daysAhead = Math.round((new Date(`${date}T12:00:00+05:30`).getTime() - new Date(`${today}T12:00:00+05:30`).getTime()) / 86400000);
  if (!config.sameDayBooking && date === today) return empty("SAME_DAY_DISABLED");
  if (config.maxAdvanceDays && daysAhead > config.maxAdvanceDays) return empty("TOO_FAR");
  const ranges = rangesForDate(date, config);
  if (!ranges.length) return empty("CLOSED");
  if (config.blockedSlots.some((slot) => slot.date === date && slot.time === time)) return empty("BLOCKED", ranges);
  if (!isInRanges(time, ranges, config)) return empty("OUTSIDE_HOURS", ranges);
  if (date === today) {
    const parts = istParts(now);
    const requested = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const earliest = Number(parts.hour) * 60 + Number(parts.minute) + config.bookingLeadMinutes;
    if (requested < earliest) return empty("PAST", ranges);
  }
  return { ok: true, code: "OPEN", date, time, ranges, nextOpenDate: null };
}

export function timeSuggestions(date: string, part: "morning" | "afternoon" | "evening" | null = null, config = appointmentConfiguration()) {
  const ranges = rangesForDate(date, config);
  const suggestions = part === "morning" ? ["10:00", "11:00", "12:00"] : part === "evening" ? ["17:00", "17:30", "18:00"] : ["11:00", "14:00", "17:00"];
  return suggestions.filter((time) => isInRanges(time, ranges, config));
}

export function parseAppointmentTime(text: string): string | null {
  const normalized = text.toLowerCase().replace(/\./g, ":");
  const match = normalized.match(/\b(?:at|around|by|after|before|from|to|make it|move it)\s+(1[0-2]|0?[1-9]|[01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?\b/i)
    || normalized.match(/\b(1[0-2]|0?[1-9]|[01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)\b/i)
    || normalized.match(/\b(1[0-2]|0?[1-9]|[01]?\d|2[0-3]):([0-5]\d)\b/)
    || normalized.match(/^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour < 8) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseAppointmentDate(text: string, now = new Date()) {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso && isIsoDate(iso[1])) return iso[1];
  const relative = /\bday after tomorrow\b/i.test(text) ? dateForOffset(2, now) : /\b(tomorrow|kal)\b/i.test(text) ? dateForOffset(1, now) : /\b(today|aaj)\b/i.test(text) ? dateForOffset(0, now) : null;
  if (relative) return relative;
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekday = text.toLowerCase().match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekday) {
    const today = istToday(now);
    const current = new Date(`${today}T12:00:00+05:30`).getUTCDay();
    const target = weekdays.indexOf(weekday[2]);
    let offset = (target - current + 7) % 7;
    if (offset === 0 || weekday[1]) offset += 7;
    return dateForOffset(offset, now);
  }
  const named = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/i);
  if (!named) return null;
  const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(named[2].toLowerCase());
  const today = istToday(now);
  let year = named[3] ? Number(named[3]) : Number(today.slice(0, 4));
  let date = `${year}-${String(month + 1).padStart(2, "0")}-${String(Number(named[1])).padStart(2, "0")}`;
  if (!named[3] && date < today) { year += 1; date = `${year}-${String(month + 1).padStart(2, "0")}-${String(Number(named[1])).padStart(2, "0")}`; }
  return isIsoDate(date) ? date : null;
}

export function dayPartFromText(text: string): "morning" | "afternoon" | "evening" | null {
  if (/\b(morning|before lunch)\b/i.test(text)) return "morning";
  if (/\b(afternoon|after lunch)\b/i.test(text)) return "afternoon";
  if (/\b(evening|after 5)\b/i.test(text)) return "evening";
  return null;
}

export function hasApproximateAppointmentTime(text: string) {
  return /\b(?:morning|afternoon|evening|after lunch|before lunch)\b/i.test(text)
    || /\b(?:after|before)\s+(?:1[0-2]|[1-9])(?::\d{2})?\s*(?:am|pm)?\b/i.test(text);
}

export function formatAppointmentDateTime(date: string, time: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(`${date}T${time}:00+05:30`));
}

export function clinicHoursLabel(ranges: TimeRange[]) {
  const label = (time: string) => {
    const hour = Number(time.slice(0, 2));
    return `${hour % 12 || 12}${time.endsWith(":00") ? "" : `:${time.slice(3)}`} ${hour >= 12 ? "PM" : "AM"}`;
  };
  return ranges.map((range) => `${label(range.start)} and ${label(range.end)}`).join(", ");
}
