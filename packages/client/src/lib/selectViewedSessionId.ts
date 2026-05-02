/**
 * Pure selector for the currently-viewed session id.
 *
 * The dashboard's "currently viewed" signal is the URL route `/session/:id`.
 * This helper exists so the rule is unit-testable independent of `wouter`
 * (we just pass the `match` boolean and `params` object that wouter would
 * have produced).
 *
 * See change: session-card-unread-stripes.
 */
export function selectViewedSessionId(
  match: boolean | undefined,
  params: { id?: string } | null | undefined,
): string | null {
  if (!match) return null;
  const id = params?.id;
  if (typeof id !== "string" || id.length === 0) return null;
  return id;
}
