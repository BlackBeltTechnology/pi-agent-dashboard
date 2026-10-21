/**
 * Setup-field validators shared by the wizard (instant feedback) and the
 * server route (authoritative): project id and owner account. Pure.
 * See change: improve-gmail-plugin-setup-ux.
 */

/** A Google Cloud project id: 6–30 chars, lower-case letters, digits, hyphens. */
export const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** RFC 5321 maximum address length. */
const EMAIL_MAX = 254;

export type ProjectIdClass = "ok" | "empty" | "looks_like_name" | "invalid";

export function normalizeProjectId(v: string): string {
  return v.trim();
}

export function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

/** `looks_like_name`: the console's display name (uppercase or whitespace) typed instead of the id. */
export function classifyProjectId(v: string): ProjectIdClass {
  const id = normalizeProjectId(v);
  if (!id) return "empty";
  if (/[A-Z\s]/.test(id)) return "looks_like_name";
  return PROJECT_ID_RE.test(id) ? "ok" : "invalid";
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
