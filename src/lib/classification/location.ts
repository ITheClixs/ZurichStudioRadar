import { ZURICH_LOCALITY_ALIASES, ZURICH_MUNICIPALITIES } from "@/lib/canton-zurich";
import type { ClassificationReason } from "@/lib/types";
import { clamp, normalizeKey, stringOrNull } from "@/lib/utils";

const municipalityIndex = new Map<string, string>();

for (const municipality of ZURICH_MUNICIPALITIES) {
  municipalityIndex.set(normalizeKey(municipality), municipality);
}

for (const [locality, municipality] of Object.entries(ZURICH_LOCALITY_ALIASES)) {
  municipalityIndex.set(normalizeKey(locality), municipality);
}

export interface CantonValidationResult {
  accepted: boolean;
  municipality: string | null;
  postalCode: string | null;
  confidence: number;
  reasons: ClassificationReason[];
}

export function validateZurichCanton(input: {
  municipality: string | null;
  postalCode: string | null;
  locationText?: string;
}): CantonValidationResult {
  const reasons: ClassificationReason[] = [];
  const postalCode = stringOrNull(input.postalCode);
  const exact = resolveMunicipality(input.municipality);

  if (exact) {
    reasons.push({
      code: "municipality_exact",
      message: `Municipality matches official Canton Zurich municipality list: ${exact}.`,
      weight: 0.72
    });

    if (postalCode) {
      reasons.push({
        code: "postal_present",
        message: `Postal code ${postalCode} is present on the source listing.`,
        weight: 0.08
      });
    }

    return {
      accepted: true,
      municipality: exact,
      postalCode,
      confidence: clamp(sumWeights(reasons), 0, 1),
      reasons
    };
  }

  const fromText = resolveMunicipality(input.locationText);
  if (fromText) {
    reasons.push({
      code: "municipality_from_text",
      message: `Municipality inferred from listing location text as ${fromText}.`,
      weight: 0.64
    });

    if (postalCode) {
      reasons.push({
        code: "postal_present",
        message: `Postal code ${postalCode} is present on the source listing.`,
        weight: 0.06
      });
    }

    return {
      accepted: true,
      municipality: fromText,
      postalCode,
      confidence: clamp(sumWeights(reasons), 0, 1),
      reasons
    };
  }

  reasons.push({
    code: "location_unverified",
    message: "Location could not be matched to an official municipality or locality inside the Canton of Zurich.",
    weight: -1
  });

  return {
    accepted: false,
    municipality: null,
    postalCode,
    confidence: 0,
    reasons
  };
}

function resolveMunicipality(value: string | null | undefined): string | null {
  const source = stringOrNull(value);
  if (!source) {
    return null;
  }

  const normalized = normalizeKey(source);
  if (municipalityIndex.has(normalized)) {
    return municipalityIndex.get(normalized) ?? null;
  }

  for (const municipality of ZURICH_MUNICIPALITIES) {
    const municipalityKey = normalizeKey(municipality);
    const pattern = new RegExp(`(^| )${escapeRegExp(municipalityKey)}($| )`);
    if (pattern.test(normalized)) {
      return municipality;
    }
  }

  for (const [locality, municipality] of Object.entries(ZURICH_LOCALITY_ALIASES)) {
    const localityKey = normalizeKey(locality);
    const pattern = new RegExp(`(^| )${escapeRegExp(localityKey)}($| )`);
    if (pattern.test(normalized)) {
      return municipality;
    }
  }

  return null;
}

function sumWeights(reasons: ClassificationReason[]): number {
  return reasons.reduce((total, reason) => total + reason.weight, 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
