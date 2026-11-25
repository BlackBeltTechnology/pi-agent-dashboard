/**
 * Redaction of a live-preview capability from a log field / path. The ONE choke point for every
 * log line that can carry a capability (D2):
 *   - `/~c/<token>`           legacy capability path segment
 *   - `<26-base32>.`          preview host label (tiers 1, 2, 4) — case-insensitive and
 *                             position-independent, because gate logs print the raw `Origin`
 *                             and an attacker-cased `K7Q4…LOCALHOST.:8000` must not leak a live label (Q6)
 *   - `/preview/<pid>`        tier-5 path id
 *   - `?k=<secret>` / `&k=`   tier-3 one-shot secret
 * Its own module so the guard (which logs refused paths) and the capability store (which
 * needs the guard's locality predicate) do not import each other.
 *
 * See change: retire-trusted-networks-bypass (D5); serve-live-previews-on-capability-origin (D2).
 */
/** `/~c/<token>` anywhere in a path or `Referer`. Tokens are base64url. */
export const CAPABILITY_SEGMENT = /\/~c\/[A-Za-z0-9_-]+/g;
/** A preview host label followed by its dot, anywhere in a value. */
const PREVIEW_LABEL = /\b[a-z2-7]{26}\./gi;
/** Tier-5 `/preview/<pid>` (the pid is whatever follows up to the next delimiter). */
const PREVIEW_PID = /\/preview\/[^/?#\s"']+/g;
/** Tier-3 one-shot secret in a query string. */
const PREVIEW_K = /([?&]k=)[^&#\s"']*/g;

/** Replace any capability in a log field / path with a redaction marker. */
export function redactCapability(text: string): string {
  return text
    .replace(CAPABILITY_SEGMENT, "/~c/<redacted>")
    .replace(PREVIEW_LABEL, "<redacted>.")
    .replace(PREVIEW_PID, "/preview/<redacted>")
    .replace(PREVIEW_K, "$1<redacted>");
}
