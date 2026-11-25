/**
 * Thin REST client over `fetch` for ONE access token (one lease per tool call), shared by every product
 * (design D11 — no `googleapis`). Bounded retry per `shared/backoff.ts` (max 3 attempts, `Retry-After`
 * honoured, POST never replayed after a 5xx), 403/other mapping per `shared/google-errors.ts`. Error messages
 * never include the token. See change: add-google-connect.
 */
import { isRetryable, MAX_ATTEMPTS, nextDelay, parseRetryAfter } from "../shared/backoff.js";
import { mapGoogleError, SERVICES } from "../shared/google-errors.js";
import type { Product } from "../shared/products.js";
import { GoogleToolError } from "./tool-error.js";

const REQUEST_TIMEOUT_MS = 30_000;

type QueryValue = string | number | boolean | undefined | readonly string[];

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  /** JSON body. */
  body?: unknown;
  /** Non-JSON body (multipart upload, media): sent as is with this content type. */
  raw?: { data: BodyInit; contentType: string };
  /** `json` (default; empty body → `{}`), `text`, `bytes`. */
  as?: "json" | "text" | "bytes";
  /** Replaces the product base (e.g. Drive's `/upload/...` endpoint). */
  base?: string;
}

export interface GoogleApiOptions {
  product: Product;
  base: string;
  token: string;
  /** The level the tool needs — named in a `scope_insufficient` message. */
  level?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  /** Per-attempt timeout; tests shorten it. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class GoogleApi {
  readonly base: string;
  private readonly o: GoogleApiOptions;

  constructor(o: GoogleApiOptions) {
    this.o = o;
    this.base = o.base;
  }

  private url(path: string, opts: RequestOptions): string {
    const u = new URL(`${opts.base ?? this.base}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined) continue;
      for (const x of Array.isArray(v) ? v : [v]) u.searchParams.append(k, String(x));
    }
    return u.toString();
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const { product } = this.o;
    const svc = SERVICES[product];
    const fetchImpl = this.o.fetchImpl ?? fetch;
    const sleep = this.o.sleep ?? defaultSleep;
    const url = this.url(path, opts);
    const headers: Record<string, string> = { authorization: `Bearer ${this.o.token}` };
    if (opts.raw) headers["content-type"] = opts.raw.contentType;
    else if (opts.body !== undefined) headers["content-type"] = "application/json";
    const body = opts.raw ? opts.raw.data : opts.body === undefined ? undefined : JSON.stringify(opts.body);

    for (let attempt = 1; ; attempt++) {
      const timeout = AbortSignal.timeout(this.o.timeoutMs ?? REQUEST_TIMEOUT_MS);
      const signal = this.o.signal ? AbortSignal.any([timeout, this.o.signal]) : timeout;
      let res: Response | undefined;
      try {
        res = await fetchImpl(url, { method, headers, body, signal });
      } catch {
        if (this.o.signal?.aborted) throw new GoogleToolError("aborted", "aborted: the tool call was cancelled");
        if (attempt < MAX_ATTEMPTS && isRetryable(method, "network")) {
          const d = nextDelay(attempt, undefined, this.o.random);
          if ("delayMs" in d) {
            await sleep(d.delayMs);
            continue;
          }
        }
        throw new GoogleToolError(svc.error, `${svc.error}: could not reach the ${svc.label} API`);
      }
      if (res.ok) {
        if (opts.as === "bytes") return Buffer.from(await res.arrayBuffer()) as T;
        const text = await res.text();
        if (opts.as === "text") return text as T;
        try {
          return (text.trim() ? JSON.parse(text) : {}) as T;
        } catch {
          throw new GoogleToolError(svc.error, `${svc.error}: ${svc.label} returned an unreadable reply`);
        }
      }
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"), (this.o.now ?? Date.now)());
      if ((res.status === 429 || res.status >= 500) && isRetryable(method, res.status)) {
        const d = nextDelay(attempt, retryAfter, this.o.random);
        if ("tooLong" in d) {
          throw new GoogleToolError(
            "rate_limited",
            `rate_limited: ${svc.label} asked to wait ${Math.ceil((retryAfter ?? 0) / 1000)} s; retry later`,
            { status: res.status },
          );
        }
        if (attempt < MAX_ATTEMPTS) {
          await res.body?.cancel().catch(() => undefined);
          await sleep(d.delayMs);
          continue;
        }
      }
      throw await this.fail(res, retryAfter);
    }
  }

  private async fail(res: Response, retryAfterMs: number | undefined): Promise<GoogleToolError> {
    const { product, level } = this.o;
    if (res.status === 429) {
      const wait = retryAfterMs ? ` retry after ${Math.ceil(retryAfterMs / 1000)} s` : " retry later";
      return new GoogleToolError("rate_limited", `rate_limited: ${SERVICES[product].label} rate-limited the request;${wait}`, { status: 429 });
    }
    const text = await res.text().catch(() => "");
    const m = mapGoogleError(product, res.status, text, level);
    return new GoogleToolError(m.code, m.message, { status: res.status, ...(m.reason ? { reason: m.reason } : {}) });
  }
}
