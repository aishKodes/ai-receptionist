import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appointmentConfiguration, appointmentConfigurationMissing, appointmentWeekdays, saveAppointmentConfiguration } from "@/lib/scheduling/availability";
import { enforceRateLimit, enforceSameOrigin } from "@/lib/security/http";

const Time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const Range = z.object({ start: Time, end: Time }).refine((range) => range.start < range.end, "Each consultation range must end after it starts.");
const DayRanges = z.array(Range).max(4);
const Weekly = z.object(Object.fromEntries(appointmentWeekdays.map((day) => [day, DayRanges])) as Record<(typeof appointmentWeekdays)[number], typeof DayRanges>);
const Configuration = z.object({
  weekly: Weekly,
  slotMinutes: z.number().int().min(10).max(180),
  bookingLeadMinutes: z.number().int().min(0).max(1440),
  maxAdvanceDays: z.number().int().min(1).max(365),
  closedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(365),
  blockedSlots: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: Time })).max(1000),
});

export function GET() {
  const configuration = appointmentConfiguration();
  return NextResponse.json({ configuration, missing: appointmentConfigurationMissing(configuration) });
}

export async function POST(request: NextRequest) {
  try {
    enforceSameOrigin(request);
    enforceRateLimit(request, "appointment-settings", 20);
    const configuration = Configuration.parse(await request.json());
    const result = saveAppointmentConfiguration(configuration);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Appointment settings could not be saved." }, { status: 400 });
  }
}
