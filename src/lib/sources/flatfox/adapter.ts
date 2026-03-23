import { classifyStudioListing } from "@/lib/classification/studio";
import { validateZurichCanton } from "@/lib/classification/location";
import { fetchJson, fetchText } from "@/lib/http";
import { Logger } from "@/lib/logger";
import type { SourceAdapter } from "@/lib/sources/base";
import { extractFlatfoxListingDetail } from "@/lib/sources/flatfox/extract";
import type { NormalizedListing, SourceRunResult } from "@/lib/types";
import {
  buildFingerprint,
  formatIsoDate,
  normalizeWhitespace,
  numberOrNull,
  runWithConcurrency,
  stringOrNull,
  truncateText
} from "@/lib/utils";

const FLATFOX_BASE_URL = "https://flatfox.ch";
const FLATFOX_PUBLIC_LISTING_ENDPOINT = `${FLATFOX_BASE_URL}/api/v1/public-listing/`;
const PAGE_SIZE = 100;

interface FlatfoxApiListing {
  pk: number;
  url: string;
  offer_type: string | null;
  object_category: string | null;
  object_type: string | null;
  public_title: string | null;
  short_title: string | null;
  description_title: string | null;
  description: string | null;
  surface_living: number | string | null;
  number_of_rooms: number | string | null;
  city: string | null;
  zipcode: string | null;
  public_address: string | null;
  street: string | null;
  rent_gross: number | null;
  rent_net: number | null;
  rent_charges: number | null;
  price_display: number | null;
  published: string | null;
  is_furnished: boolean | null;
  is_temporary: boolean | null;
  attributes: Array<{ name: string }> | null;
}

interface FlatfoxPageResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: FlatfoxApiListing[];
}

type FlatfoxCandidate = {
  apiListing: FlatfoxApiListing;
  municipality: string;
  postalCode: string | null;
  cantonConfidence: number;
  cantonReasons: NormalizedListing["cantonReasons"];
};

export const flatfoxAdapter: SourceAdapter = {
  sourceName: "Flatfox",
  async scrape(logger) {
    const sourceLogger = logger.child({ source: "Flatfox" });
    const startedAt = Date.now();
    const errors: string[] = [];
    const notes = [
      "Fetching public listing pages from Flatfox API.",
      "Fetching detail HTML only for likely Zurich studio candidates."
    ];

    try {
      const apiListings = await fetchAllPublicListings(sourceLogger);
      sourceLogger.info("Fetched Flatfox listing pages", { count: apiListings.length });

      const cantonCandidates = apiListings
        .filter(isApartmentRental)
        .map((apiListing) => toCandidate(apiListing))
        .filter((candidate): candidate is FlatfoxCandidate => candidate !== null);

      const likelyCandidates = cantonCandidates.filter((candidate) => {
        const roomCount = numberOrNull(candidate.apiListing.number_of_rooms);
        const text = normalizeWhitespace(
          `${candidate.apiListing.public_title ?? ""} ${candidate.apiListing.description ?? ""}`
        ).toLowerCase();
        return (
          roomCount !== null &&
          roomCount <= 1.5 &&
          !text.includes("shared flat") &&
          !text.includes("wg") &&
          !text.includes("room in a shared flat")
        );
      });

      sourceLogger.info("Prepared Flatfox candidates", {
        cantonCandidates: cantonCandidates.length,
        likelyCandidates: likelyCandidates.length
      });

      const detailedListings = await runWithConcurrency(
        likelyCandidates,
        4,
        async (candidate, index) => {
          try {
            const html = await fetchText(
              sourceLogger,
              `${FLATFOX_BASE_URL}${candidate.apiListing.url}`,
              {},
              `flatfox-detail-${candidate.apiListing.pk}`
            );
            const detail = extractFlatfoxListingDetail(html);
            return buildNormalizedListing(candidate, detail);
          } catch (error) {
            const message = `Detail fetch failed for Flatfox listing ${candidate.apiListing.pk}: ${String(error)}`;
            sourceLogger.warn(message, { index });
            errors.push(message);
            return null;
          }
        }
      );

      const accepted = detailedListings.filter(
        (listing): listing is NormalizedListing => listing !== null
      );

      const run: SourceRunResult = {
        sourceName: "Flatfox",
        status: accepted.length > 0 ? "ok" : "error",
        fetchedCount: apiListings.length,
        candidateCount: likelyCandidates.length,
        acceptedCount: accepted.length,
        durationMs: Date.now() - startedAt,
        errors,
        notes
      };

      return { listings: accepted, run };
    } catch (error) {
      const message = String(error);
      sourceLogger.error("Flatfox adapter failed", { error: message });
      return {
        listings: [],
        run: {
          sourceName: "Flatfox",
          status: "error",
          fetchedCount: 0,
          candidateCount: 0,
          acceptedCount: 0,
          durationMs: Date.now() - startedAt,
          errors: [message],
          notes
        }
      };
    }
  }
};

