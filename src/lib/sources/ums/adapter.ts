import { classifyStudioListing } from "@/lib/classification/studio";
import { validateZurichCanton } from "@/lib/classification/location";
import { fetchText, HttpRequestError } from "@/lib/http";
import type { Logger } from "@/lib/logger";
import type { SourceAdapter } from "@/lib/sources/base";
import { extractUmsListingDetail, extractUmsSearchSeeds, type UmsSearchSeed } from "@/lib/sources/ums/extract";
import type { NormalizedListing, SourceRunResult } from "@/lib/types";
import {
  buildFingerprint,
  formatIsoDate,
  normalizeKey,
  normalizeWhitespace,
  numberOrNull,
  runWithConcurrency,
  sleep,
  truncateText
} from "@/lib/utils";

const UMS_BASE_URL = "https://www.ums.ch";
const SEARCH_REGION_URLS = [
  `${UMS_BASE_URL}/moeblierte-wohnungen/zuerich/`,
  `${UMS_BASE_URL}/moeblierte-wohnungen/winterthur/`
];
const PAGE_DELAY_MS = readNonNegativeIntEnv("UMS_PAGE_DELAY_MS", 150);
const DETAIL_DELAY_MS = readNonNegativeIntEnv("UMS_DETAIL_DELAY_MS", 200);
const DETAIL_CONCURRENCY = readPositiveIntEnv("UMS_DETAIL_CONCURRENCY", 2) ?? 2;
const MAX_PAGES_PER_REGION = readPositiveIntEnv("UMS_MAX_PAGES_PER_REGION", 8) ?? 8;

type UmsCandidate = UmsSearchSeed & {
  municipality: string;
  postalCode: string | null;
  cantonConfidence: number;
  cantonReasons: NormalizedListing["cantonReasons"];
  roomCount: number | null;
};

export const umsAdapter: SourceAdapter = {
  sourceName: "UMS",
  async scrape(logger) {
    const sourceLogger = logger.child({ source: "UMS" });
    const startedAt = Date.now();
    const errors: string[] = [];
    const notes = [
      "Fetching public UMS furnished-apartment listing pages for Zurich-region destinations.",
      "Keeping only true studio-like candidates before detail enrichment."
    ];

    try {
      const { seeds, scannedPages } = await fetchSearchSeeds(sourceLogger);
      const candidates = seeds
        .map((seed) => toCandidate(seed))
        .filter((candidate): candidate is UmsCandidate => candidate !== null);

      sourceLogger.info("Prepared UMS detail candidates", {
        seedCount: seeds.length,
        candidateCount: candidates.length,
        scannedPages
      });

      const detailedListings = await runWithConcurrency(candidates, DETAIL_CONCURRENCY, async (candidate, index) => {
        try {
          const batchIndex = Math.floor(index / DETAIL_CONCURRENCY);
          if (batchIndex > 0 && DETAIL_DELAY_MS > 0) {
            await sleep(batchIndex * DETAIL_DELAY_MS);
          }

          const html = await fetchText(sourceLogger, candidate.sourceUrl, {}, `ums-detail-${candidate.sourceListingId}`);
          const detail = extractUmsListingDetail(html);
          return buildNormalizedListing(candidate, detail);
        } catch (error) {
          const message = `Detail fetch failed for UMS listing ${candidate.sourceListingId}: ${String(error)}`;
          sourceLogger.warn(message, { index });
          errors.push(message);
          return null;
        }
      });

      const accepted = detailedListings.filter((listing): listing is NormalizedListing => listing !== null);
      const run: SourceRunResult = {
        sourceName: "UMS",
        status: errors.length > 0 ? "partial" : accepted.length > 0 ? "ok" : "error",
        fetchedCount: seeds.length,
        candidateCount: candidates.length,
        acceptedCount: accepted.length,
        durationMs: Date.now() - startedAt,
        errors,
        notes: [
          ...notes,
          `Scanned ${scannedPages} UMS result pages across ${SEARCH_REGION_URLS.length} destination feeds.`
        ],
        retryAfterSeconds: null,
        nextRetryAt: null,
        usedCachedListings: false,
        cachedListingCount: 0,
        cachedGeneratedAt: null
      };

      return { listings: accepted, run };
    } catch (error) {
      const message = formatUmsSourceError(error);
      sourceLogger.error("UMS adapter failed", { error: message });
      return {
        listings: [],
        run: {
          sourceName: "UMS",
          status: "error",
          fetchedCount: 0,
          candidateCount: 0,
          acceptedCount: 0,
          durationMs: Date.now() - startedAt,
          errors: [message],
          notes,
          retryAfterSeconds: getRetryAfterSeconds(error),
          nextRetryAt: buildNextRetryAt(error),
          usedCachedListings: false,
          cachedListingCount: 0,
          cachedGeneratedAt: null
        }
      };
    }
  }
};

async function fetchSearchSeeds(logger: Logger): Promise<{ seeds: UmsSearchSeed[]; scannedPages: number }> {
  const dedupedSeeds = new Map<string, UmsSearchSeed>();
  let scannedPages = 0;

  for (const regionUrl of SEARCH_REGION_URLS) {
    for (let page = 0; page < MAX_PAGES_PER_REGION; page += 1) {
      if (scannedPages > 0 && PAGE_DELAY_MS > 0) {
        await sleep(PAGE_DELAY_MS);
      }

      const url = page === 0 ? regionUrl : `${regionUrl}?p=${page}`;
      const html = await fetchText(logger, url, {}, `ums-search-${new URL(regionUrl).pathname}-page-${page}`);
      const pageSeeds = extractUmsSearchSeeds(html);
      scannedPages += 1;

      for (const seed of pageSeeds) {
        dedupedSeeds.set(seed.sourceListingId, seed);
      }

      if (pageSeeds.length === 0) {
        break;
      }
    }
  }

  return {
    seeds: Array.from(dedupedSeeds.values()),
    scannedPages
  };
}

