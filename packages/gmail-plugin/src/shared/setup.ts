/**
 * Setup-field validators shared by the wizard (instant feedback) and the
 * server route (authoritative): project id and owner account. Pure.
 * See change: improve-gmail-plugin-setup-ux.
 */

/** A Google Cloud project id: 6–30 chars, lower-case letters, digits, hyphens. */
export const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export function isEmail(v: string): boolean {
  return EMAIL_RE.test(v);
}
