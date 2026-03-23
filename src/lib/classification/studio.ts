import type { ClassificationReason } from "@/lib/types";
import { clamp, normalizeKey } from "@/lib/utils";

const NEGATIVE_PATTERNS = [
  " wg ",
  "wg-zimmer",
  "shared flat",
  "room in a shared flat",
  "room in shared apartment",
  "shared apartment",
  "roommate",
  "gemeinschaftskuche",
  "gemeinschaftskueche",
  "gemeinschaftsbad",
  "shared kitchen",
  "shared bathroom",
  "mitbenutzung",
  "coliving",
  "co living",
  "single room",
  "student room"
];

const STUDIO_PATTERNS = [
  "studio apartment",
  " studio ",
  "einzimmerwohnung",
  "1 zimmer wohnung",
  "1-zimmerwohnung",
  "1 room apartment",
  "1-room apartment",
  "1 room flat",
  "1-room flat"
];

const APARTMENT_PATTERNS = [" apartment ", " wohnung ", " flat ", "apartment", "wohnung"];

const BATHROOM_PATTERNS = [
  " bathroom ",
  " badezimmer ",
  " dusche ",
  " shower ",
  " wc ",
  " bad ",
  " eigenes bad",
  "private bathroom"
];

const KITCHEN_PATTERNS = [
  " kitchen ",
  " kitchenette ",
  " kuche ",
  " kuche",
  " kochnische ",
  " private kitchen",
  " own kitchen",
  " eigenes kuche",
  " eigene kuche",
  " cooking area",
  " cooktop ",
  " induktion ",
  " kochen "
];

export interface StudioClassificationInput {
  title: string;
  description: string;
  roomCount: number | null;
  objectCategory: string | null;
  objectType: string | null;
  galleryCaptions: string[];
  featureRows: Record<string, string>;
  sizeSqm: number | null;
}

export interface StudioClassificationResult {
  accepted: boolean;
  confidence: number;
  reasons: ClassificationReason[];
}

export function classifyStudioListing(input: StudioClassificationInput): StudioClassificationResult {
  const reasons: ClassificationReason[] = [];
  const combinedText = normalizeKey(
    [
      input.title,
      input.description,
      input.objectCategory ?? "",
      input.objectType ?? "",
      ...input.galleryCaptions,
      ...Object.entries(input.featureRows).flatMap(([key, value]) => [key, value])
    ].join(" ")
  );
  const searchableText = ` ${combinedText} `;

  if ((input.objectCategory ?? "") !== "APARTMENT") {
    reasons.push({
      code: "not_apartment",
      message: "Source object category is not apartment.",
      weight: -1
    });
    return { accepted: false, confidence: 0, reasons };
  }

  if (input.roomCount === null || input.roomCount > 1.5) {
    reasons.push({
      code: "room_count_too_large",
      message: "Listing exceeds the 1.5-room threshold used for strict studio screening.",
      weight: -1
    });
    return { accepted: false, confidence: 0, reasons };
  }

  for (const negativePattern of NEGATIVE_PATTERNS) {
    if (matchesPattern(searchableText, negativePattern)) {
      reasons.push({
        code: "shared_negative_signal",
        message: `Listing contains shared-housing signal: ${negativePattern.trim()}.`,
        weight: -1
      });
      return { accepted: false, confidence: 0, reasons };
    }
  }

  const hasStudioPhrase = STUDIO_PATTERNS.some((pattern) => matchesPattern(searchableText, pattern));
  const hasApartmentPhrase = APARTMENT_PATTERNS.some((pattern) =>
    matchesPattern(searchableText, pattern)
  );
  const hasBathroom = BATHROOM_PATTERNS.some((pattern) => matchesPattern(searchableText, pattern));
  const hasKitchen = KITCHEN_PATTERNS.some((pattern) => matchesPattern(searchableText, pattern));

  if (hasStudioPhrase) {
    reasons.push({
      code: "studio_phrase",
      message: "Listing contains an explicit studio or one-room apartment phrase.",
      weight: 0.42
    });
  }

  if (hasApartmentPhrase) {
    reasons.push({
      code: "apartment_phrase",
      message: "Listing text identifies the unit as an apartment or flat.",
      weight: 0.15
    });
  }

  reasons.push({
    code: "room_count_small",
    message: `Room count ${input.roomCount} is within the strict studio threshold.`,
    weight: 0.18
  });

  if (input.sizeSqm !== null && input.sizeSqm <= 45) {
    reasons.push({
      code: "small_floor_area",
      message: `Living area ${input.sizeSqm} m² is consistent with a studio-sized unit.`,
      weight: 0.08
    });
  }

  if (hasBathroom) {
    reasons.push({
      code: "bathroom_evidence",
      message: "Listing text or image captions mention a bathroom or shower.",
      weight: 0.18
    });
  } else {
    reasons.push({
      code: "bathroom_missing",
      message: "No explicit private bathroom evidence was found.",
      weight: -1
    });
    return { accepted: false, confidence: 0, reasons };
  }

  if (hasKitchen) {
    reasons.push({
      code: "kitchen_evidence",
      message: "Listing text or image captions mention a kitchen or kitchenette.",
      weight: 0.2
    });
  } else {
    reasons.push({
      code: "kitchen_missing",
      message: "No explicit private kitchen or kitchenette evidence was found.",
      weight: -1
    });
    return { accepted: false, confidence: 0, reasons };
  }

  if (!hasStudioPhrase && !hasApartmentPhrase) {
    reasons.push({
      code: "studio_ambiguous",
      message: "Studio status remains ambiguous because the listing never explicitly presents itself as an apartment-type studio unit.",
      weight: -1
    });
    return { accepted: false, confidence: 0, reasons };
  }

  const confidence = clamp(reasons.reduce((sum, reason) => sum + reason.weight, 0), 0, 1);
  return {
    accepted: confidence >= 0.82,
    confidence,
    reasons
  };
}

function matchesPattern(searchableText: string, pattern: string): boolean {
  const normalizedPattern = normalizeKey(pattern);
  if (!normalizedPattern) {
    return false;
  }

  return searchableText.includes(` ${normalizedPattern} `);
}
