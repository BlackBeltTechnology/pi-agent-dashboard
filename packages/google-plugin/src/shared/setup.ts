/**
 * Setup-field validators (project id pattern, email) shared by client-json and the connect routes. Pure.
 * See change: add-google-connect (ported from gmail-plugin).
 */

/** A Google Cloud project id: 6–30 chars, lower-case letters, digits, hyphens. */
export const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** RFC 5321 maximum address length. */
const EMAIL_MAX = 254;

export function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

/**
 * One `@`, a non-empty local part, and a domain with an interior dot; no whitespace.
 * Linear time: a single `[^\s@]+\.[^\s@]+` regex backtracks polynomially because `.` also
 * matches the class (CodeQL js/polynomial-redos).
 */
export function isEmail(v: string): boolean {
  if (v.length > EMAIL_MAX || /\s/.test(v)) return false;
  const at = v.indexOf("@");
  if (at < 1 || at !== v.lastIndexOf("@")) return false;
  const domain = v.slice(at + 1);
  const dot = domain.indexOf(".", 1);
  return dot !== -1 && dot < domain.length - 1;
}
