import { load } from "cheerio";

import { absoluteUrl, normalizeWhitespace, numberOrNull, stringOrNull } from "@/lib/utils";

const URBANHOME_BASE_URL = "https://www.urbanhome.ch";

export interface UrbanHomeSearchSeed {
  sourceUrl: string;
  sourceListingId: string;
  listingTypeLabel: string;
  marketingTitle: string;
  monthlyPrice: number | null;
  address: string | null;
  postalCode: string | null;
  municipality: string | null;
  imageUrl: string | null;
}

export interface UrbanHomeDetailExtraction {
  title: string;
  imageUrls: string[];
  description: string;
  featureRows: Record<string, string>;
  monthlyPrice: number | null;
  roomCount: number | null;
  sizeSqm: number | null;
  address: string | null;
  postalCode: string | null;
  municipality: string | null;
}

export function extractUrbanHomeSearchSeeds(rowsHtml: string): UrbanHomeSearchSeed[] {
  const html = unwrapEncodedHtml(rowsHtml);
  const $ = load(html);

  return $("a.listing")
    .toArray()
    .map((element) => {
      const card = $(element);
      const sourceUrl = absoluteUrl(card.attr("href") ?? "", URBANHOME_BASE_URL);
      const sourceListingId = sourceUrl.match(/\/suchen\/(\d+)/)?.[1];
      if (!sourceListingId) {
        return null;
      }

      const cardTexts = card
        .find(".card-text")
        .toArray()
        .map((node) => normalizeWhitespace($(node).text()))
        .filter(Boolean);
      const listingTypeLabel = normalizeWhitespace(card.find(".card-text strong").first().text());
      const marketingTitle = normalizeWhitespace(
        card.find("img").attr("title") ?? card.find("img").attr("alt") ?? listingTypeLabel
      );
      const addressBlock = cardTexts.at(-1) ?? "";
      const location = parseAddressBlock(addressBlock);
      const imageUrl = stringOrNull(card.find("img").attr("src"));

      return {
        sourceUrl,
        sourceListingId,
        listingTypeLabel,
        marketingTitle,
        monthlyPrice: numberOrNull(normalizeWhitespace(card.find(".card-title").first().text())),
        address: location.address,
        postalCode: location.postalCode,
        municipality: location.municipality,
        imageUrl: imageUrl ? absoluteUrl(imageUrl, URBANHOME_BASE_URL) : null
      };
    })
    .filter((seed): seed is UrbanHomeSearchSeed => seed !== null);
}

export function extractUrbanHomeListingDetail(html: string): UrbanHomeDetailExtraction {
  const $ = load(html);
  const title = normalizeWhitespace($("blockquote p").first().text());
  const description = normalizeWhitespace($(".description").first().text());
  const imageUrls = $(".swiper-slide img")
    .toArray()
    .map((node) => stringOrNull($(node).attr("src")))
    .filter((value): value is string => value !== null)
    .map((url) => absoluteUrl(url, URBANHOME_BASE_URL));
  const spotlightValues = collectSpotlightValues($);
  const featureRows = collectDefinitionRows($);
  const address = stringOrNull(featureRows.Address) ?? stringOrNull(featureRows.Adresse);
  const location = parseAddressBlock(address);

  return {
    title,
    imageUrls,
    description,
    featureRows,
    monthlyPrice: numberOrNull(spotlightValues.Miete ?? featureRows.Miete ?? featureRows.Nettomiete),
    roomCount: numberOrNull(spotlightValues.Zimmer ?? featureRows.Zimmer),
    sizeSqm: numberOrNull(
      spotlightValues.Fläche ??
        spotlightValues.Flaeche ??
        featureRows.Wohnfläche ??
        featureRows.Wohnflaeche ??
        featureRows.Fläche ??
        featureRows.Flaeche
    ),
    address: location.address,
    postalCode: location.postalCode,
    municipality: location.municipality
  };
}

function unwrapEncodedHtml(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return value;
}

function collectSpotlightValues(document: ReturnType<typeof load>): Record<string, string> {
  const values: Record<string, string> = {};
  document(".spotlight-attributes li").each((_, element) => {
    const chunks = document(element)
      .find("div")
      .toArray()
      .map((node) => normalizeWhitespace(document(node).text()))
      .filter(Boolean);
    if (chunks.length >= 2) {
      values[chunks[0]] = chunks[1];
    }
  });

  return values;
}

function collectDefinitionRows(document: ReturnType<typeof load>): Record<string, string> {
  const values: Record<string, string> = {};
  let currentKey: string | null = null;

  document("dl.section")
    .children("dt, dd")
    .each((_, element) => {
      const node = document(element);
      const text = normalizeWhitespace(node.text());

      if (element.tagName === "dt") {
        currentKey = text || null;
        return;
      }

      if (currentKey) {
        values[currentKey] = text;
      }
    });

  return values;
}

function parseAddressBlock(value: string | null): {
  address: string | null;
  postalCode: string | null;
  municipality: string | null;
} {
  const source = stringOrNull(value);
  if (!source) {
    return {
      address: null,
      postalCode: null,
      municipality: null
    };
  }

  const normalized = normalizeWhitespace(source);
  const postalMatch = normalized.match(/\b(\d{4})\s+(.+?)(?:\s+ZH)?$/i);

  return {
    address: normalized,
    postalCode: postalMatch?.[1] ?? null,
    municipality: postalMatch?.[2]?.trim() ?? null
  };
}
