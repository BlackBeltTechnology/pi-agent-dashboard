/**
 * Setup-field validators (project id pattern, email) shared by client-json and the connect routes. Pure.
 * See change: add-google-connect (ported from gmail-plugin).
 */

/** A Google Cloud project id: 6–30 chars, lower-case letters, digits, hyphens. */
export const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** Google APIs the organisation project needs, one per product (service names for `gcloud services enable`). */
export const GOOGLE_APIS = [
  "gmail.googleapis.com",
  "calendar-json.googleapis.com",
  "drive.googleapis.com",
  "docs.googleapis.com",
  "sheets.googleapis.com",
  "slides.googleapis.com",
  "tasks.googleapis.com",
  "people.googleapis.com",
] as const;

/** The one-line command the manual wizard offers to enable every product API of a project. */
function enableApisCommand(projectId: string): string {
  return `gcloud services enable ${GOOGLE_APIS.join(" ")} --project ${projectId}`;
}

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
 * The project the wizard is setting up (`expected`) vs the project of an uploaded client JSON. A warning only,
 * never a refusal (scenario-gate A6). It compares with the wizard's own project — the client being set up —
 * never with the project of another client. `null` when either side is unknown or they agree.
 */
export function projectMismatch(expected: unknown, uploaded: string | undefined): { expected: string; uploaded: string } | null {
  if (typeof expected !== "string" || !uploaded) return null;
  const want = normalizeProjectId(expected);
  return want && want !== uploaded ? { expected: want, uploaded } : null;
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
