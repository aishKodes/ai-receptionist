export const treatmentCategoryDefaults = [
  { id: "cat_hair", name: "Hair", slug: "hair", description: "Hair and scalp concerns", sortOrder: 10 },
  { id: "cat_skin", name: "Skin", slug: "skin", description: "Clinical skin concerns and rejuvenation", sortOrder: 20 },
  { id: "cat_aesthetics", name: "Aesthetics", slug: "aesthetics", description: "Aesthetic and cosmetic services", sortOrder: 30 },
] as const;

export const concernDefaults = [
  ["con_hair_fall", "cat_hair", "Hair Fall", "hair_fall", ["hair_loss", "prp", "gfc"]],
  ["con_hair_thinning", "cat_hair", "Hair Thinning", "hair_thinning", ["hair_loss", "prp", "gfc"]],
  ["con_hair_transplant", "cat_hair", "Hair Transplant", "hair_transplant", ["hair_transplant"]],
  ["con_advanced_baldness", "cat_hair", "Advanced Baldness", "advanced_baldness", ["hair_transplant", "smp"]],
  ["con_prp_gfc", "cat_hair", "PRP / GFC", "prp_gfc", ["prp", "gfc"]],
  ["con_smp", "cat_hair", "SMP / Hair Replacement", "smp_hair_replacement", ["smp"]],
  ["con_pigmentation", "cat_skin", "Pigmentation / Melasma", "pigmentation_melasma", ["pigmentation", "melasma"]],
  ["con_acne", "cat_skin", "Acne", "acne", ["acne"]],
  ["con_acne_scars", "cat_skin", "Acne Scars", "acne_scars", ["acne_scars"]],
  ["con_glow", "cat_skin", "Glow / Brightening", "glow_brightening", ["dull_skin", "skin_glow"]],
  ["con_hydrafacial", "cat_skin", "HydraFacial / Facial", "hydrafacial_facial", ["hydrafacial"]],
  ["con_laser_rejuvenation", "cat_skin", "Laser Resurfacing / Rejuvenation", "laser_rejuvenation", ["laser"]],
  ["con_botox", "cat_aesthetics", "Botox", "botox", ["botox"]],
  ["con_fillers", "cat_aesthetics", "Fillers", "fillers", ["fillers"]],
  ["con_lhr", "cat_aesthetics", "Laser Hair Removal", "laser_hair_removal", ["laser_hair_removal"]],
  ["con_tattoo", "cat_aesthetics", "Tattoo Removal", "tattoo_removal", ["tattoo_removal"]],
  ["con_mole_wart", "cat_aesthetics", "Mole / Wart Removal", "mole_wart_removal", ["mole_removal", "wart_removal"]],
  ["con_brow_lip", "cat_aesthetics", "Eyebrow / Lip Aesthetics", "eyebrow_lip_aesthetics", ["microblading", "lip_blushing"]],
] as const;

export type PriceDefault = {
  id: string; treatmentId: string; concernId?: string | null; pricingType: string; minPrice?: number | null; maxPrice?: number | null;
  unit?: string | null; displayText: string; pricingNote?: string | null; requiresAssessment?: boolean; approved?: boolean; approvalStatus?: "APPROVED" | "NEEDS_REVIEW";
};

