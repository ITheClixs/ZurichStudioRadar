# Zurich Studio Radar

Zurich Studio Radar is a local Next.js web application that aggregates publicly accessible rental listings for true self-contained studio apartments in the Canton of Zurich, Switzerland.

The current production source coverage uses **Flatfox**, **UrbanHome**, and **UMS**. The architecture supports multiple source adapters, but only sources that can be accessed reliably without login, paywall, or active anti-bot challenge are enabled.

## What The Application Does

The application:

1. Fetches public rental listings from supported sources.
2. Normalizes all source data into a shared internal schema.
3. Validates that the listing location is inside the **Canton of Zurich**.
4. Applies a strict studio classifier.
5. Excludes WG/shared-room/shared-facility offers.
6. Deduplicates accepted listings.
7. Caches the aggregated result locally.
8. Displays the accepted listings in a searchable, filterable frontend with prominent original source links.

## Architecture

The project uses:

- **Next.js App Router**
- **TypeScript**
- **Server-side source adapters**
- **Local JSON cache persistence**
- **Client-side filtering and sorting UI**

Relevant modules:

- `src/lib/sources/flatfox/adapter.ts`
  Flatfox source adapter, pagination, coarse filtering, detail-page enrichment.
- `src/lib/sources/flatfox/extract.ts`
  Listing HTML extraction for images, detail rows, and gallery captions.
- `src/lib/sources/urbanhome/adapter.ts`
  UrbanHome public search adapter, room-bounded pagination, detail-page enrichment.
- `src/lib/sources/urbanhome/extract.ts`
  UrbanHome result-card and detail-page extraction.
- `src/lib/sources/ums/adapter.ts`
  UMS source adapter for public Zurich-region furnished apartment listings.
- `src/lib/sources/ums/extract.ts`
  UMS result-card and detail-page extraction.
- `src/lib/classification/studio.ts`
  Strict studio classification logic.
- `src/lib/classification/location.ts`
  Canton Zurich validator using the official municipality list.
- `src/lib/cache.ts`
  Local cache persistence under `data/cache/listings-cache.json`.
- `src/lib/aggregation.ts`
  Cross-source aggregation, deduplication, and stale-source cache reuse when a live source fails.
- `src/app/api/listings/route.ts`
  Read aggregated listings.
- `src/app/api/refresh/route.ts`
  Trigger a fresh scrape and cache rewrite.
- `src/components/listings-dashboard.tsx`
  Main frontend UI.

## Supported Sources

### Flatfox

Why it is enabled:

- Public listings are accessible without login.
- A public listing API is exposed by the site and used by the application.
- Detail pages are publicly accessible and provide stable HTML for image and metadata extraction.

How it is used:

- The app paginates through Flatfox public listings.
- It applies a coarse filter for apartment rentals with `<= 1.5` rooms.
- It keeps only listings whose municipality can be validated inside the Canton of Zurich.
- For likely candidates, it fetches the public listing HTML to extract image URLs, detail rows, and gallery captions.
- The final strict classifier decides whether the listing is a true studio.
- The crawler is intentionally polite and includes retry / backoff behavior for source throttling.

Known limitation:

- As observed on **March 23, 2026**, Flatfox can return Cloudflare `Error 1015` rate limits for the public listing API from this environment.
- The app now exposes the `Retry-After` window explicitly and keeps previously cached Flatfox listings visible if a later refresh is blocked.

### UrbanHome

Why it is enabled:

- Public search results are accessible without login.
- The site exposes a working public search POST endpoint.
- Listing detail pages are publicly accessible and contain enough metadata and description text for strict filtering.

How it is used:

- The adapter calls the public `/Search/DoSearch` endpoint with Canton Zurich and `1.0` to `1.5` room apartment constraints.
- The returned result cards are parsed into listing seeds.
- Detail pages are fetched only for those bounded candidates.
- The same strict studio and Canton Zurich validators are then applied before acceptance.

### UMS

Why it is enabled:

- Public city listing indexes are server-rendered and accessible without login.
- Detail pages are public and expose explicit kitchen and bathroom sections.
- The Zurich-region feeds contain real studio and one-room listings inside the Canton of Zurich.

How it is used:

- The adapter crawls the public Zurich and Winterthur UMS result pages.
- It keeps only studio and one-room candidates before detail-page enrichment.
- Detail pages contribute feature rows like `Küche` and `Bad / Dusche / WC`, which are then fed into the strict classifier.

## Excluded Sources And Why

As of **March 23, 2026**, the following sources were intentionally not enabled:

- **Newhome**
  Public listing pages returned a Cloudflare challenge instead of usable content during implementation. The app does not fake support for blocked sources.
- **Ron Orp**
  The public housing market page was reachable, but the actual market content was not exposed in a stable server-rendered payload. It also mixes WG/shared-room inventory heavily, which makes strict high-precision extraction materially more brittle without a stable public endpoint.
- **WOKO**
  WOKO has public pages and some qualifying studios do exist, but from this environment their site returned CloudFront `403 Request blocked` responses for live page fetches. Because the source is blocked and much of the inventory is shared student housing, it is documented rather than presented as supported.

## Studio Filtering Logic

Precision is prioritized over recall.

The studio classifier rejects listings unless all of the following hold:

- source object category is an apartment
- room count is present and `<= 1.5`
- no shared-housing negative signals are found
- bathroom evidence is present in text or gallery captions
- kitchen or kitchenette evidence is present in text or gallery captions
- the listing presents itself as a studio / one-room apartment / apartment-like unit

Examples of positive indicators:

- `studio`
- `studio apartment`
- `Einzimmerwohnung`
- `1-Zimmerwohnung`
- `bathroom`, `Badezimmer`, `shower`, `WC`
- `kitchen`, `kitchenette`, `Küche`, `Kochnische`

