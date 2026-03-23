"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import type { AggregationSnapshot, NormalizedListing } from "@/lib/types";
import { truncateText } from "@/lib/utils";

type SortMode = "lowest-price" | "highest-price" | "newest" | "largest";

type FilterState = {
  search: string;
  municipality: string;
  source: string;
  minPrice: string;
  maxPrice: string;
  minSize: string;
  maxSize: string;
  sort: SortMode;
};

const DEFAULT_FILTERS: FilterState = {
  search: "",
  municipality: "",
  source: "",
  minPrice: "",
  maxPrice: "",
  minSize: "",
  maxSize: "",
  sort: "lowest-price"
};

export function ListingsDashboard({ initialSnapshot }: { initialSnapshot: AggregationSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (initialSnapshot.listings.length === 0 && initialSnapshot.sourceStatus.length === 0) {
      void refreshListings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const municipalityOptions = useMemo(
    () =>
      Array.from(new Set(snapshot.listings.map((listing) => listing.municipality))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [snapshot.listings]
  );

  const sourceOptions = useMemo(
    () => Array.from(new Set(snapshot.listings.map((listing) => listing.sourceName))).sort(),
    [snapshot.listings]
  );

  const filteredListings = useMemo(() => {
    const searchNeedle = filters.search.trim().toLowerCase();

    const listings = snapshot.listings.filter((listing) => {
      if (filters.municipality && listing.municipality !== filters.municipality) {
        return false;
      }

      if (filters.source && listing.sourceName !== filters.source) {
        return false;
      }

      if (filters.minPrice && (listing.monthlyPrice ?? Number.NEGATIVE_INFINITY) < Number(filters.minPrice)) {
        return false;
      }

      if (filters.maxPrice && (listing.monthlyPrice ?? Number.POSITIVE_INFINITY) > Number(filters.maxPrice)) {
        return false;
      }

      if (filters.minSize && (listing.sizeSqm ?? Number.NEGATIVE_INFINITY) < Number(filters.minSize)) {
        return false;
      }

      if (filters.maxSize && (listing.sizeSqm ?? Number.POSITIVE_INFINITY) > Number(filters.maxSize)) {
        return false;
      }

      if (searchNeedle) {
        const haystack = `${listing.title} ${listing.municipality} ${listing.description}`.toLowerCase();
        if (!haystack.includes(searchNeedle)) {
          return false;
        }
      }

      return true;
    });

    listings.sort((left, right) => {
      switch (filters.sort) {
        case "highest-price":
          return (right.monthlyPrice ?? -1) - (left.monthlyPrice ?? -1);
        case "newest":
          return new Date(right.postedDate ?? 0).getTime() - new Date(left.postedDate ?? 0).getTime();
        case "largest":
          return (right.sizeSqm ?? -1) - (left.sizeSqm ?? -1);
        case "lowest-price":
        default:
          return (left.monthlyPrice ?? Number.POSITIVE_INFINITY) - (right.monthlyPrice ?? Number.POSITIVE_INFINITY);
      }
    });

    return listings;
  }, [filters, snapshot.listings]);

  async function refreshListings() {
    setErrorMessage(null);
    startTransition(() => {
      void (async () => {
        const response = await fetch("/api/refresh", { method: "POST" });
        if (!response.ok) {
          const body = (await response.json()) as { details?: string };
          setErrorMessage(body.details ?? "Failed to refresh listings.");
          return;
        }

        const nextSnapshot = (await response.json()) as AggregationSnapshot;
        setSnapshot(nextSnapshot);
      })();
    });
  }

  return (
    <main className="page-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Local Zurich Rental Intelligence</p>
          <h1>Zurich Studio Radar</h1>
          <p className="hero-text">
            Strictly filtered, self-contained studio apartments in the Canton of Zurich. Shared
            flats, WG rooms, and ambiguous listings are excluded by design.
          </p>
          <div className="hero-actions">
            <button className="action-button" onClick={() => void refreshListings()} disabled={isPending}>
              {isPending ? "Refreshing…" : "Refresh listings"}
            </button>
            <span className="cache-meta">
              {snapshot.cacheAgeMinutes === null
                ? "No cache yet"
                : `Cache age: ${snapshot.cacheAgeMinutes} min`}
            </span>
          </div>
        </div>

        <div className="hero-stats">
          <StatCard label="Accepted listings" value={String(snapshot.listings.length)} />
          <StatCard
            label="Municipalities"
            value={String(new Set(snapshot.listings.map((listing) => listing.municipality)).size)}
          />
          <StatCard
            label="Last refresh"
            value={
              snapshot.generatedAt === new Date(0).toISOString()
                ? "Not run yet"
                : new Date(snapshot.generatedAt).toLocaleString()
            }
          />
        </div>
      </section>

      {snapshot.staleCache.active ? (
        <section className="stale-banner">
          <div>
            <strong>Showing cached listings for source failures.</strong>
            <p>
              {snapshot.staleCache.reusedSources.map((source) => source.reason).join(" ")}
            </p>
          </div>
          <span className="stale-banner__meta">
            Last live attempt:{" "}
            {snapshot.staleCache.lastRefreshAttemptedAt
              ? new Date(snapshot.staleCache.lastRefreshAttemptedAt).toLocaleString()
              : "n/a"}
          </span>
        </section>
      ) : null}

      <section className="status-panel">
        {snapshot.sourceStatus.length === 0 ? (
          <div className="empty-status">
            <strong>No cached scrape yet.</strong>
            <p>The first refresh will fetch listings from the supported live source and cache the result locally.</p>
          </div>
        ) : (
          snapshot.sourceStatus.map((source) => (
            <article key={source.sourceName} className={`source-card source-card--${source.status}`}>
              <div className="source-card__header">
                <strong>{source.sourceName}</strong>
                <span>{source.status.toUpperCase()}</span>
              </div>
              <p>
                fetched {source.fetchedCount} raw listings, kept {source.acceptedCount} live validated
                studios, reused {source.cachedListingCount} cached listings in{" "}
                {Math.round(source.durationMs / 1000)}s
              </p>
              {source.nextRetryAt ? (
                <p className="source-card__retry">
                  Next retry after {new Date(source.nextRetryAt).toLocaleTimeString()} (
                  {formatRetryAfter(source.retryAfterSeconds)})
                </p>
              ) : null}
              {source.errors.length > 0 ? <p className="source-card__error">{source.errors[0]}</p> : null}
              {source.notes.length > 0 ? (
                <p className="source-card__note">{source.notes.join(" ")}</p>
              ) : null}
            </article>
          ))
        )}
      </section>

      <section className="filters-panel">
        <div className="filters-grid">
          <label>
            Search
            <input
              type="search"
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
              placeholder="Title, municipality, description"
            />
          </label>

          <label>
            Municipality
            <select
              value={filters.municipality}
              onChange={(event) => setFilters({ ...filters, municipality: event.target.value })}
            >
              <option value="">All municipalities</option>
              {municipalityOptions.map((municipality) => (
                <option key={municipality} value={municipality}>
                  {municipality}
                </option>
              ))}
            </select>
          </label>

          <label>
            Source
            <select
              value={filters.source}
              onChange={(event) => setFilters({ ...filters, source: event.target.value })}
            >
              <option value="">All sources</option>
              {sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>

          <label>
            Sort
            <select
              value={filters.sort}
              onChange={(event) => setFilters({ ...filters, sort: event.target.value as SortMode })}
            >
              <option value="lowest-price">Lowest price</option>
              <option value="highest-price">Highest price</option>
              <option value="newest">Newest</option>
              <option value="largest">Largest size</option>
            </select>
          </label>

          <label>
            Min price
            <input
              type="number"
              value={filters.minPrice}
              onChange={(event) => setFilters({ ...filters, minPrice: event.target.value })}
              placeholder="CHF"
            />
          </label>

          <label>
            Max price
            <input
              type="number"
              value={filters.maxPrice}
              onChange={(event) => setFilters({ ...filters, maxPrice: event.target.value })}
              placeholder="CHF"
            />
          </label>

          <label>
            Min size
            <input
              type="number"
              value={filters.minSize}
              onChange={(event) => setFilters({ ...filters, minSize: event.target.value })}
              placeholder="m²"
            />
          </label>

          <label>
            Max size
            <input
              type="number"
              value={filters.maxSize}
              onChange={(event) => setFilters({ ...filters, maxSize: event.target.value })}
              placeholder="m²"
            />
          </label>
        </div>

        <div className="filters-actions">
          <button className="secondary-button" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Clear filters
          </button>
          <span>{filteredListings.length} listings shown</span>
        </div>
      </section>

      {errorMessage ? (
        <section className="error-panel">
          <strong>Refresh failed</strong>
          <p>{errorMessage}</p>
        </section>
      ) : null}

      <section className="listings-grid">
        {filteredListings.length === 0 ? (
          <div className="empty-panel">
            <strong>No listings matched the current filters.</strong>
            <p>Relax the price, size, source, or municipality filters and try again.</p>
          </div>
        ) : (
          filteredListings.map((listing) => <ListingCard key={listing.id} listing={listing} />)
        )}
      </section>
    </main>
  );
}

function ListingCard({ listing }: { listing: NormalizedListing }) {
  return (
    <article className="listing-card">
      <div className="listing-card__media">
        {listing.imageUrls[0] ? (
          <img src={listing.imageUrls[0]} alt={listing.title} loading="lazy" />
        ) : (
          <div className="listing-card__placeholder">No image</div>
        )}
      </div>

      <div className="listing-card__body">
        <div className="listing-card__heading">
          <span className="listing-badge">{listing.sourceName}</span>
          <span className="confidence-badge">{Math.round(listing.studioConfidence * 100)}% confidence</span>
        </div>

        <h2>{listing.title}</h2>
        <p className="listing-price">
          {listing.monthlyPrice ? `CHF ${listing.monthlyPrice.toLocaleString("en-CH")}` : "Price on source"}
          <span> / month</span>
        </p>

        <dl className="listing-facts">
          <div>
            <dt>Location</dt>
            <dd>
              {listing.postalCode ? `${listing.postalCode} ` : ""}
              {listing.municipality}, {listing.canton}
            </dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{listing.sizeSqm ? `${listing.sizeSqm} m²` : "n/a"}</dd>
          </div>
          <div>
            <dt>Rooms</dt>
            <dd>{listing.roomCount ?? "n/a"}</dd>
          </div>
          <div>
            <dt>Posted</dt>
            <dd>{listing.postedDate ? new Date(listing.postedDate).toLocaleDateString() : "n/a"}</dd>
          </div>
          <div>
            <dt>Scraped</dt>
            <dd>{new Date(listing.scrapedTimestamp).toLocaleString()}</dd>
          </div>
        </dl>

        <p className="listing-description">{truncateText(listing.description, 260)}</p>

        <div className="listing-actions">
          <a className="primary-link" href={listing.originalListingUrl} target="_blank" rel="noreferrer">
            Open original listing
          </a>
          <span className="secondary-meta">{listing.originalListingUrl}</span>
        </div>
      </div>
    </article>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatRetryAfter(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null) {
    return "retry window unavailable";
  }

  const minutes = Math.floor(retryAfterSeconds / 60);
  const seconds = retryAfterSeconds % 60;
  if (minutes <= 0) {
    return `about ${seconds}s`;
  }

  return `about ${minutes}m ${seconds}s`;
}
