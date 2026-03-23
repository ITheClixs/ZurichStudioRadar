import { Logger } from "@/lib/logger";
import { sleep } from "@/lib/utils";

const DEFAULT_HEADERS = {
  "user-agent":
    "AccommodationScript/0.1 (+local Next.js rental aggregator; public-source fetch for Zurich studio listings)",
  accept: "application/json,text/html,application/xhtml+xml"
};
const MAX_RATE_LIMIT_WAIT_MS = 10000;

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

function parseRetryDelayMs(retryAfterHeader: string | null, attempt: number): number {
  if (retryAfterHeader) {
    const seconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const absoluteDateMs = Date.parse(retryAfterHeader);
    if (Number.isFinite(absoluteDateMs)) {
      return Math.max(0, absoluteDateMs - Date.now());
    }
  }

  return Math.min(15000, 500 * 2 ** (attempt - 1));
}

async function fetchWithRetries(
  logger: Logger,
  url: string,
  init: RequestInit,
  label: string
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await performFetch(url, init);
      if (response.ok) {
        return response;
      }

      if (response.status === 429 && attempt < 5) {
        const delayMs = parseRetryDelayMs(response.headers.get("retry-after"), attempt);
        if (delayMs > MAX_RATE_LIMIT_WAIT_MS) {
          throw new Error(
            `429 Too Many Requests (Retry-After ${Math.round(delayMs / 1000)}s exceeds ${Math.round(MAX_RATE_LIMIT_WAIT_MS / 1000)}s limit)`
          );
        }
        logger.warn("HTTP request rate limited", {
          label,
          url,
          attempt,
          delayMs
        });
        await sleep(delayMs);
        continue;
      }

      throw new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
      logger.warn("HTTP request failed", { label, url, attempt, error: String(error) });
      if (attempt < 5) {
        await sleep(Math.min(10000, 350 * 2 ** (attempt - 1)));
      }
    }
  }

  throw new Error(`Failed request for ${label}: ${String(lastError)}`);
}

export async function fetchJson<T>(
  logger: Logger,
  url: string,
  init: RequestInit = {},
  label = "request"
): Promise<T> {
  const response = await fetchWithRetries(logger, url, init, label);
  return (await response.json()) as T;
}

export async function fetchText(
  logger: Logger,
  url: string,
  init: RequestInit = {},
  label = "request"
): Promise<string> {
  const response = await fetchWithRetries(logger, url, init, label);
  return await response.text();
}
