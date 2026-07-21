/**
 * Per-session chat input draft persistence.
 *
 * Drafts are stored in `window.localStorage` under keys of the form
 * `chat-draft:<sessionId>`. All helpers wrap `localStorage` in try/catch so
 * private-mode, quota-exhausted, or disabled-storage environments fail
 * silently rather than crashing the app.
 */

export const DRAFT_KEY_PREFIX = "chat-draft:";

/**
 * Scan `localStorage` for every `chat-draft:<sessionId>` key and return a
 * `Map<sessionId, draftText>`. Returns an empty Map if storage is unavailable
 * or read access throws.
 */
export function readAllDrafts(): Map<string, string> {
  const result = new Map<string, string>();
  try {
    const storage = globalThis.localStorage;
    if (!storage) return result;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key == null || !key.startsWith(DRAFT_KEY_PREFIX)) continue;
      const sessionId = key.slice(DRAFT_KEY_PREFIX.length);
      if (!sessionId) continue;
      const value = storage.getItem(key);
      if (value != null) result.set(sessionId, value);
    }
  } catch {
    // Private mode, disabled storage, etc. — return whatever we collected so far.
  }
  return result;
}

/**
 * Persist a single session's draft text. Writes `chat-draft:<sessionId>` in
 * `localStorage`. No-op (silent) if storage is unavailable or throws.
 */
export function writeDraft(sessionId: string, text: string): void {
  if (!sessionId) return;
  try {
    globalThis.localStorage?.setItem(DRAFT_KEY_PREFIX + sessionId, text);
  } catch {
    // Quota exceeded or disabled storage — drop the write.
  }
}

/**
 * Remove a session's draft from `localStorage`. No-op if absent or if
 * storage is unavailable / throws.
 */
export function deleteDraft(sessionId: string): void {
  if (!sessionId) return;
  try {
    globalThis.localStorage?.removeItem(DRAFT_KEY_PREFIX + sessionId);
  } catch {
    // Ignore.
  }
}
