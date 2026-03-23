import { getCachedAggregationSnapshot, readAggregationSnapshot, writeAggregationSnapshot } from "@/lib/cache";
import { dedupeListings } from "@/lib/dedupe";
import { Logger } from "@/lib/logger";
import { sourceAdapters } from "@/lib/sources/registry";
import type { AggregationSnapshot } from "@/lib/types";

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
  const aggregatedListings = [];
  const sourceStatus = [];

  for (const adapter of sourceAdapters) {
    const result = await adapter.scrape(logger.child({ adapter: adapter.sourceName }));
    aggregatedListings.push(...result.listings);
    sourceStatus.push(result.run);
  }

  const snapshot: AggregationSnapshot = {
    generatedAt: new Date().toISOString(),
    cacheAgeMinutes: 0,
    listings: dedupeListings(aggregatedListings),
    sourceStatus
  };

  await writeAggregationSnapshot(snapshot);
  return snapshot;
}
