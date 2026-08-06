/**
 * URL for the full-resolution original behind a fitted transcript image.
 *
 * Mirrors the server's id contract (`^[0-9a-f]{64}$`) so a malformed id is
 * never requested — the zoom path would only get a 400 back, and not issuing
 * the request keeps it from flashing a doomed fetch.
 *
 * See change: fit-attachments-for-display (task 5.9b).
 */
const ATTACHMENT_ID_RE = /^[0-9a-f]{64}$/;

export function attachmentOriginalUrl(
  sessionId: string | undefined,
  attachmentId: string | undefined,
): string | null {
  if (!sessionId || !attachmentId) return null;
  if (!ATTACHMENT_ID_RE.test(attachmentId)) return null;
  return `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${attachmentId}`;
}