function toCandidate(seed: UmsSearchSeed): UmsCandidate | null {
  const roomCount = inferRoomCount(seed.listingTypeLabel, seed.title);
  const searchText = normalizeKey(`${seed.title} ${seed.listingTypeLabel} ${seed.locationLabel}`);
  const looksLikeStudio = searchText.includes(" studio ") || searchText.includes(" wohnatelier ");

  if (roomCount !== null && roomCount > 1.5) {
    return null;
  }

  if (roomCount === null && !looksLikeStudio) {
    return null;
  }

  const location = validateZurichCanton({
    municipality: seed.locationLabel,
    postalCode: null,
    locationText: seed.locationLabel
  });
  if (!location.accepted || !location.municipality) {
    return null;
  }

  return {
    ...seed,
    municipality: location.municipality,
    postalCode: location.postalCode,
    cantonConfidence: location.confidence,
    cantonReasons: location.reasons,
    roomCount
  };
}

function buildNormalizedListing(
  candidate: UmsCandidate,
  detail: ReturnType<typeof extractUmsListingDetail>
): NormalizedListing | null {
  const roomCount = detail.roomCount ?? candidate.roomCount;
  const sizeSqm = detail.sizeSqm;
  const description = normalizeWhitespace(
    [detail.description, detail.title, candidate.title].filter(Boolean).join(" ")
  );

  const studio = classifyStudioListing({
    title: detail.title || candidate.title || candidate.listingTypeLabel,
    description,
    roomCount,
    objectCategory: "APARTMENT",
    objectType: candidate.listingTypeLabel,
    galleryCaptions: [candidate.title],
    featureRows: detail.featureRows,
    sizeSqm
  });
  if (!studio.accepted) {
    return null;
  }

  const location = validateZurichCanton({
    municipality: candidate.municipality,
    postalCode: candidate.postalCode,
    locationText: candidate.locationLabel
  });
  if (!location.accepted || !location.municipality) {
    return null;
  }

  const title = normalizeWhitespace(detail.title || candidate.title || truncateText(candidate.listingTypeLabel, 120));
  const monthlyPrice = detail.monthlyPrice ?? candidate.monthlyPrice;
  const fingerprint = buildFingerprint([
    "ums",
    location.municipality,
    monthlyPrice,
    roomCount,
    sizeSqm,
    title
  ]);

  return {
    id: `ums-${candidate.sourceListingId}`,
    internalId: `ums-${candidate.sourceListingId}`,
    sourceName: "UMS",
    originalListingUrl: candidate.sourceUrl,
    sourceListingId: candidate.sourceListingId,
    title,
    monthlyPrice,
    currency: "CHF",
    address: null,
    municipality: location.municipality,
    postalCode: location.postalCode,
    canton: "ZH",
    sizeSqm,
    roomCount,
    description,
    imageUrls: detail.imageUrls.length > 0 ? detail.imageUrls : candidate.imageUrl ? [candidate.imageUrl] : [],
    listingTypeClassification: "studio",
    studioConfidence: studio.confidence,
    studioReasons: studio.reasons,
    cantonConfidence: location.confidence,
    cantonReasons: location.reasons,
    postedDate: null,
    scrapedTimestamp: formatIsoDate(new Date()),
    deduplicationFingerprint: fingerprint,
    sourceMetadata: {
      featureRows: detail.featureRows,
      galleryCaptions: [candidate.title].filter(Boolean),
      flags: candidate.availabilityText ? [candidate.availabilityText] : []
    }
  };
}

function inferRoomCount(...values: Array<string | null | undefined>): number | null {
  const joined = values.filter(Boolean).join(" ").replace(",", ".");
  const roomMatch = joined.match(/(\d+(?:\.\d+)?)\s*zimmer/i);
  if (roomMatch) {
    return numberOrNull(roomMatch[1]);
  }

  if (normalizeKey(joined).includes(" studio ")) {
    return 1;
  }

  return null;
}

function formatUmsSourceError(error: unknown): string {
  if (error instanceof HttpRequestError && error.status === 429) {
    const retryAfterSeconds = getRetryAfterSeconds(error);
    return [
      "UMS is currently rate-limiting this machine.",
      retryAfterSeconds !== null ? `Retry-After is about ${retryAfterSeconds}s.` : null
    ]
      .filter(Boolean)
      .join(" ");
  }

  return String(error);
}

function buildNextRetryAt(error: unknown): string | null {
  const retryAfterSeconds = getRetryAfterSeconds(error);
  return retryAfterSeconds !== null ? new Date(Date.now() + retryAfterSeconds * 1000).toISOString() : null;
}

function getRetryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof HttpRequestError) || error.retryAfterMs === null) {
    return null;
  }

  return Math.max(1, Math.round(error.retryAfterMs / 1000));
}

function readPositiveIntEnv(name: string, fallback: number | null = null): number | null {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readNonNegativeIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}
