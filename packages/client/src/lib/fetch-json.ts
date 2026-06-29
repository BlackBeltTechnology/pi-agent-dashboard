/**
 * Shared transport guard for the dashboard client lib.
 *
 * Wraps `fetch` and validates the response BEFORE parsing JSON, so a
 * non-JSON body (reverse-proxy / gateway HTML error page, SPA-fallback
 * page, empty body, misrouted /api/* request) surfaces as a typed
 * `ApiHttpError` naming the real HTTP status — never a native JSON
 * `SyntaxError` ("Unexpected token '<'").
 *
 * See change: guard-client-fetch-json.
 */

/** Max chars of the response body retained on an ApiHttpError. */
const BODY_SNIPPET_MAX = 200;

export class ApiHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly contentType: string;
  readonly bodySnippet: string;

  constructor(args: {
    status: number;
    statusText: string;
    contentType: string;
    bodySnippet: string;
    message: string;
  }) {
    super(args.message);
    this.name = "ApiHttpError";
    this.status = args.status;
    this.statusText = args.statusText;
    this.contentType = args.contentType;
    this.bodySnippet = args.bodySnippet;
  }
}

/**
 * Read at most ~BODY_SNIPPET_MAX chars of the body; never throws.
 * Streams incrementally and stops early so a large proxy/HTML error page is
 * never fully buffered into memory.
 */
async function readBodySnippet(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let snippet = "";
  try {
    while (snippet.length < BODY_SNIPPET_MAX) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      snippet += decoder.decode(value, { stream: true });
    }
    snippet += decoder.decode();
    return snippet.slice(0, BODY_SNIPPET_MAX);
  } catch {
    return "";
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function buildError(res: Response, contentType: string, snippet: string): ApiHttpError {
  const statusText = res.statusText || "";
  const base = `HTTP ${res.status}${statusText ? ` ${statusText}` : ""}`;
  // For wrong content-type on a 2xx, name the actual type so the message
  // points at the misroute/SPA-fallback rather than just the status.
  const detail = res.ok ? ` (unexpected content-type: ${contentType || "unknown"})` : "";
  return new ApiHttpError({
    status: res.status,
    statusText,
    contentType,
    bodySnippet: snippet,
    message: `${base}${detail}`,
  });
}

/**
 * fetch + content-type guard, returning the raw `Response` plus parsed
 * JSON. Applies ONLY the content-type guard (NOT `res.ok`), so callers
 * that branch on status (e.g. 409-dirty checkout, the worktree-create
 * error union) still read a valid-JSON non-2xx body, while a non-JSON
 * body (proxy HTML) still throws `ApiHttpError` instead of a parse error.
 */
// biome-ignore lint/suspicious/noExplicitAny: default mirrors Response.json()'s `Promise<any>` so untyped callers keep their pre-migration ergonomics.
export async function fetchJsonResponse<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ res: Response; json: T }> {
  const res = await fetch(input, init);
  const contentType = res.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    throw buildError(res, contentType, await readBodySnippet(res));
  }
  return { res, json: (await res.json()) as T };
}

/**
 * fetch + validate + parse. Returns the parsed JSON as `T` only when the
 * response is ok AND has an application/json content-type; otherwise
 * throws `ApiHttpError`. Use for helpers that throw on failure (no
 * status-specific union to preserve).
 */
// biome-ignore lint/suspicious/noExplicitAny: default mirrors Response.json()'s `Promise<any>` so untyped callers keep their pre-migration ergonomics.
export async function fetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, init);
  const contentType = res.headers.get("content-type") ?? "";

  if (!res.ok || !contentType.includes("application/json")) {
    throw buildError(res, contentType, await readBodySnippet(res));
  }
  return (await res.json()) as T;
}
