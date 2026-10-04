export const appointmentWeekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type AppointmentWeekday = typeof appointmentWeekdays[number];
export type TimeRange = { start: string; end: string };
export type BlockedSlot = { date: string; time: string };
export type SpecialClinicHours = {
  date: string;
  openingTime: string | null;
  closingTime: string | null;
  isClosed: boolean;
  label: string;
};
export type AppointmentConfiguration = {
  weekly: Record<AppointmentWeekday, TimeRange[]>;
  slotMinutes: number;
  bookingLeadMinutes: number;
  maxAdvanceDays: number;
  closedDates: string[];
  blockedSlots: BlockedSlot[];
  /** When enabled, a valid time such as 15:15 is accepted without slot rounding. */
  arbitraryTimes: boolean;
  sameDayBooking: boolean;
  autoConfirm: boolean;
  specialHours: SpecialClinicHours[];
};

export const emptyAppointmentConfiguration = (): AppointmentConfiguration => ({
  weekly: {
    sunday: [{ start: "10:00", end: "18:00" }],
    monday: [{ start: "10:00", end: "18:00" }],
    tuesday: [{ start: "10:00", end: "18:00" }],
    wednesday: [{ start: "10:00", end: "18:00" }],
    thursday: [{ start: "10:00", end: "18:00" }],
    friday: [{ start: "10:00", end: "18:00" }],
    saturday: [],
  },
  slotMinutes: 30,
  bookingLeadMinutes: 0,
  maxAdvanceDays: 30,
  closedDates: [],
  blockedSlots: [],
  arbitraryTimes: true,
  sameDayBooking: true,
  autoConfirm: true,
  specialHours: [],
});
