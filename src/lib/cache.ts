import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AggregationSnapshot, SourceName, SourceRunResult } from "@/lib/types";
import { minutesBetween } from "@/lib/utils";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "listings-cache.json");
export const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

export async function readAggregationSnapshot(): Promise<AggregationSnapshot | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    return hydrateAggregationSnapshot(JSON.parse(raw) as Partial<AggregationSnapshot>);
  } catch {
    return null;
  }
}

export async function writeAggregationSnapshot(snapshot: AggregationSnapshot): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

export async function getCachedAggregationSnapshot(): Promise<AggregationSnapshot> {
  const snapshot = await readAggregationSnapshot();
  if (!snapshot) {
    return createEmptyAggregationSnapshot();
  }

  return {
    ...snapshot,
    cacheAgeMinutes: minutesBetween(new Date().toISOString(), snapshot.generatedAt)
  };
}

export async function isCacheFresh(): Promise<boolean> {
  const snapshot = await readAggregationSnapshot();
  if (!snapshot) {
    return false;
  }

  return Date.now() - new Date(snapshot.generatedAt).getTime() <= CACHE_TTL_MS;
}

export function createEmptyAggregationSnapshot(): AggregationSnapshot {
  return {
    generatedAt: new Date(0).toISOString(),
    cacheAgeMinutes: null,
    listings: [],
    sourceStatus: [],
    staleCache: {
      active: false,
      lastRefreshAttemptedAt: null,
      reusedSources: []
    }
  };
}

function hydrateAggregationSnapshot(snapshot: Partial<AggregationSnapshot>): AggregationSnapshot {
  return {
    generatedAt: snapshot.generatedAt ?? new Date(0).toISOString(),
    cacheAgeMinutes: snapshot.cacheAgeMinutes ?? null,
    listings: snapshot.listings ?? [],
    sourceStatus: (snapshot.sourceStatus ?? []).map(hydrateSourceRunResult),
    staleCache: {
      active: snapshot.staleCache?.active ?? false,
      lastRefreshAttemptedAt: snapshot.staleCache?.lastRefreshAttemptedAt ?? null,
      reusedSources: snapshot.staleCache?.reusedSources ?? []
    }
  };
}

function hydrateSourceRunResult(run: Partial<SourceRunResult>): SourceRunResult {
  return {
    sourceName: (run.sourceName ?? "Flatfox") as SourceName,
    status: run.status ?? "error",
    fetchedCount: run.fetchedCount ?? 0,
    candidateCount: run.candidateCount ?? 0,
    acceptedCount: run.acceptedCount ?? 0,
    durationMs: run.durationMs ?? 0,
    errors: run.errors ?? [],
    notes: run.notes ?? [],
    retryAfterSeconds: run.retryAfterSeconds ?? null,
    nextRetryAt: run.nextRetryAt ?? null,
    usedCachedListings: run.usedCachedListings ?? false,
    cachedListingCount: run.cachedListingCount ?? 0,
    cachedGeneratedAt: run.cachedGeneratedAt ?? null
  };
}
