/**
 * Demo `editor-pane-file-handler` validator (fixture). Plain ESM, no TS loader:
 * core `import()`s it by file URL inside a worker_thread.
 * Accepts any non-empty content; rejects content starting with the literal `REJECT`.
 * See change: add-editor-pane-file-handlers (D4, task 6.1).
 */
const REJECT = [0x52, 0x45, 0x4a, 0x45, 0x43, 0x54]; // "REJECT"

export function validate(bytes, _ext) {
  if (!bytes || bytes.length === 0) return { ok: false, reason: "empty document" };
  if (bytes.length >= REJECT.length && REJECT.every((b, i) => bytes[i] === b)) {
    return { ok: false, reason: "demo validator: content starts with REJECT" };
  }
  return { ok: true };
}
