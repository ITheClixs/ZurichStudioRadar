import type { NormalizedListing } from "@/lib/types";

export function dedupeListings(listings: NormalizedListing[]): NormalizedListing[] {
  const byFingerprint = new Map<string, NormalizedListing>();

  for (const listing of listings) {
    const existing = byFingerprint.get(listing.deduplicationFingerprint);
    if (!existing) {
      byFingerprint.set(listing.deduplicationFingerprint, listing);
      continue;
    }

    byFingerprint.set(
      listing.deduplicationFingerprint,
      pickPreferredListing(existing, listing)
    );
  }

  return Array.from(byFingerprint.values()).sort((left, right) => {
    const rightPrice = right.monthlyPrice ?? Number.POSITIVE_INFINITY;
    const leftPrice = left.monthlyPrice ?? Number.POSITIVE_INFINITY;
    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }

    return right.municipality.localeCompare(left.municipality);
  });
}

function pickPreferredListing(a: NormalizedListing, b: NormalizedListing): NormalizedListing {
  if (b.studioConfidence !== a.studioConfidence) {
    return b.studioConfidence > a.studioConfidence ? b : a;
  }

  if (b.imageUrls.length !== a.imageUrls.length) {
    return b.imageUrls.length > a.imageUrls.length ? b : a;
  }

  if (b.description.length !== a.description.length) {
    return b.description.length > a.description.length ? b : a;
  }

  return b.postedDate && a.postedDate && b.postedDate > a.postedDate ? b : a;
}
