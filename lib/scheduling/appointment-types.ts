export const appointmentWeekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type AppointmentWeekday = typeof appointmentWeekdays[number];
export type TimeRange = { start: string; end: string };
export type BlockedSlot = { date: string; time: string };
export type AppointmentConfiguration = {
  weekly: Record<AppointmentWeekday, TimeRange[]>;
  slotMinutes: number;
  bookingLeadMinutes: number;
  maxAdvanceDays: number;
  closedDates: string[];
  blockedSlots: BlockedSlot[];
};

export const emptyAppointmentConfiguration = (): AppointmentConfiguration => ({
  weekly: { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] },
  slotMinutes: 0,
  bookingLeadMinutes: 30,
  maxAdvanceDays: 0,
  closedDates: [],
  blockedSlots: [],
});
