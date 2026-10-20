/**
 * Supervised-mode control-message guard.
 *
 * `set_supervised` crosses the server → bridge socket as untrusted JSON, so the
 * bridge validates it before touching the mode map. A malformed payload yields
 * `undefined` (ignored: mode kept, no pending prompt resolved).
 * Imports no dashboard protocol types.
 * See change: add-supervised-tool-approval (design D4).
 */

export interface ParsedSetSupervised {
  on: boolean;
  /** Per-session monotonic flip revision; absent when not a non-negative integer. */
  rev?: number;
}

/** Strict parse: `on` must be a real boolean; `rev` is kept only as a non-negative integer. */
export function parseSetSupervised(msg: unknown): ParsedSetSupervised | undefined {
  if (msg === null || typeof msg !== "object") return undefined;
  const m = msg as Record<string, unknown>;
  if (typeof m.on !== "boolean") return undefined;
  const out: ParsedSetSupervised = { on: m.on };
  if (typeof m.rev === "number" && Number.isInteger(m.rev) && m.rev >= 0) out.rev = m.rev;
  return out;
}
