import { Logger } from "@/lib/logger";
import { sleep } from "@/lib/utils";

const DEFAULT_HEADERS = {
  "user-agent":
    "AccommodationScript/0.1 (+local Next.js rental aggregator; public-source fetch for Zurich studio listings)",
  accept: "application/json,text/html,application/xhtml+xml"
};
const MAX_RATE_LIMIT_WAIT_MS = 10000;

export class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null = null,
    readonly bodySnippet: string | null = null,
    readonly isTerminal = false
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

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

      const bodySnippet = (await response.text()).slice(0, 300);

      if (response.status === 429) {
        const delayMs = parseRetryDelayMs(response.headers.get("retry-after"), attempt);
        const isCloudflare1015 =
          bodySnippet.includes("Error 1015") || bodySnippet.includes("rate-limited by the website owner");
        const message =
          delayMs > MAX_RATE_LIMIT_WAIT_MS
            ? `429 Too Many Requests${isCloudflare1015 ? " (Cloudflare Error 1015)" : ""} (Retry-After ${Math.round(delayMs / 1000)}s exceeds ${Math.round(MAX_RATE_LIMIT_WAIT_MS / 1000)}s limit)`
            : `429 Too Many Requests${isCloudflare1015 ? " (Cloudflare Error 1015)" : ""}`;

        if (delayMs > MAX_RATE_LIMIT_WAIT_MS || attempt >= 5) {
          throw new HttpRequestError(message, 429, delayMs, bodySnippet, true);
        }

        logger.warn("HTTP request rate limited", {
          label,
          url,
          attempt,
          delayMs,
          bodySnippet
        });
        await sleep(delayMs);
        continue;
      }

      throw new HttpRequestError(
        `${response.status} ${response.statusText}`,
        response.status,
        null,
        bodySnippet,
        response.status >= 400 && response.status < 500 && response.status !== 408
      );
    } catch (error) {
      lastError = error;
      if (error instanceof HttpRequestError && error.isTerminal) {
        logger.warn("HTTP request failed terminally", {
          label,
          url,
          attempt,
          status: error.status,
          retryAfterMs: error.retryAfterMs,
          error: error.message,
          bodySnippet: error.bodySnippet
        });
        throw error;
      }

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
