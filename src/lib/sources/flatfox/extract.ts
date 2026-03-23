import * as cheerio from "cheerio";

import { absoluteUrl, normalizeWhitespace, uniqueValues } from "@/lib/utils";

const FLATFOX_BASE_URL = "https://flatfox.ch";

export interface FlatfoxListingDetailExtraction {
  imageUrls: string[];
  featureRows: Record<string, string>;
  description: string;
  galleryCaptions: string[];
}

export function extractFlatfoxListingDetail(html: string): FlatfoxListingDetailExtraction {
  const $ = cheerio.load(html);

  const imageUrls = uniqueValues(
    [
      $("meta[property='og:image']").attr("content") ?? "",
      ...$("figure[itemprop='associatedMedia'] img")
        .map((_, element) => $(element).attr("src") ?? "")
        .get()
    ]
      .map((url) => url.trim())
      .filter(Boolean)
      .map((url) => absoluteUrl(url, FLATFOX_BASE_URL))
  );

  const featureRows: Record<string, string> = {};
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length !== 2) {
      return;
    }

    const rawKey = normalizeWhitespace($(cells[0]).text()).replace(/:$/, "");
    const rawValue = normalizeWhitespace($(cells[1]).text());
    if (rawKey && rawValue) {
      featureRows[rawKey] = rawValue;
    }
  });

  const description = normalizeWhitespace($("div.markdown").text());
  const galleryCaptions = uniqueValues(
    $("div.photoswipe-item__lightbox-caption")
      .map((_, element) => normalizeWhitespace($(element).text()))
      .get()
      .filter(Boolean)
  );

  return {
    imageUrls,
    featureRows,
    description,
    galleryCaptions
  };
}
