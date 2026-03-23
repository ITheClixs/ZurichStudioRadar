import { Logger } from "@/lib/logger";
import type { NormalizedListing, SourceName, SourceRunResult } from "@/lib/types";

export interface SourceAdapter {
  readonly sourceName: SourceName;
  scrape(logger: Logger): Promise<{ listings: NormalizedListing[]; run: SourceRunResult }>;
}
