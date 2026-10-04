/**
 * The extension's single diagnostics sink.
 *
 * Why this module exists: pi renders an extension's stdio inside the TUI, so a
 * bare `console.log` lands in the user's prompt line — they have to clear it
 * before typing. pi's documented channel for extension output is
 * `ctx.ui.notify` (see pi's extensions docs), which draws a transient line in
 * pi's own UI instead.
 *
 * Routing, in order:
 *   1. `PI_IMAGE_FIT_QUIET` truthy → drop the message.
 *   2. A context with `ui.notify` was seen → notify (TUI/RPC hosts).
 *   3. Otherwise → console (print/JSON hosts, unit tests), as before.
 *
 * Keeping the decision here means `extension.ts`, `policy.ts` and `cache.ts`
 * never name an output channel, and their injectable `warn` seams stay intact.
 */

export type Sink = (msg: string) => void;

type NotifyLevel = "info" | "warning";
type Notify = (msg: string, level?: NotifyLevel) => void;

let uiNotify: Notify | null = null;

/** Truthy check shared with policy.ts semantics: 1 / true / yes, any case. */
function isTruthy(raw: string | undefined): boolean {
  return raw !== undefined && /^(1|true|yes)$/i.test(raw.trim());
}

function quiet(): boolean {
  return isTruthy(process.env.PI_IMAGE_FIT_QUIET);
}

/**
 * Remember the host's UI channel the first time a context offers one.
 *
 * Called from the event handlers because the extension factory runs before any
 * context exists. Cheap and idempotent: one property read once a sink is held.
 */
export function useUiSink(ctx: unknown): void {
  let ui: { notify?: unknown } | undefined;
  try {
    // pi's noOpUIContext (print/JSON) has a no-op notify: only adopt a real UI.
    const c = ctx as { hasUI?: unknown; ui?: { notify?: unknown } } | undefined;
    if (c?.hasUI !== true) return;
    ui = c.ui;
  } catch {
    return; // stale ctx (pi >=0.84 throws after invalidate)
  }
  const notify = ui?.notify;
  if (typeof notify !== "function") return;
  // Latest wins: a replacement session's ctx supersedes the previous one.
  uiNotify = (msg: string, level: NotifyLevel = "info") => {
    (notify as Notify).call(ui, msg, level);
  };
}

/** Test seam: forget the remembered UI channel. */
export function resetUiSink(): void {
  uiNotify = null;
}

function emit(msg: string, level: NotifyLevel): void {
  if (quiet()) return;
  if (uiNotify) {
    try {
      uiNotify(msg, level);
      return;
    } catch {
      // A failing UI channel must never break a resize: fall through to console.
    }
  }
  if (level === "warning") console.warn(msg);
  else console.log(msg);
}

/** Telemetry: one line per successful resize. */
export const info: Sink = (msg) => emit(msg, "info");

/** Recoverable failure: the extension always falls through to the original image. */
export const warn: Sink = (msg) => emit(msg, "warning");
