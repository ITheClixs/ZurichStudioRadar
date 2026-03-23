import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AggregationSnapshot } from "@/lib/types";
import { minutesBetween } from "@/lib/utils";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "listings-cache.json");
export const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

export async function readAggregationSnapshot(): Promise<AggregationSnapshot | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw) as AggregationSnapshot;
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
    return {
      generatedAt: new Date(0).toISOString(),
      cacheAgeMinutes: null,
      listings: [],
      sourceStatus: []
    };
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