Examples of negative indicators:

- `WG`
- `shared flat`
- `room in a shared flat`
- `shared kitchen`
- `shared bathroom`
- `co living`

Ambiguous listings are excluded.

Shared laundry alone is **not** treated as a disqualifier. Listings are rejected for shared housing when the evidence points to shared living space, shared kitchen, or shared bathroom.

## Canton Zurich Validation Logic

The canton validator uses the official municipality list of the **160 political municipalities of the Canton of Zurich**, derived from the Canton Zurich municipality spreadsheet.

Validation strategy:

- exact municipality match against the official municipality list
- exact locality alias match where the source uses a locality instead of the municipality
  Examples: `Glattbrugg -> Opfikon`, `Effretikon -> Illnau-Effretikon`
- fallback municipality detection from listing location text

Listings are excluded if the location cannot be verified as belonging to the canton.

## Caching

The aggregated listing snapshot is stored locally at:

- `data/cache/listings-cache.json`

Behavior:

- normal page loads read the local cache
- refreshing listings rewrites the cache
- if a live source fails but a previous cache contains listings from that source, the app reuses those source-specific cached listings instead of dropping them from the UI
- if a live refresh fully fails and a previous successful cache exists, the app preserves the previous cache instead of replacing it with an empty result
- the UI shows cache age, the last refresh attempt, which sources are currently served from stale cache, and the next retry time when the source reports one
- repeated page loads do not hit upstream sources unless a refresh is triggered

## Run Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Useful commands:

```bash
npm run typecheck
npm run build
npm start
```

Optional crawl tuning environment variables:

```bash
FLATFOX_MAX_PAGES=25
FLATFOX_PAGE_DELAY_MS=150
FLATFOX_DETAIL_DELAY_MS=250
FLATFOX_DETAIL_CONCURRENCY=2
URBANHOME_MAX_PAGES=8
URBANHOME_PAGE_DELAY_MS=120
URBANHOME_DETAIL_DELAY_MS=180
URBANHOME_DETAIL_CONCURRENCY=2
UMS_MAX_PAGES_PER_REGION=8
UMS_PAGE_DELAY_MS=150
UMS_DETAIL_DELAY_MS=200
UMS_DETAIL_CONCURRENCY=2
```

Notes:

- By default, the Flatfox adapter attempts a full-feed scan.
- By default, the UrbanHome adapter scans up to 8 result pages of 25 rows each for the bounded `1.0` to `1.5` room search.
- By default, the UMS adapter scans up to 8 pages for each supported Zurich-region feed.
- `FLATFOX_MAX_PAGES` is intended for local development or controlled bounded refreshes when you explicitly want to cap source pagination.
- `URBANHOME_MAX_PAGES` is intended for the same reason when you want to bound UrbanHome refreshes.
- `UMS_MAX_PAGES_PER_REGION` is intended for the same reason when you want to bound UMS pagination.
- Lower concurrency and non-zero delays reduce the risk of tripping source-side throttling.

## Frontend Features

For each accepted listing the frontend shows:

- title
- monthly price
- municipality
- postal code
- canton
- size
- room count
- description
- image thumbnail
- source name
- original listing URL
- posted date
- scrape timestamp

Interactive features:

- search
- municipality filter
- source filter
- min/max price filter
- min/max size filter
- sorting by lowest price, highest price, newest, and largest size
- refresh button
- empty states
- error states
- responsive layout

## Data Model

Normalized listings include:

- internal id
- source name
- original listing URL
- source listing id
- title
- monthly price
- currency
- address
- municipality
- postal code
- canton
- size sqm
- room count
- description
- image URLs
- listing type classification
- studio confidence
- studio reasoning
- canton confidence
- canton reasoning
- posted date
- scraped timestamp
- deduplication fingerprint

## Limitations

- Current live coverage includes **Flatfox**, **UrbanHome**, and **UMS**.
- Flatfox’s public listing endpoint does not expose image URLs directly, so thumbnails are enriched from public listing HTML for candidate listings only.
- The classifier is intentionally conservative. Some valid studios may be excluded if the source text never explicitly proves private bathroom and private kitchen facilities.
- A full refresh can take noticeable time because both sources require detail-page enrichment for high-confidence filtering.
- As observed on **March 23, 2026**, Flatfox can return `429 Too Many Requests` with long `Retry-After` values from this environment. The app fails fast, records the source error clearly, preserves cached Flatfox listings when available, and exposes the next retry window in the UI.
- I tested Flatfox’s public search HTML as a fallback path. It renders only an application shell and client bootstrap data, not a usable server-rendered listing payload, so it is not used as a bypass.

## What Was Implemented

- Next.js TypeScript application scaffold
- source adapter architecture
- production Flatfox adapter
- production UrbanHome adapter
- production UMS adapter
- official Canton Zurich municipality validation
- strict studio classification
- deduplication
- local JSON cache persistence
- backend API routes
- polished searchable/filterable frontend
- stale-cache source preservation and retry-after UX
- source status reporting
- serious README with source limitations and rationale

## Verification

The project is intended to be verified locally with:

- `npm run typecheck`
- `npm run build`
- a live refresh through the UI or `POST /api/refresh`

Verified during implementation on **March 23, 2026**:

- `npm run typecheck`
- `npm run build`
- local server startup
- live `POST /api/refresh` behavior against Flatfox and UrbanHome
- live UrbanHome acceptance of real Canton Zurich studio listings
- live UMS acceptance of real Canton Zurich studio listings
- Flatfox search-page HTML fallback investigation, confirming it does not expose a usable server-rendered listing payload

Because listing inventories change continuously, the exact accepted listing count will vary by refresh time.
