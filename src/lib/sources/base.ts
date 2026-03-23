import { Logger } from "@/lib/logger";
import type { NormalizedListing, SourceRunResult } from "@/lib/types";

export interface SourceAdapter {
  readonly sourceName: string;
  scrape(logger: Logger): Promise<{ listings: NormalizedListing[]; run: SourceRunResult }>;
}
