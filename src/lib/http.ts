import { Logger } from "@/lib/logger";
import { sleep } from "@/lib/utils";

const DEFAULT_HEADERS = {
  "user-agent":
    "AccommodationScript/0.1 (+local Next.js rental aggregator; public-source fetch for Zurich studio listings)",
  accept: "application/json,text/html,application/xhtml+xml"
};

async function performFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...DEFAULT_HEADERS,
      ...(init.headers ?? {})
    },
    signal: AbortSignal.timeout(15000),
    cache: "no-store"
  });
}

export async function fetchJson<T>(
  logger: Logger,
  url: string,
  init: RequestInit = {},
  label = "request"
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await performFetch(url, init);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      logger.warn("HTTP JSON request failed", { label, url, attempt, error: String(error) });
      if (attempt < 3) {
        await sleep(250 * attempt);
      }
    }
  }

  throw new Error(`Failed to fetch JSON for ${label}: ${String(lastError)}`);
}

export async function fetchText(
  logger: Logger,
  url: string,
  init: RequestInit = {},
  label = "request"
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await performFetch(url, init);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      lastError = error;
      logger.warn("HTTP text request failed", { label, url, attempt, error: String(error) });
      if (attempt < 3) {
        await sleep(250 * attempt);
      }
    }
  }

  throw new Error(`Failed to fetch text for ${label}: ${String(lastError)}`);
}
