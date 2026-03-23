import { load } from "cheerio";

import { absoluteUrl, normalizeWhitespace, numberOrNull, stringOrNull } from "@/lib/utils";

const UMS_BASE_URL = "https://www.ums.ch";

export interface UmsSearchSeed {
  sourceUrl: string;
  sourceListingId: string;
  title: string;
  locationLabel: string;
  listingTypeLabel: string;
  monthlyPrice: number | null;
  availabilityText: string | null;
  imageUrl: string | null;
}

export interface UmsDetailExtraction {
  title: string;
  description: string;
  featureRows: Record<string, string>;
  imageUrls: string[];
  monthlyPrice: number | null;
  postedOrAvailabilityText: string | null;
  sizeSqm: number | null;
  roomCount: number | null;
}

export function extractUmsSearchSeeds(html: string): UmsSearchSeed[] {
  const $ = load(html);

  return $(".search_result_item")
    .toArray()
    .map((element) => {
      const card = $(element);
      const detailLink = card.find('a[href^="/angebots-detail/"]').first();
      const href = stringOrNull(detailLink.attr("href"));
      if (!href) {
        return null;
      }

      const sourceUrl = absoluteUrl(href, UMS_BASE_URL);
      const sourceListingId = sourceUrl.match(/\/angebots-detail\/(\d+)\//)?.[1];
      if (!sourceListingId) {
        return null;
      }

      const snippets = card
        .find(".header_snippet strong")
        .toArray()
        .map((node) => normalizeWhitespace($(node).text()).replace(/,+$/, ""))
        .filter(Boolean);

      return {
        sourceUrl,
        sourceListingId,
        title: normalizeWhitespace(detailLink.attr("title") ?? card.find(".offer_description h2").text()),
        locationLabel: snippets[0] ?? "",
        listingTypeLabel: snippets[1] ?? "",
        monthlyPrice: numberOrNull(card.find(".label-price").first().text()),
        availabilityText: stringOrNull(card.find(".text_item").first().text()),
        imageUrl: normalizeImageUrl(card.find(".image_container img").eq(1).attr("src"))
      };
    })
    .filter((seed): seed is UmsSearchSeed => seed !== null);
}

export function extractUmsListingDetail(html: string): UmsDetailExtraction {
  const $ = load(html);
  const title = normalizeWhitespace($("#id_description .card_header h1").first().text());
  const description = extractDescription($);
  const featureRows = collectFeatureRows($);
  const imageUrls = [
    ...$('link[rel="image_src"]')
      .toArray()
      .map((node) => normalizeImageUrl($(node).attr("href"))),
    ...$(".keen-slider__slide img")
      .toArray()
      .map((node) => normalizeImageUrl($(node).attr("src")))
  ].filter((value, index, values): value is string => value !== null && values.indexOf(value) === index);

  const monthlyPrice = numberOrNull($("#id_description .label-price").first().text());
  const availabilityText = stringOrNull($("#id_price_availability .card_options em").first().text());
  const sizeSqm = numberOrNull(description.match(/(\d+(?:[.,]\d+)?)\s*m²/i)?.[1] ?? null);
  const roomCount = inferRoomCount(title, description);

  return {
    title,
    description,
    featureRows,
    imageUrls,
    monthlyPrice,
    postedOrAvailabilityText: availabilityText,
    sizeSqm,
    roomCount
  };
}

function extractDescription(document: ReturnType<typeof load>): string {
  const generalParagraph = document("#id_description .card_options p")
    .toArray()
    .find((node) => normalizeWhitespace(document(node).find("em").first().text()) === "Allgemein");

  if (!generalParagraph) {
    return "";
  }

  const paragraph = document(generalParagraph).clone();
  paragraph.find("em").remove();
  return normalizeWhitespace(paragraph.text());
}

function collectFeatureRows(document: ReturnType<typeof load>): Record<string, string> {
  const values: Record<string, string> = {};

  document(".card_options p").each((_, node) => {
    const paragraph = document(node);
    const key = normalizeWhitespace(paragraph.find("em").first().text());
    if (!key) {
      return;
    }

    const copy = paragraph.clone();
    copy.find("em").remove();
    const value = normalizeWhitespace(copy.text());
    if (value) {
      values[key] = value;
    }
  });

  return values;
}

function inferRoomCount(...values: Array<string | null | undefined>): number | null {
  const joined = values.filter(Boolean).join(" ").replace(",", ".");
  const roomMatch = joined.match(/(\d+(?:\.\d+)?)\s*zimmer/i);
  if (roomMatch) {
    return numberOrNull(roomMatch[1]);
  }

  if (normalizeWhitespace(joined).toLowerCase().includes("studio")) {
    return 1;
  }

  return null;
}

function normalizeImageUrl(value: string | undefined): string | null {
  const source = stringOrNull(value);
  return source ? absoluteUrl(source, UMS_BASE_URL) : null;
}