async function fetchAllPublicListings(logger: Logger): Promise<FlatfoxApiListing[]> {
  const firstPage = await fetchPage(0, logger);
  const totalPages = Math.ceil(firstPage.count / PAGE_SIZE);
  const offsets = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => (index + 1) * PAGE_SIZE);

  const remainingPages = await runWithConcurrency(offsets, 5, async (offset) => fetchPage(offset, logger));
  const allListings = [firstPage, ...remainingPages].flatMap((page) => page.results);
  const deduped = new Map<number, FlatfoxApiListing>();

  for (const listing of allListings) {
    deduped.set(listing.pk, listing);
  }

  return Array.from(deduped.values());
}

async function fetchPage(offset: number, logger: Logger): Promise<FlatfoxPageResponse> {
  const url = `${FLATFOX_PUBLIC_LISTING_ENDPOINT}?limit=${PAGE_SIZE}&offset=${offset}`;
  return fetchJson<FlatfoxPageResponse>(logger, url, {}, `flatfox-page-${offset}`);
}

function isApartmentRental(listing: FlatfoxApiListing): boolean {
  return listing.offer_type === "RENT" && listing.object_category === "APARTMENT";
}

function toCandidate(apiListing: FlatfoxApiListing): FlatfoxCandidate | null {
  const location = validateZurichCanton({
    municipality: stringOrNull(apiListing.city),
    postalCode: stringOrNull(apiListing.zipcode),
    locationText: `${apiListing.public_address ?? ""} ${apiListing.public_title ?? ""}`
  });

  if (!location.accepted || !location.municipality) {
    return null;
  }

  return {
    apiListing,
    municipality: location.municipality,
    postalCode: location.postalCode,
    cantonConfidence: location.confidence,
    cantonReasons: location.reasons
  };
}

function buildNormalizedListing(
  candidate: FlatfoxCandidate,
  detail: ReturnType<typeof extractFlatfoxListingDetail>
): NormalizedListing | null {
  const api = candidate.apiListing;
  const roomCount = numberOrNull(api.number_of_rooms);
  const sizeSqm = numberOrNull(api.surface_living);
  const mergedDescription = normalizeWhitespace(
    [api.description ?? "", detail.description].filter(Boolean).join(" ")
  );

  const studio = classifyStudioListing({
    title: api.public_title ?? api.short_title ?? "",
    description: mergedDescription,
    roomCount,
    objectCategory: api.object_category,
    objectType: api.object_type,
    galleryCaptions: detail.galleryCaptions,
    featureRows: detail.featureRows,
    sizeSqm
  });

  if (!studio.accepted) {
    return null;
  }

  const title = normalizeWhitespace(
    api.description_title ?? api.short_title ?? truncateText(api.public_title ?? "Studio apartment", 120)
  );
  const monthlyPrice = api.rent_gross ?? api.price_display ?? api.rent_net ?? null;
  const originalListingUrl = `${FLATFOX_BASE_URL}${api.url}`;
  const sourceListingId = String(api.pk);
  const fingerprint = buildFingerprint([
    "flatfox",
    candidate.municipality,
    candidate.postalCode,
    monthlyPrice,
    roomCount,
    sizeSqm,
    title
  ]);

  return {
    id: `flatfox-${sourceListingId}`,
    internalId: `flatfox-${sourceListingId}`,
    sourceName: "Flatfox",
    originalListingUrl,
    sourceListingId,
    title,
    monthlyPrice,
    currency: "CHF",
    address: stringOrNull(api.public_address) ?? stringOrNull(api.street),
    municipality: candidate.municipality,
    postalCode: candidate.postalCode,
    canton: "ZH",
    sizeSqm,
    roomCount,
    description: mergedDescription,
    imageUrls: detail.imageUrls,
    listingTypeClassification: "studio",
    studioConfidence: studio.confidence,
    studioReasons: studio.reasons,
    cantonConfidence: candidate.cantonConfidence,
    cantonReasons: candidate.cantonReasons,
    postedDate: stringOrNull(api.published),
    scrapedTimestamp: formatIsoDate(new Date()),
    deduplicationFingerprint: fingerprint,
    sourceMetadata: {
      featureRows: detail.featureRows,
      galleryCaptions: detail.galleryCaptions,
      flags: [
        api.is_furnished ? "furnished" : "",
        api.is_temporary ? "temporary" : "",
        ...(api.attributes ?? []).map((attribute) => attribute.name)
      ].filter(Boolean)
    }
  };
}
