/**
 * The extension's single diagnostics sink.
 *
 * Why this module exists: pi renders an extension's stdio inside the TUI, so a
 * bare `console.log` lands in the user's prompt line — they have to clear it
 * before typing. pi's documented channels for extension output are
 * `ctx.ui.setStatus` (footer line) and `ctx.ui.notify` (transient message).
 *
 * Routing, in order:
 *   1. `PI_IMAGE_FIT_QUIET` truthy → drop the message.
 *   2. Held (load time, see `deferUntilContext`) → buffer until the first ctx.
 *   3. Latest ctx has a real UI (`hasUI === true`):
 *        info → `ui.setStatus("pi-image-fit", msg)` (no dashboard transcript row),
 *               or `ui.notify(msg, "info")` when the host has no setStatus;
 *        warn → `ui.notify(msg, "warning")`.
 *   4. Otherwise → console (print/JSON hosts, unit tests).
 *
 * Keeping the decision here means `extension.ts`, `policy.ts` and `cache.ts`
 * never name an output channel, and their injectable `warn` seams stay intact.
 * See openspec change: image-fit-quiet-tui.
 */

import { parseBool } from "./env.js";

export type Sink = (msg: string) => void;

type Level = "info" | "warning";

/** Footer slot the info telemetry occupies in pi's status line. */
export const STATUS_KEY = "pi-image-fit";

/** Upper bound on load-time messages held before the first ctx. */
export const MAX_HELD = 50;

/**
 * How long a resize report stays in the footer before the sink takes it down.
 *
 * pi keeps a status until its owner clears it, and this one reports an event
 * that is already over by the time it renders. Left pinned, it reads as "the
 * extension is working right now" for the rest of the session. Ten seconds is
 * long enough to read a one-line report and short enough that the footer
 * describes the present.
 */
export const STATUS_TTL_MS = 10_000;

interface UiChannel {
  ui: object;
  notify: (msg: string, level?: Level) => void;
  setStatus?: (key: string, text: string | undefined) => void;
}

let channel: UiChannel | null = null;
let held: Array<{ msg: string; level: Level }> | null = null;
let expiry: ReturnType<typeof setTimeout> | null = null;

function quiet(): boolean {
  return parseBool(process.env.PI_IMAGE_FIT_QUIET);
}

/**
 * Read the host UI off an event ctx. `null` when the host has no real UI
 * (pi's print/JSON `noOpUIContext` still has a no-op `notify`, so `hasUI` is
 * the only reliable signal); `undefined` when the ctx is stale (pi >=0.84
 * throws from its getters after `invalidate()`), meaning "keep what we have".
 */
function readChannel(ctx: unknown): UiChannel | null | undefined {
  try {
    const c = ctx as { hasUI?: unknown; ui?: Record<string, unknown> } | undefined;
    if (c?.hasUI !== true) return null;
    const ui = c.ui;
    if (!ui || typeof ui.notify !== "function") return null;
    return {
      ui,
      notify: ui.notify as UiChannel["notify"],
      setStatus: typeof ui.setStatus === "function" ? (ui.setStatus as UiChannel["setStatus"]) : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Point the sink at the latest event ctx. Called from every handler because
 * the factory runs before any ctx exists and pi replaces ctx on reload /
 * newSession / fork / switch (latest wins). The first call also delivers any
 * messages held since `deferUntilContext()`, through this ctx's channel.
 */
export function useUiSink(ctx: unknown): void {
  const next = readChannel(ctx);
  if (next !== undefined) channel = next;
  if (held) {
    const pending = held;
    held = null;
    for (const { msg, level } of pending) emit(msg, level);
  }
}

/**
 * Hold messages until the first `useUiSink` call. The extension factory calls
 * this first so load-time warnings reach pi's UI instead of the TUI prompt.
 * Bounded: beyond `MAX_HELD` the oldest message is dropped.
 */
export function deferUntilContext(): void {
  held = [];
}

/** Test seam: forget the UI channel and any held messages. */
export function resetUiSink(): void {
  cancelExpiry();
  channel = null;
  held = null;
}

function cancelExpiry(): void {
  if (expiry) {
    clearTimeout(expiry);
    expiry = null;
  }
}

/**
 * Arm the takedown for the status just written. Re-arming on every report keeps
 * the newest one visible for a full window instead of inheriting its
 * predecessor's deadline. The timer is unref'd: a print-mode run that resizes
 * one image must still exit when its work is done, not linger for the TTL.
 */
function scheduleStatusClear(c: UiChannel): void {
  cancelExpiry();
  const timer = setTimeout(() => {
    expiry = null;
    try {
      c.setStatus?.call(c.ui, STATUS_KEY, undefined);
    } catch {
      // The ctx can go stale between the report and its expiry; a footer line
      // that outlives its session is not worth throwing over.
    }
  }, STATUS_TTL_MS);
  timer.unref?.();
  expiry = timer;
}

function toUi(c: UiChannel, msg: string, level: Level): void {
  if (level === "info" && c.setStatus) {
    c.setStatus.call(c.ui, STATUS_KEY, msg);
    scheduleStatusClear(c);
  } else c.notify.call(c.ui, msg, level);
}

function emit(msg: string, level: Level): void {
  if (quiet()) return;
  if (held) {
    if (held.length >= MAX_HELD) held.shift();
    held.push({ msg, level });
    return;
  }
  if (channel) {
    try {
      toUi(channel, msg, level);
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
