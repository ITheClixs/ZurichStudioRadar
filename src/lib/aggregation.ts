import {
  createEmptyAggregationSnapshot,
  getCachedAggregationSnapshot,
  readAggregationSnapshot,
  writeAggregationSnapshot
} from "@/lib/cache";
import { dedupeListings } from "@/lib/dedupe";
import { Logger } from "@/lib/logger";
import { sourceAdapters } from "@/lib/sources/registry";
import type { AggregationSnapshot, NormalizedListing, SourceRunResult } from "@/lib/types";

let activeRefresh: Promise<AggregationSnapshot> | null = null;

export async function refreshAggregationSnapshot(): Promise<AggregationSnapshot> {
  if (activeRefresh) {
    return activeRefresh;
  }

  activeRefresh = buildAggregationSnapshot();
  try {
    return await activeRefresh;
  } finally {
    activeRefresh = null;
  }
}

export async function getAggregationSnapshot(): Promise<AggregationSnapshot> {
  const cached = await getCachedAggregationSnapshot();
  if (cached.listings.length > 0 || cached.sourceStatus.length > 0) {
    return cached;
  }

  const fileSnapshot = await readAggregationSnapshot();
  if (fileSnapshot) {
    return getCachedAggregationSnapshot();
  }

  return cached;
}

async function buildAggregationSnapshot(): Promise<AggregationSnapshot> {
  const logger = new Logger({ scope: "aggregation" });
  const attemptedAt = new Date().toISOString();
  const previousSnapshot = await readAggregationSnapshot();
  const aggregatedListings: NormalizedListing[] = [];
  const sourceStatus: SourceRunResult[] = [];

  for (const adapter of sourceAdapters) {
    const result = await adapter.scrape(logger.child({ adapter: adapter.sourceName }));
    aggregatedListings.push(...result.listings);
    sourceStatus.push(result.run);
  }

  const reusedSources = reuseCachedListingsBySource({
    attemptedAt,
    previousSnapshot,
    aggregatedListings,
    sourceStatus
  });

  const snapshot: AggregationSnapshot = {
    generatedAt: attemptedAt,
    cacheAgeMinutes: 0,
    listings: dedupeListings(aggregatedListings),
    sourceStatus,
    staleCache: {
      active: reusedSources.length > 0,
      lastRefreshAttemptedAt: attemptedAt,
      reusedSources
    }
  };

  if (reusedSources.length > 0) {
    logger.warn("Live refresh reused cached listings for failed sources", {
      reusedSources: reusedSources.map((source) => ({
        sourceName: source.sourceName,
        listingCount: source.listingCount,
        cachedGeneratedAt: source.cachedGeneratedAt
      }))
    });
  }

  await writeAggregationSnapshot(snapshot);
  return snapshot;
}

function reuseCachedListingsBySource(input: {
  attemptedAt: string;
  previousSnapshot: AggregationSnapshot | null;
  aggregatedListings: NormalizedListing[];
  sourceStatus: SourceRunResult[];
}): AggregationSnapshot["staleCache"]["reusedSources"] {
  const { attemptedAt, previousSnapshot, aggregatedListings, sourceStatus } = input;
  if (!previousSnapshot || previousSnapshot.listings.length === 0) {
    return [];
  }

  const previousListingsBySource = new Map<string, NormalizedListing[]>();
  for (const listing of previousSnapshot.listings) {
    const bucket = previousListingsBySource.get(listing.sourceName) ?? [];
    bucket.push(listing);
    previousListingsBySource.set(listing.sourceName, bucket);
  }

  const liveSources = new Set(aggregatedListings.map((listing) => listing.sourceName));
  const reusedSources: AggregationSnapshot["staleCache"]["reusedSources"] = [];

  for (let index = 0; index < sourceStatus.length; index += 1) {
    const run = sourceStatus[index];
    const shouldReuse = (run.status === "error" || run.status === "unsupported") && !liveSources.has(run.sourceName);
    if (!shouldReuse) {
      continue;
    }

    const previousListings = previousListingsBySource.get(run.sourceName) ?? [];
    if (previousListings.length === 0) {
      continue;
    }

    aggregatedListings.push(...previousListings);
    const reason = `Showing ${previousListings.length} cached ${run.sourceName} listings from ${new Date(previousSnapshot.generatedAt).toLocaleString()} because the live refresh failed at ${new Date(attemptedAt).toLocaleString()}.`;
    reusedSources.push({
      sourceName: run.sourceName,
      listingCount: previousListings.length,
      cachedGeneratedAt: previousSnapshot.generatedAt,
      reason
    });
    sourceStatus[index] = {
      ...run,
      status: "partial",
      notes: [...run.notes, reason],
      usedCachedListings: true,
      cachedListingCount: previousListings.length,
      cachedGeneratedAt: previousSnapshot.generatedAt
    };
  }

  return reusedSources;
}
