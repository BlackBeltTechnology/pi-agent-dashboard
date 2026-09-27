/**
 * Classify a preview's file-route response for `DenialNotice` (change:
 * surface-denial-remedy-in-previews, design D1/D9).
 *
 * `ok | not-found | refused | denied | error`, plus `unknown` for an `<img>`
 * failure that carries no response at all. A 403 is `denied` only when its body
 * carries a `denialId` (a containment refusal with remedy fields); any other
 * 403 (`unknown session path`, …) is `refused` and shows the server's own
 * `error` string — no string matching. Every non-ok result records whether the
 * request was opted out of the grant dialog, which decides the notice's action.
 */
import { type PromptOutcome, parseDenialBody } from "../../lib/access-grants/access-grants-types.js";
import type { PreviewFetch } from "../../lib/access-grants/preview-provenance.js";

export type DenialResult =
  | { kind: "ok"; response: Response }
  | { kind: "not-found" }
  | { kind: "refused"; error: string; optedOut: boolean }
  | { kind: "denied"; subject: string; promptOutcome?: PromptOutcome; optedOut: boolean }
  /** `status`: a non-2xx HTTP answer with no better text; `message`: a transport/viewer error. */
  | { kind: "error"; message?: string; status?: number }
  /** A transport failure with no status and no body (`<img>` `onError`). */
  | { kind: "unknown" };

/** The non-ok results a notice renders. */
export type DenialFailure = Exclude<DenialResult, { kind: "ok" }>;

/** Classify a response. Reads the body only for a 403. */
export async function classifyResponse(res: Response, optedOut: boolean): Promise<DenialResult> {
  if (res.ok) return { kind: "ok", response: res };
  if (res.status === 404) return { kind: "not-found" };
  if (res.status === 403) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // A 403 with no JSON body is a refusal without remedy fields.
    }
    const parsed = parseDenialBody(body);
    if (parsed.kind === "refused") return { kind: "refused", error: parsed.error, optedOut };
    return { kind: "denied", subject: parsed.subject, promptOutcome: parsed.promptOutcome, optedOut };
  }
  // Includes 416 (a zero-byte file's range probe): an ordinary load error.
  return { kind: "error", status: res.status };
}

/** Fetch `url` through a preview's fetch and classify the result; never throws. */
export async function denialFetch(
  fetchFn: PreviewFetch,
  url: string,
  optedOut: boolean,
  init?: RequestInit,
): Promise<DenialResult> {
  try {
    return await classifyResponse(await fetchFn(url, init), optedOut);
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The one diagnostic probe a multi-request viewer (video, audio, PDF) may issue
 * after a load failure (design D2): a single byte, read only for its status and
 * denial fields. `fetchFn` decides eligibility — the opted-out fetch for the
 * diagnosis, the eligible one after an operator's Ask for access.
 */
export function probeMedia(fetchFn: PreviewFetch, url: string, optedOut: boolean): Promise<DenialResult> {
  return denialFetch(fetchFn, url, optedOut, { headers: { Range: "bytes=0-0" } });
}