export const treatmentPriceDefaults: PriceDefault[] = [
  { id: "price_hair_management", treatmentId: "hair_loss", concernId: "con_hair_fall", pricingType: "RANGE", minPrice: 3000, maxPrice: 6000, unit: "session", displayText: "₹3,000–₹6,000 per session", pricingNote: "PRP, GFC or medical management depending on the doctor’s plan", approved: true, approvalStatus: "APPROVED" },
  { id: "price_prp", treatmentId: "prp", concernId: "con_prp_gfc", pricingType: "RANGE", minPrice: 3000, maxPrice: 6000, unit: "session", displayText: "₹3,000–₹6,000 per session", approved: true, approvalStatus: "APPROVED" },
  { id: "price_gfc", treatmentId: "gfc", concernId: "con_prp_gfc", pricingType: "RANGE", minPrice: 3000, maxPrice: 6000, unit: "session", displayText: "₹3,000–₹6,000 per session", approved: true, approvalStatus: "APPROVED" },
  { id: "price_hair_transplant", treatmentId: "hair_transplant", concernId: "con_hair_transplant", pricingType: "PER_GRAFT", minPrice: 45, maxPrice: 45, unit: "graft", displayText: "₹45 per graft", pricingNote: "Total depends on the graft estimate after donor-area and baldness-pattern assessment", approved: true, approvalStatus: "APPROVED" },
  { id: "price_smp", treatmentId: "smp", concernId: "con_smp", pricingType: "FIXED", minPrice: 20000, maxPrice: 20000, unit: "procedure", displayText: "₹20,000", approved: true, approvalStatus: "APPROVED" },
  { id: "price_pigmentation", treatmentId: "pigmentation", concernId: "con_pigmentation", pricingType: "RANGE", minPrice: 3000, maxPrice: 7000, unit: "session", displayText: "₹3,000–₹7,000 per session", approved: true, approvalStatus: "APPROVED" },
  { id: "price_melasma", treatmentId: "melasma", concernId: "con_pigmentation", pricingType: "RANGE", minPrice: 3000, maxPrice: 7000, unit: "session", displayText: "₹3,000–₹7,000", approved: true, approvalStatus: "APPROVED" },
  { id: "price_acne", treatmentId: "acne", concernId: "con_acne", pricingType: "RANGE", minPrice: 4000, maxPrice: 6000, unit: "session", displayText: "₹4,000–₹6,000", approved: true, approvalStatus: "APPROVED" },
  { id: "price_acne_scars", treatmentId: "acne_scars", concernId: "con_acne_scars", pricingType: "RANGE", minPrice: 5000, maxPrice: 6000, unit: "session", displayText: "₹5,000–₹6,000", approved: true, approvalStatus: "APPROVED" },
  { id: "price_dull_skin", treatmentId: "dull_skin", concernId: "con_glow", pricingType: "RANGE", minPrice: 5000, maxPrice: 7000, unit: "session", displayText: "₹5,000–₹7,000", approved: true, approvalStatus: "APPROVED" },
  { id: "price_skin_glow", treatmentId: "skin_glow", concernId: "con_glow", pricingType: "RANGE", minPrice: 3000, maxPrice: 8000, unit: "session", displayText: "₹3,000–₹8,000", approved: true, approvalStatus: "APPROVED" },
  { id: "price_lhr_full_body", treatmentId: "laser_hair_removal_full_body", concernId: "con_lhr", pricingType: "PACKAGE", minPrice: 80000, maxPrice: 90000, unit: "package", displayText: "₹80,000–₹90,000 for the full-body package", approved: true, approvalStatus: "APPROVED" },
  { id: "price_lhr_full_face", treatmentId: "laser_hair_removal_full_face", concernId: "con_lhr", pricingType: "RANGE", minPrice: 5000, maxPrice: 6000, unit: "session", displayText: "₹5,000–₹6,000 for full-face laser hair removal", approved: true, approvalStatus: "APPROVED" },
  { id: "price_tattoo_removal", treatmentId: "tattoo_removal", concernId: "con_tattoo", pricingType: "RANGE", minPrice: 3000, maxPrice: 8000, unit: "session", displayText: "₹3,000–₹8,000 depending on size", approved: true, approvalStatus: "APPROVED" },
  { id: "price_botox", treatmentId: "botox", concernId: "con_botox", pricingType: "PER_UNIT", minPrice: 400, maxPrice: 400, unit: "unit", displayText: "₹400 per unit", approved: true, approvalStatus: "APPROVED" },
  { id: "price_microblading", treatmentId: "microblading", concernId: "con_brow_lip", pricingType: "FIXED", minPrice: 25000, maxPrice: 25000, unit: "procedure", displayText: "₹25,000", pricingNote: "Eyebrows, Microblading or Ombre Powder Brows", approved: true, approvalStatus: "APPROVED" },
  { id: "price_lip_blushing", treatmentId: "lip_blushing", concernId: "con_brow_lip", pricingType: "FIXED", minPrice: 25000, maxPrice: 25000, unit: "procedure", displayText: "₹25,000", approved: true, approvalStatus: "APPROVED" },
  { id: "price_mole_ambiguous", treatmentId: "mole_removal", concernId: "con_mole_wart", pricingType: "PER_UNIT", minPrice: 2500, maxPrice: 2500, unit: "mole", displayText: "₹2,500 per mole", pricingNote: "Ambiguous supplied row; doctor confirmation required", approved: false, approvalStatus: "NEEDS_REVIEW" },
  { id: "price_wart_ambiguous", treatmentId: "wart_removal", concernId: "con_mole_wart", pricingType: "PER_UNIT", minPrice: 1000, maxPrice: 1000, unit: "wart", displayText: "₹1,000 per wart", pricingNote: "Ambiguous supplied row; doctor confirmation required", approved: false, approvalStatus: "NEEDS_REVIEW" },
  { id: "price_facial_volume_review", treatmentId: "fillers", concernId: "con_fillers", pricingType: "ASSESSMENT_REQUIRED", displayText: "Doctor assessment required", pricingNote: "No approved patient-facing price", approved: false, approvalStatus: "NEEDS_REVIEW" },
];

export const approvedPriceDisclaimer = "Prices are approximate standard ranges. Final cost depends on doctor assessment and the treatment plan.";
