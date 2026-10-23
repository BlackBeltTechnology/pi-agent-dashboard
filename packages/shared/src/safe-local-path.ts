/**
 * The ONE "this string is a same-origin request path, nothing else" predicate.
 *
 * Accepts only a string that starts with a single `/` and stays on the origin it
 * is resolved against: no scheme, no protocol-relative `//host`, no `\` host
 * trick, no control characters, no `..`-to-another-origin surprise. Used by the
 * OAuth `return` / `/auth/local-proof?next=` sanitiser (which falls back to `/`)
 * and by `pi-dashboard api` (which refuses outright), so the two can never
 * disagree about what a safe local path is.
 *
 * Dependency-free on purpose: the CLI imports it without pulling in the auth plugin.
 *
 * See change: close-container-loopback-impersonation (D4); harden-trust-and-credential-boundaries (D1).
 */
export function isSafeLocalPath(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0) return false;
  if (raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return false;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return false;
  try {
    return new URL(raw, "http://x.invalid").origin === "http://x.invalid";
  } catch {
    return false;
  }
}
