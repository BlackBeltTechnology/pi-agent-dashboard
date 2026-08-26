/**
 * Minimal JSON fetch for provider quota endpoints. No dependencies.
 *
 * SECURITY CONTRACT (this file is the only place tokens touch the network):
 *  - A token is ONLY ever placed in a request header, never in a URL, query
 *    string, or log line.
 *  - Error paths return a SCRUBBED message. Upstream bodies can echo back
 *    credentials or signed URLs, so `scrub()` strips anything token-shaped
 *    before the message can reach a log or the client.
 *  - Every request is time-bounded, so one hanging provider cannot stall the
 *    whole snapshot.
 *
 * See change: publish-quota-plugin.
 */

/** Hard ceiling per request. One slow provider must not block the others. */
const FETCH_TIMEOUT_MS = 15_000;

/** Longest error message we will propagate. Bodies can be enormous. */
const MAX_MESSAGE_CHARS = 200;

/**
 * Redact anything credential-shaped from a string bound for a log or the
 * client. Deliberately aggressive: a false positive costs a readable word, a
 * false negative leaks a live token.
 */
export function scrub(text: string): string {
  return (
    text
      // Known key/token prefixes followed by their payload.
      .replace(/\b(sk|pk|ghu|ghp|gho|ghs|gha|xai|or)-[A-Za-z0-9_-]{6,}/gi, "$1-[redacted]")
      // JWTs (three base64url segments).
      .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g, "[redacted-jwt]")
      // Bearer/token header echoes.
      .replace(/\b(bearer|token)\s+[A-Za-z0-9._-]{8,}/gi, "$1 [redacted]")
      // Any long opaque blob, and any URL (may be pre-signed).
      .replace(/\bhttps?:\/\/\S+/gi, "[url]")
      .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]")
      .slice(0, MAX_MESSAGE_CHARS)
  );
}

/** Why a request did not produce JSON. */
type HttpFailureKind = "http" | "timeout" | "network";

export type JsonResult =
  | { ok: true; data: unknown }
  | { ok: false; kind: HttpFailureKind; status?: number; message: string };

/** Pull a short human message out of a JSON error body, else use the raw text. */
function messageFromBody(body: string, fallback: string): string {
  const trimmed = body.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const err = parsed.error as Record<string, unknown> | string | undefined;
      const candidate =
        (typeof err === "object" && err !== null ? err.message : undefined) ??
        parsed.message ??
        (typeof err === "string" ? err : undefined) ??
        parsed.detail ??
        parsed.error_description;
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    } catch {
      // Not JSON after all — fall through.
    }
  }
  return trimmed;
}

/**
 * GET a JSON document with the given headers. Never throws.
 *
 * `headers` is expected to carry the credential; it is never logged here and
 * never echoed into the returned message.
 */
export async function fetchJson(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<JsonResult> {
  const signals: AbortSignal[] = [AbortSignal.timeout(FETCH_TIMEOUT_MS)];
  if (signal) signals.push(signal);
  const combined = AbortSignal.any(signals);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: combined,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        kind: "http",
        status: response.status,
        message: scrub(messageFromBody(body, response.statusText || `HTTP ${response.status}`)),
      };
    }
    return { ok: true, data: await response.json() };
  } catch (err) {
    const aborted = combined.aborted || (err instanceof Error && err.name === "AbortError");
    if (aborted) {
      const timedOut = combined.reason instanceof Error && combined.reason.name === "TimeoutError";
      return { ok: false, kind: timedOut ? "timeout" : "network", message: timedOut ? "Request timed out" : "Request cancelled" };
    }
    return { ok: false, kind: "network", message: scrub(err instanceof Error ? err.message : "Unknown error") };
  }
}
