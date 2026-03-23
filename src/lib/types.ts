export type SourceName = "Flatfox" | "UrbanHome";

export type ListingTypeClassification = "studio";

export type SourceHealthStatus = "ok" | "partial" | "error" | "unsupported";

export interface ClassificationReason {
  code: string;
  message: string;
  weight: number;
}

export interface SourceListingSeed {
  sourceName: SourceName;
  sourceUrl: string;
  sourceListingId: string;
  rawTitle: string;
  rawDescription: string;
  rawMunicipality: string | null;
  rawPostalCode: string | null;
  apiData: Record<string, unknown>;
}

export interface SourceListingDetail {
  sourceUrl: string;
  imageUrls: string[];
  detailText: string;
  galleryCaptions: string[];
  featureRows: Record<string, string>;
}

export interface NormalizedListing {
  id: string;
  internalId: string;
  sourceName: SourceName;
  originalListingUrl: string;
  sourceListingId: string;
  title: string;
  monthlyPrice: number | null;
  currency: string;
  address: string | null;
  municipality: string;
  postalCode: string | null;
  canton: "ZH";
  sizeSqm: number | null;
  roomCount: number | null;
  description: string;
  imageUrls: string[];
  listingTypeClassification: ListingTypeClassification;
  studioConfidence: number;
  studioReasons: ClassificationReason[];
  cantonConfidence: number;
  cantonReasons: ClassificationReason[];
  postedDate: string | null;
  scrapedTimestamp: string;
  deduplicationFingerprint: string;
  sourceMetadata: {
    featureRows: Record<string, string>;
    galleryCaptions: string[];
    flags: string[];
  };
}

export interface SourceRunResult {
  sourceName: SourceName;
  status: SourceHealthStatus;
  fetchedCount: number;
  candidateCount: number;
  acceptedCount: number;
  durationMs: number;
  errors: string[];
  notes: string[];
  retryAfterSeconds: number | null;
  nextRetryAt: string | null;
  usedCachedListings: boolean;
  cachedListingCount: number;
  cachedGeneratedAt: string | null;
}

export interface StaleSourceSnapshot {
  sourceName: SourceName;
  listingCount: number;
  cachedGeneratedAt: string;
  reason: string;
}

export interface StaleCacheState {
  active: boolean;
  lastRefreshAttemptedAt: string | null;
  reusedSources: StaleSourceSnapshot[];
}

export interface AggregationSnapshot {
  generatedAt: string;
  cacheAgeMinutes: number | null;
  listings: NormalizedListing[];
  sourceStatus: SourceRunResult[];
  staleCache: StaleCacheState;
}
