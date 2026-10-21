/**
 * Redaction of a live-preview capability token (`/~c/<token>`) from a log field / path.
 * Its own module so the guard (which logs refused paths) and the capability store (which
 * needs the guard's locality predicate) do not import each other.
 *
 * See change: retire-trusted-networks-bypass (D5).
 */

/** `/~c/<token>` anywhere in a path or `Referer`. Tokens are base64url. */
export const CAPABILITY_SEGMENT = /\/~c\/[A-Za-z0-9_-]+/g;

/** Replace any `/~c/<token>` in a log field / path with a redaction marker. */
export function redactCapability(text: string): string {
  return text.replace(CAPABILITY_SEGMENT, "/~c/<redacted>");
}
