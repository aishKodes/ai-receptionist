export type InteractionType = "NONE" | "BUTTONS" | "LIST" | "DATE_CHOICES" | "SLOT_CHOICES";
export type InteractionOption = { id: string; label: string; value: string };
export type Interaction = { type: InteractionType; options: InteractionOption[] };
export type ChoiceContext = {
  reason: "greeting" | "category" | "ambiguous_concern" | "booking_date" | "booking_time" | "booking_offer" | "post_booking" | "answer";
  intentConfidence?: number;
  hasResolvedIntent?: boolean;
};

const categoryOptions: InteractionOption[] = [
  { id: "hair", label: "Hair", value: "category:hair" },
  { id: "skin", label: "Skin", value: "category:skin" },
  { id: "aesthetics", label: "Aesthetic", value: "category:aesthetics" },
  { id: "book", label: "Book consultation", value: "action:book" },
];

const concernOptions: Record<string, InteractionOption[]> = {
  hair: [
    { id: "hair_fall", label: "Hair fall", value: "treatment:hair_loss" },
    { id: "hair_thinning", label: "Hair thinning", value: "treatment:hair_loss" },
    { id: "baldness", label: "Baldness", value: "treatment:hair_transplant" },
    { id: "hair_transplant", label: "Hair transplant", value: "treatment:hair_transplant" },
  ],
  skin: [
    { id: "acne", label: "Acne", value: "treatment:acne" },
    { id: "acne_scars", label: "Acne scars", value: "treatment:acne_scars" },
    { id: "pigmentation", label: "Pigmentation", value: "treatment:pigmentation" },
    { id: "skin_glow", label: "Glow / brightening", value: "treatment:skin_glow" },
  ],
  aesthetics: [
    { id: "botox", label: "Botox", value: "treatment:botox" },
    { id: "fillers", label: "Fillers", value: "treatment:fillers" },
    { id: "laser_hair_removal", label: "Laser hair removal", value: "treatment:laser_hair_removal_full_face" },
    { id: "tattoo_removal", label: "Tattoo removal", value: "treatment:tattoo_removal" },
  ],
};

const treatmentOptions: InteractionOption[] = [
  { id: "estimated_cost", label: "Estimated cost", value: "topic:price" },
  { id: "procedure", label: "Procedure", value: "topic:procedure" },
  { id: "suitability", label: "Suitability", value: "topic:suitability" },
  { id: "book", label: "Book consultation", value: "action:book" },
];

export const noInteraction: Interaction = { type: "NONE", options: [] };

/** Buttons reduce typing at genuine decisions; they never replace free text. */
export function shouldOfferChoices(context: ChoiceContext) {
  if (context.reason === "answer") return false;
  if (context.reason === "greeting" || context.reason === "category" || context.reason === "booking_date" || context.reason === "booking_time" || context.reason === "post_booking") return true;
  if (context.reason === "booking_offer") return !context.hasResolvedIntent || (context.intentConfidence ?? 0) < 0.95;
  return (context.intentConfidence ?? 0) < 0.82;
}

export function greetingInteraction(): Interaction { return { type: "BUTTONS", options: categoryOptions }; }
export function categoryInteraction(category: string): Interaction { return { type: "BUTTONS", options: concernOptions[category] || [] }; }
export function treatmentInteraction(): Interaction { return { type: "BUTTONS", options: treatmentOptions }; }
export function consultationInteraction(): Interaction {
  return { type: "BUTTONS", options: [
    { id: "book", label: "Book consultation", value: "action:book" },
    { id: "another", label: "Ask another question", value: "topic:another" },
  ] };
}
export function confirmedAppointmentInteraction(): Interaction {
  return { type: "BUTTONS", options: [
    { id: "directions", label: "Get directions", value: "action:directions" },
    { id: "reschedule", label: "Reschedule", value: "action:reschedule" },
    { id: "cancel", label: "Cancel appointment", value: "action:cancel" },
  ] };
}
export function dateInteraction(): Interaction {
  return { type: "DATE_CHOICES", options: [
    { id: "today", label: "Today", value: "date:today" },
    { id: "tomorrow", label: "Tomorrow", value: "date:tomorrow" },
    { id: "another_date", label: "Choose another date", value: "date:other" },
  ] };
}
export function slotInteraction(slots: string[]): Interaction {
  return { type: "SLOT_CHOICES", options: slots.slice(0, 4).map((slot, index) => ({ id: `slot_${index + 1}`, label: slot, value: `slot:${slot}` })) };
}
export function timeSuggestionInteraction(times: string[]): Interaction {
  const label = (time: string) => {
    const hour = Number(time.slice(0, 2));
    return `${hour % 12 || 12}${time.endsWith(":00") ? "" : `:${time.slice(3)}`} ${hour >= 12 ? "PM" : "AM"}`;
  };
  return { type: "BUTTONS", options: times.slice(0, 3).map((time) => ({ id: `time_${time.replace(":", "")}`, label: label(time), value: `time:${time}` })) };
}

export function formatInteraction(interaction: Interaction) {
  if (!interaction.options.length) return "";
  return interaction.options.map((option, index) => `${index + 1}. ${option.label}`).join("\n");
}

export function parseOptions(value: unknown): InteractionOption[] {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.label === "string" && typeof item.value === "string") : [];
  } catch { return []; }
}

export function resolveInteractionInput(input: string, options: InteractionOption[]) {
  const text = input.trim().toLowerCase();
  const numeric = text.match(/^(?:option\s*)?(\d)$/i);
  if (numeric) return options[Number(numeric[1]) - 1] || null;
  return options.find((option) => option.label.toLowerCase() === text || option.id.toLowerCase() === text || option.value.toLowerCase() === text) || null;
}

export function withInteractionText(text: string, interaction: Interaction) {
  const choices = formatInteraction(interaction);
  return choices ? `${text.trim()}\n\n${choices}` : text.trim();
}
