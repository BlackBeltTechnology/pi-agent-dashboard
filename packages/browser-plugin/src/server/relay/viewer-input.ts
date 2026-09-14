/**
 * Viewer → CDP input mapping (change: add-browser-relay, spec `browser-relay`
 * "Viewer input is allowlisted").
 *
 * Pure on purpose: the whole viewer input surface is an allowlist plus a
 * coordinate transform, and both are far easier to pin exhaustively as a pure
 * function than through a socket. The tap owns the sockets; this owns the
 * decision.
 *
 * Two rules the security posture rests on:
 *  1. **Allowlist, never passthrough.** The viewer's `kind` selects a fixed CDP
 *     method; there is no path from a viewer message to an arbitrary CDP
 *     method, and in particular NONE to `Runtime.*`. An unknown kind is dropped.
 *  2. **Coordinates are normalized, never pixels.** `x`/`y` are fractions of
 *     the rendered frame (`[0,1]`), scaled here by the LAST frame's device
 *     geometry. A client that sent CSS pixels instead would land somewhere
 *     arbitrary once the tile was scaled — so a value outside `[0,1]` is a bug
 *     or an attack, and both are refused rather than clamped (clamping would
 *     silently mis-target at the edges).
 */

export interface FrameGeometry {
  deviceWidth: number;
  deviceHeight: number;
}

/** One CDP command to dispatch, in order. */
interface ViewerCommand {
  method: string;
  params: Record<string, unknown>;
}

export type ViewerInputResult =
  | { ok: true; commands: ViewerCommand[] }
  | { ok: false; reason: string };

/** Input kinds the viewer may send. Anything else is refused. */
const ALLOWED_KINDS = ["mouse", "key", "scroll", "bringToFront"] as const;

function isNormalized(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Scale a normalized axis by its device extent. Rounds, because CDP positions
 * are integral CSS pixels; `1` therefore lands exactly on `deviceSize`.
 */
function scale(value: number, extent: number): number {
  return Math.round(value * extent);
}

/**
 * Translate one viewer input message into the CDP commands it authorizes.
 * `geometry` is the LAST frame's metadata for this tab; when it is absent the
 * tab has not produced a frame yet, so mouse/scroll positions have no frame of
 * reference and are refused (key/bringToFront need no geometry).
 */
export interface ViewerInputMessage {
  kind?: unknown;
  x?: unknown;
  y?: unknown;
  action?: unknown;
  button?: unknown;
  clickCount?: unknown;
  deltaX?: unknown;
  deltaY?: unknown;
  keyType?: unknown;
  key?: unknown;
  code?: unknown;
  text?: unknown;
}

export function buildViewerInputCommands(
  msg: ViewerInputMessage,
  geometry: FrameGeometry | undefined,
): ViewerInputResult {
  const kind = msg.kind;
  if (typeof kind !== "string" || !(ALLOWED_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, reason: `kind:${String(kind)}` };
  }

  if (kind === "bringToFront") {
    // Needs no geometry: this is the recovery path when a hidden tab produces
    // no frames, so it MUST be issuable before any frame exists.
    return { ok: true, commands: [{ method: "Page.bringToFront", params: {} }] };
  }

  // `key` carries no position, so it is handled BEFORE the geometry gate — a
  // keyboard event must not be refused just because no frame has arrived.
  if (kind === "key") return keyCommands(msg);

  // Remaining kinds (mouse / scroll) are positional: they need a frame to scale
  // against and normalized in-range coordinates.
  if (!geometry) return { ok: false, reason: `${kind}:no-frame` };
  if (!isNormalized(msg.x) || !isNormalized(msg.y)) return { ok: false, reason: `${kind}:coords` };

  if (kind === "mouse") return mouseCommands(msg, geometry);
  return scrollCommands(msg, geometry);
}

function keyCommands(msg: ViewerInputMessage): ViewerInputResult {
  const type = typeof msg.keyType === "string" ? msg.keyType : "keyDown";
  if (type !== "keyDown" && type !== "keyUp" && type !== "char") {
    return { ok: false, reason: `key:type:${type}` };
  }
  if (typeof msg.key !== "string" && typeof msg.text !== "string" && typeof msg.code !== "string") {
    // A key event with no key identity at all cannot be dispatched.
    return { ok: false, reason: "key:empty" };
  }
  const params: Record<string, unknown> = { type };
  if (typeof msg.key === "string") params.key = msg.key;
  if (typeof msg.code === "string") params.code = msg.code;
  if (typeof msg.text === "string") params.text = msg.text;
  return { ok: true, commands: [{ method: "Input.dispatchKeyEvent", params }] };
}

function mouseCommands(
  msg: ViewerInputMessage,
  geometry: FrameGeometry,
): ViewerInputResult {
  const x = scale(msg.x as number, geometry.deviceWidth);
  const y = scale(msg.y as number, geometry.deviceHeight);
  const base = {
    x,
    y,
    button: typeof msg.button === "string" ? msg.button : "left",
    clickCount: typeof msg.clickCount === "number" ? msg.clickCount : 1,
  };
  const action = typeof msg.action === "string" ? msg.action : "click";
  if (action === "move") return { ok: true, commands: [{ method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", ...base } }] };
  if (action === "down") return { ok: true, commands: [{ method: "Input.dispatchMouseEvent", params: { type: "mousePressed", ...base } }] };
  if (action === "up") return { ok: true, commands: [{ method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", ...base } }] };
  if (action !== "click") return { ok: false, reason: `mouse:action:${action}` };
  // A click is a press + release pair at the same point — CDP has no `click` type.
  return {
    ok: true,
    commands: [
      { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", ...base } },
      { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", ...base } },
    ],
  };
}

function scrollCommands(
  msg: ViewerInputMessage,
  geometry: FrameGeometry,
): ViewerInputResult {
  const x = scale(msg.x as number, geometry.deviceWidth);
  const y = scale(msg.y as number, geometry.deviceHeight);
  const xDistance = typeof msg.deltaX === "number" && Number.isFinite(msg.deltaX) ? msg.deltaX : 0;
  const yDistance = typeof msg.deltaY === "number" && Number.isFinite(msg.deltaY) ? msg.deltaY : 0;
  return {
    ok: true,
    commands: [{ method: "Input.synthesizeScrollGesture", params: { x, y, xDistance, yDistance } }],
  };
}
