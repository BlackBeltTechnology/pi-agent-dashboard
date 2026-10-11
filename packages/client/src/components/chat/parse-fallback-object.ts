/**
 * Pure parser for the generic custom-entry fallback's structured view.
 *
 * `parseFallbackObject(body)` returns bounded `[key, display]` entries when the
 * display body is an UNTRUNCATED JSON object, else `null` (→ plain `<pre>`).
 * The body is untrusted extension input: the function never throws, and every
 * formatting step (including nested `JSON.stringify`) happens inside its
 * catch-all so the renderer only maps strings to text nodes.
 *
 * See change: render-unclaimed-custom-entries (design D4).
 */
import { CUSTOM_BODY_MAX_CHARS } from "../../lib/chat/event-reducer.js";

/** Keys shown before the "N more keys" notice. */
export const MAX_FALLBACK_KEYS = 50;

/** Marker `truncateOutputForDisplay` prefixes when it drops earlier lines. */
const LINE_TRUNCATION_MARKER = /^«\d+ earlier lines hidden»\n/;

export interface FallbackObjectView {
  entries: [key: string, display: string][];
  /** Keys beyond `MAX_FALLBACK_KEYS` that are not shown. */
  omitted: number;
}

export function parseFallbackObject(body: string): FallbackObjectView | null {
  try {
    // A line-truncated or tail-sliced body is partial: never present it as a whole object.
    if (LINE_TRUNCATION_MARKER.test(body) || body.length >= CUSTOM_BODY_MAX_CHARS) return null;
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const keys = Object.keys(parsed);
    if (keys.length === 0) return null;
    const entries: [string, string][] = [];
    for (const key of keys.slice(0, MAX_FALLBACK_KEYS)) {
      const v = (parsed as Record<string, unknown>)[key];
      entries.push([key, typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)]);
    }
    return { entries, omitted: Math.max(0, keys.length - MAX_FALLBACK_KEYS) };
  } catch {
    return null;
  }
}
