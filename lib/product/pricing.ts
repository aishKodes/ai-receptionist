import { ready } from "@/lib/services/repository";
import { approvedPriceDisclaimer } from "./defaults";

export type ApprovedPrice = {
  id: string;
  treatmentId: string;
  pricingType: string;
  minPrice: number | null;
  maxPrice: number | null;
  unit: string | null;
  displayText: string;
  pricingNote: string | null;
};

const aliases: Array<[string, RegExp]> = [
  [
    "laser_hair_removal_full_body",
    /full[ -]?body.*(?:laser|hair removal)|(?:laser|hair removal).*full[ -]?body/i,
  ],
  [
    "laser_hair_removal_full_face",
    /full[ -]?face.*(?:laser|hair removal)|(?:laser|hair removal).*full[ -]?face/i,
  ],
  ["hair_transplant", /hair\s*transplant|graft/i],
  ["prp", /\bprp\b/i],
  ["gfc", /\bgfc\b/i],
  ["smp", /\bsmp\b|scalp micropigmentation|scalp visibility/i],
  ["acne_scars", /acne\s*scars?|pimple\s*scars?/i],
  ["acne", /\bacne\b|pimples?/i],
  ["melasma", /\bmelasma\b/i],
  ["pigmentation", /pigmentation|dark spots?|uneven tone/i],
  ["dull_skin", /dull\s*skin/i],
  ["skin_glow", /skin\s*glow|brightening|glow treatment/i],
  ["tattoo_removal", /tattoo\s*removal/i],
  ["botox", /\bbotox\b/i],
  ["microblading", /microblading|ombre powder brows?|eyebrows?/i],
  ["lip_blushing", /lip\s*blushing/i],
  ["mole_removal", /mole\s*removal|per mole/i],
  ["wart_removal", /wart\s*removal|per wart/i],
  ["fillers", /fillers?|facial volume|lip fillers?/i],
  ["hair_loss", /hair\s*(?:fall|loss|thinning)|medical management/i],
];

export function pricingRequested(message: string) {
  return /\b(?:price|cost|charges?|fees?|rate|how much|kitna|kharcha|dam)\b|(?:कीमत|खर्च|कितना|ଦାମ|ଖର୍ଚ୍ଚ)/iu.test(
    message,
  );
}

export function treatmentForPrice(
  message: string,
  currentTreatment?: string | null,
) {
  return (
    aliases.find(([, pattern]) => pattern.test(message))?.[0] ||
    currentTreatment ||
    null
  );
}

export function getApprovedPrice(
  treatmentId: string | null | undefined,
): ApprovedPrice | null {
  if (!treatmentId) return null;
  const row = ready()
    .prepare(
      `SELECT id,treatment_id AS treatmentId,pricing_type AS pricingType,min_price AS minPrice,max_price AS maxPrice,unit,display_text AS displayText,pricing_note AS pricingNote
    FROM treatment_prices WHERE treatment_id=? AND active=1 AND approval_status='APPROVED' AND approved_for_patient_display=1 ORDER BY created_at DESC LIMIT 1`,
    )
    .get(treatmentId) as ApprovedPrice | undefined;
  return row || null;
}

function consultationOffer(language: string) {
  if (language === "HINDI") return "क्या मैं उपलब्ध परामर्श समय देखूँ?";
  if (language === "HINGLISH")
    return "Kya main available consultation times check karun?";
  if (language === "ODIA") return "ମୁଁ ଉପଲବ୍ଧ ପରାମର୍ଶ ସମୟ ଯାଞ୍ଚ କରିଦେବି କି?";
  return "Would you like me to check the available consultation times?";
}

export function approvedPriceReply(price: ApprovedPrice, language: string) {
  const detail = price.pricingNote ? ` ${price.pricingNote}.` : "";
  if (language === "HINGLISH")
    return `Radiance Clinics mein current estimate ${price.displayText} hai.${detail} Final cost doctor assessment aur treatment plan par depend karti hai. ${consultationOffer(language)}`;
  if (language === "HINDI")
    return `Radiance Clinics में वर्तमान अनुमान ${price.displayText} है।${detail} अंतिम लागत डॉक्टर की जाँच और उपचार योजना पर निर्भर करती है। ${consultationOffer(language)}`;
  if (language === "ODIA")
    return `Radiance Clinics ରେ ବର୍ତ୍ତମାନ ଆନୁମାନିକ ମୂଲ୍ୟ ${price.displayText}।${detail} ଅନ୍ତିମ ଖର୍ଚ୍ଚ ଡାକ୍ତରଙ୍କ ପରୀକ୍ଷା ଓ ଚିକିତ୍ସା ଯୋଜନା ଉପରେ ନିର୍ଭର କରେ। ${consultationOffer(language)}`;
  return `At Radiance Clinics, the current estimate is ${price.displayText}.${detail} ${approvedPriceDisclaimer} ${consultationOffer(language)}`;
}

export function priceResponse(
  message: string,
  currentTreatment: string | null | undefined,
  language: string,
) {
  if (!pricingRequested(message)) return null;
  const treatmentId = treatmentForPrice(message, currentTreatment);
  const price = getApprovedPrice(treatmentId);
  return price
    ? { price, treatmentId, reply: approvedPriceReply(price, language) }
    : { price: null, treatmentId, reply: null };
}

export function getApprovedKnowledgeSnapshot() {
  const db = ready();
  return {
    treatments: db
      .prepare(
        "SELECT name,slug,category,description,approved_response_guidance AS guidance,benefits_json AS benefitsJson,conversation_options_json AS optionsJson FROM treatments WHERE active=1 AND approval_status='APPROVED' ORDER BY category,name",
      )
      .all(),
    concerns: db
      .prepare(
        "SELECT name,slug,approved_explanation AS explanation,benefits_json AS benefitsJson,conversation_options_json AS optionsJson FROM concerns WHERE active=1 AND status='APPROVED' ORDER BY sort_order,name",
      )
      .all(),
    prices: db
      .prepare(
        "SELECT treatment_id AS treatmentId,pricing_type AS pricingType,display_text AS displayText,pricing_note AS pricingNote FROM treatment_prices WHERE active=1 AND approval_status='APPROVED' AND approved_for_patient_display=1 ORDER BY treatment_id",
      )
      .all(),
    guidance: db
      .prepare(
        "SELECT title,item_type AS itemType,treatment_id AS treatmentId,concern_id AS concernId,content FROM knowledge_items WHERE active=1 AND approval_status='APPROVED' ORDER BY updated_at DESC,created_at DESC LIMIT 100",
      )
      .all(),
  };
}
