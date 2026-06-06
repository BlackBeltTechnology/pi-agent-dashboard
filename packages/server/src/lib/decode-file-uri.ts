/**
 * Defensively decode a `file://` URI to a native path. The client tokenizer
 * already decodes `file://` before issuing requests, but a raw URI may still
 * arrive (manual API call, older client). Strips the scheme and percent-
 * decodes the payload. Non-`file://` input and decode failures are returned
 * unchanged so the caller's existing containment/resolve logic still applies.
 *
 * See change: unify-file-link-openability.
 */
export function decodeFileUri(value: string): string {
  if (!/^file:\/\//i.test(value)) return value;
  const payload = value.replace(/^file:\/\//i, "");
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
}
