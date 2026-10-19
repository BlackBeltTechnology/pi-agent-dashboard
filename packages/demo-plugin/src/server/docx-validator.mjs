// Demo file-handler validator (fixture). Runs in a worker thread via
// `ctx.registerFileValidator`: accepts any non-empty bytes except ones that
// contain the marker `REJECT-ME` (lets e2e exercise the 422 / "rejected" path).
// See change: add-editor-pane-file-handlers (6.1).
export function validate(bytes) {
  if (!bytes || bytes.length === 0) return { ok: false, reason: "empty document" };
  const text = Buffer.from(bytes).toString("latin1");
  if (text.includes("REJECT-ME")) return { ok: false, reason: "demo validator rejected the marker" };
  return { ok: true };
}
