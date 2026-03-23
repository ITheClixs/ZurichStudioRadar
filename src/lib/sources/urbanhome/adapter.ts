import { classifyStudioListing } from "@/lib/classification/studio";
import { validateZurichCanton } from "@/lib/classification/location";
import { fetchJson, fetchText, HttpRequestError } from "@/lib/http";
import type { Logger } from "@/lib/logger";
import type { SourceAdapter } from "@/lib/sources/base";
import {
  extractUrbanHomeListingDetail,
  extractUrbanHomeSearchSeeds,
  type UrbanHomeSearchSeed
} from "@/lib/sources/urbanhome/extract";
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

const URBANHOME_BASE_URL = "https://www.urbanhome.ch";
const URBANHOME_SEARCH_ENDPOINT = `${URBANHOME_BASE_URL}/Search/DoSearch`;
const SEARCH_PAGE_SIZE = 25;
const PAGE_DELAY_MS = readNonNegativeIntEnv("URBANHOME_PAGE_DELAY_MS", 120);
const DETAIL_DELAY_MS = readNonNegativeIntEnv("URBANHOME_DETAIL_DELAY_MS", 180);
const DETAIL_CONCURRENCY = readPositiveIntEnv("URBANHOME_DETAIL_CONCURRENCY", 2) ?? 2;
const MAX_PAGES = readPositiveIntEnv("URBANHOME_MAX_PAGES", 8) ?? 8;

interface UrbanHomeSearchResponse {
  Count: number;
  Rows: string;
  Success: boolean;
  Message: string | null;
}

type UrbanHomeCandidate = UrbanHomeSearchSeed & {
  municipality: string;
  postalCode: string | null;
  cantonConfidence: number;
  cantonReasons: NormalizedListing["cantonReasons"];
  roomCount: number | null;
};

