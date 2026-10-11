/**
 * Pi's own session-name sanitization: collapse newlines to single spaces and
 * trim. Shared so the bridge namer and the server provenance guard compare
 * names identically. See change: investigate-auto-name-provenance-relabel.
 */
export function sanitizeSessionName(name: string): string {
  return name.replace(/[\r\n]+/g, " ").trim();
}