export const urbanHomeAdapter: SourceAdapter = {
  sourceName: "UrbanHome",
  async scrape(logger) {
    const sourceLogger = logger.child({ source: "UrbanHome" });
    const startedAt = Date.now();
    const errors: string[] = [];
    const notes = [
      "Fetching public UrbanHome apartment search results for Canton Zurich.",
      "Restricting the live search to 1.0 to 1.5 room apartment listings before detail enrichment."
    ];

    try {
      const { seeds, scannedPages } = await fetchSearchSeeds(sourceLogger);
      const candidates = seeds
        .filter((seed) => toCandidate(seed) !== null)
        .map((seed) => toCandidate(seed))
        .filter((candidate): candidate is UrbanHomeCandidate => candidate !== null);

      sourceLogger.info("Prepared UrbanHome detail candidates", {
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

          const html = await fetchText(sourceLogger, candidate.sourceUrl, {}, `urbanhome-detail-${candidate.sourceListingId}`);
          const detail = extractUrbanHomeListingDetail(html);
          return buildNormalizedListing(candidate, detail);
        } catch (error) {
          const message = `Detail fetch failed for UrbanHome listing ${candidate.sourceListingId}: ${String(error)}`;
          sourceLogger.warn(message, { index });
          errors.push(message);
          return null;
        }
      });

      const accepted = detailedListings.filter((listing): listing is NormalizedListing => listing !== null);
      const run: SourceRunResult = {
        sourceName: "UrbanHome",
        status: errors.length > 0 ? "partial" : accepted.length > 0 ? "ok" : "error",
        fetchedCount: seeds.length,
        candidateCount: candidates.length,
        acceptedCount: accepted.length,
        durationMs: Date.now() - startedAt,
        errors,
        notes: [...notes, `Scanned ${scannedPages} UrbanHome result pages (${seeds.length} raw rows).`],
        retryAfterSeconds: null,
        nextRetryAt: null,
        usedCachedListings: false,
        cachedListingCount: 0,
        cachedGeneratedAt: null
      };

      return { listings: accepted, run };
    } catch (error) {
      const message = formatUrbanHomeSourceError(error);
      sourceLogger.error("UrbanHome adapter failed", { error: message });
      return {
        listings: [],
        run: {
          sourceName: "UrbanHome",
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

async function fetchSearchSeeds(logger: Logger): Promise<{ seeds: UrbanHomeSearchSeed[]; scannedPages: number }> {
  const seeds = new Map<string, UrbanHomeSearchSeed>();
  let scannedPages = 0;
  let totalCount: number | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (page > 0 && PAGE_DELAY_MS > 0) {
      await sleep(PAGE_DELAY_MS);
    }

    const skip = page * SEARCH_PAGE_SIZE;
    const response = await fetchSearchPage(skip, logger);
    if (!response.Success) {
      throw new Error(response.Message ?? "UrbanHome search endpoint returned an unsuccessful response.");
    }

    const pageSeeds = extractUrbanHomeSearchSeeds(response.Rows);
    for (const seed of pageSeeds) {
      seeds.set(seed.sourceListingId, seed);
    }

    scannedPages += 1;
    totalCount = response.Count;
    if (pageSeeds.length === 0 || skip + pageSeeds.length >= response.Count) {
      break;
    }
  }

  if (totalCount !== null && scannedPages >= MAX_PAGES && totalCount > scannedPages * SEARCH_PAGE_SIZE) {
    logger.warn("UrbanHome page scan hit the configured page cap", {
      scannedPages,
      totalCount,
      maxPages: MAX_PAGES
    });
  }

  return {
    seeds: Array.from(seeds.values()),
    scannedPages
  };
}

async function fetchSearchPage(skip: number, logger: Logger): Promise<UrbanHomeSearchResponse> {
  const body = new URLSearchParams({
    "settings[Category]": "1",
    "settings[MainType]": "2",
    "settings[Regions][]": "13",
    "settings[RoomsMin]": "1",
    "settings[RoomsMax]": "1.5",
    manual: "false",
    skip: String(skip),
    reset: skip === 0 ? "true" : "false",
    position: "0",
    iframe: "0",
    defaultTitle: "true",
    saveSettings: "false",
    code: ":)"
  }).toString();

  return fetchJson<UrbanHomeSearchResponse>(
    logger,
    URBANHOME_SEARCH_ENDPOINT,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        accept: "application/json, text/plain, */*"
      },
      body
    },
    `urbanhome-search-${skip}`
  );
}

function toCandidate(seed: UrbanHomeSearchSeed): UrbanHomeCandidate | null {
  const roomCount = inferRoomCount(seed.listingTypeLabel, seed.marketingTitle);
  const searchText = normalizeKey(`${seed.listingTypeLabel} ${seed.marketingTitle}`);
  const looksLikeStudio = searchText.includes(" studio ") || searchText.includes(" 1 5 zimmer ");

  if (roomCount !== null && roomCount > 1.5) {
    return null;
  }

  if (roomCount === null && !looksLikeStudio) {
    return null;
  }

  const location = validateZurichCanton({
    municipality: seed.municipality,
    postalCode: seed.postalCode,
    locationText: `${seed.address ?? ""} ${seed.municipality ?? ""}`
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
  candidate: UrbanHomeCandidate,
  detail: ReturnType<typeof extractUrbanHomeListingDetail>
): NormalizedListing | null {
  const roomCount = detail.roomCount ?? candidate.roomCount;
  const sizeSqm = detail.sizeSqm;
  const description = normalizeWhitespace(
    [candidate.marketingTitle, detail.title, detail.description].filter(Boolean).join(" ")
  );

  const studio = classifyStudioListing({
    title: detail.title || candidate.marketingTitle || candidate.listingTypeLabel,
    description,
    roomCount,
    objectCategory: "APARTMENT",
    objectType: candidate.listingTypeLabel,
    galleryCaptions: [candidate.marketingTitle],
    featureRows: detail.featureRows,
    sizeSqm
  });
  if (!studio.accepted) {
    return null;
  }

  const location = validateZurichCanton({
    municipality: detail.municipality ?? candidate.municipality,
    postalCode: detail.postalCode ?? candidate.postalCode,
    locationText: `${detail.address ?? candidate.address ?? ""} ${candidate.municipality}`
  });
  if (!location.accepted || !location.municipality) {
    return null;
  }

  const title = normalizeWhitespace(detail.title || candidate.marketingTitle || candidate.listingTypeLabel);
  const monthlyPrice = detail.monthlyPrice ?? candidate.monthlyPrice;
  const fingerprint = buildFingerprint([
    "urbanhome",
    location.municipality,
    location.postalCode,
    monthlyPrice,
    roomCount,
    sizeSqm,
    title
  ]);

  return {
    id: `urbanhome-${candidate.sourceListingId}`,
    internalId: `urbanhome-${candidate.sourceListingId}`,
    sourceName: "UrbanHome",
    originalListingUrl: candidate.sourceUrl,
    sourceListingId: candidate.sourceListingId,
    title,
    monthlyPrice,
    currency: "CHF",
    address: detail.address ?? candidate.address,
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
      galleryCaptions: [candidate.marketingTitle].filter(Boolean),
      flags: []
    }
  };
}

function inferRoomCount(...values: Array<string | null | undefined>): number | null {
  const source = values.filter(Boolean).join(" ");
  const normalized = normalizeWhitespace(source).replace(",", ".");
  const roomMatch = normalized.match(/(\d+(?:\.\d+)?)\s*zimmer/i);
  if (roomMatch) {
    return numberOrNull(roomMatch[1]);
  }

  if (normalizeKey(normalized).includes(" studio ")) {
    return 1;
  }

  return null;
}

function formatUrbanHomeSourceError(error: unknown): string {
  if (error instanceof HttpRequestError && error.status === 429) {
    const retryAfterSeconds = getRetryAfterSeconds(error);
    return [
      "UrbanHome is currently rate-limiting this machine.",
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
