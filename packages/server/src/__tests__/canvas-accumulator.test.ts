/**
 * Unit tests for the server-side canvas accumulator (change: auto-canvas).
 *
 * Pure-fn style: inject spy broadcast + settings-read fns, drive the event
 * stream, assert on the recorded broadcasts. Covers S9 (replay guard), S10
 * (settle+reset), S11 (aborted turn no leak), S12 (queue_state skip), S16
 * (last declare wins), S21 (settings read-fresh, no cache).
 */

import {
  type CanvasTypes,
  DEFAULT_CANVAS_TYPES,
} from "@blackbelt-technology/pi-dashboard-shared/canvas-types.js";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CanvasAccumulator,
  type CanvasForwardedEvent,
  createCanvasAccumulator,
} from "../canvas-accumulator.js";

const CWD = "/proj";

type IntentCall = {
  sessionId: string;
  phase: "eager" | "settle";
  target: ViewTarget | null;
  mode?: "replace" | "pin";
  title?: string;
};
type ChipCall = { sessionId: string; port: number; title?: string };
type ChipExpireCall = { sessionId: string; port: number };

function harness(canvasTypes: CanvasTypes = DEFAULT_CANVAS_TYPES) {
  const intents: IntentCall[] = [];
  const chips: ChipCall[] = [];
  const chipExpires: ChipExpireCall[] = [];
  const readCanvasTypes = vi.fn((_cwd: string) => canvasTypes);
  const acc: CanvasAccumulator = createCanvasAccumulator({
    readCanvasTypes,
    broadcastIntent: (sessionId, phase, target, mode, title) =>
      intents.push({ sessionId, phase, target, mode, title }),
    broadcastServerChip: (sessionId, port, title) =>
      chips.push({ sessionId, port, title }),
    broadcastServerChipExpire: (sessionId, port) =>
      chipExpires.push({ sessionId, port }),
  });
  return { acc, intents, chips, chipExpires, readCanvasTypes };
}

function writeEvent(path: string): CanvasForwardedEvent {
  return { eventType: "tool_execution_start", data: { toolName: "write", args: { path } } };
}
function canvasEvent(args: Record<string, unknown>): CanvasForwardedEvent {
  return { eventType: "tool_execution_start", data: { toolName: "canvas", args } };
}
const AGENT_END: CanvasForwardedEvent = { eventType: "agent_end" };
const AGENT_START: CanvasForwardedEvent = { eventType: "agent_start" };
const live = { replaying: false, cwd: CWD };

describe("canvas accumulator", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  // S9 — replayed events do not drive the live canvas.
  it("S9: replayed events accumulate nothing and never broadcast", () => {
    h.acc.onEvent("s1", writeEvent("report.md"), { replaying: true, cwd: CWD });
    h.acc.onEvent("s1", AGENT_END, { replaying: true, cwd: CWD });
    expect(h.intents).toHaveLength(0);
    expect(h.chips).toHaveLength(0);
  });

  // S10 — buffer resets after agent_end (next turn starts empty).
  it("S10: settle at agent_end then reset; next turn does not resettle the old target", () => {
    h.acc.onEvent("s1", writeEvent("report.md"), live);
    h.acc.onEvent("s1", AGENT_END, live);
    const settle = h.intents.filter((i) => i.phase === "settle");
    expect(settle).toHaveLength(1);
    expect(settle[0].target).toEqual({ kind: "file", cwd: CWD, path: "report.md" });

    // A following write-less turn must produce NO settle (buffer was reset).
    h.acc.onEvent("s1", AGENT_END, live);
    expect(h.intents.filter((i) => i.phase === "settle")).toHaveLength(1);
  });

  // S11 — aborted turn (no agent_end) does not leak into the next turn.
  it("S11: aborted turn candidates do not leak into a later write-less turn", () => {
    h.acc.onEvent("s1", writeEvent("draft.md"), live);
    // Abort: reset with no settle (no agent_end fired).
    h.acc.resetTurn("s1");
    // Next turn: no writes, just a boundary. Nothing to settle.
    h.acc.onEvent("s1", AGENT_END, live);
    const settles = h.intents.filter((i) => i.phase === "settle");
    expect(settles).toHaveLength(0);
  });

  // S11 (turn-start variant) — agent_start clears an un-settled prior turn.
  it("S11: agent_start clears a prior un-settled turn's candidates", () => {
    h.acc.onEvent("s1", writeEvent("draft.md"), live); // aborted turn, no agent_end
    h.acc.onEvent("s1", AGENT_START, live); // new turn boundary
    h.acc.onEvent("s1", AGENT_END, live); // write-less turn
    expect(h.intents.filter((i) => i.phase === "settle")).toHaveLength(0);
  });

  // S12 — queue_state events are skipped.
  it("S12: queue_state events never accumulate or broadcast", () => {
    h.acc.onEvent("s1", { eventType: "queue_state" }, live);
    h.acc.onEvent("s1", AGENT_END, live);
    expect(h.intents.filter((i) => i.phase === "settle")).toHaveLength(0);
  });

  // S21 — settings are read fresh on every detect (no cache).
  it("S21: readCanvasTypes is invoked on every write detect (read-fresh)", () => {
    let types: CanvasTypes = { ...DEFAULT_CANVAS_TYPES, image: false };
    const intents: IntentCall[] = [];
    const readCanvasTypes = vi.fn((_cwd: string) => types);
    const acc = createCanvasAccumulator({
      readCanvasTypes,
      broadcastIntent: (sessionId, phase, target, mode, title) =>
        intents.push({ sessionId, phase, target, mode, title }),
      broadcastServerChip: () => {},
      broadcastServerChipExpire: () => {},
    });
    // First write of an image kind while image:false → no candidate.
    acc.onEvent("s1", writeEvent("chart.png"), live);
    expect(intents).toHaveLength(0);
    // Flip the setting mid-session; the NEXT detect must see the new value.
    types = { ...DEFAULT_CANVAS_TYPES, image: true };
    acc.onEvent("s1", writeEvent("chart.png"), live);
    expect(readCanvasTypes).toHaveBeenCalledTimes(2);
    expect(intents.filter((i) => i.phase === "eager")).toHaveLength(1);
  });

  // S16 — last declare wins for both eager update and settle.
  it("S16: two declares in one turn — eager re-crowns, settle picks the last", () => {
    h.acc.onEvent("s1", canvasEvent({ target: { kind: "file", path: "a.md" } }), live);
    h.acc.onEvent("s1", canvasEvent({ target: { kind: "file", path: "b.md" } }), live);
    const eager = h.intents.filter((i) => i.phase === "eager");
    expect(eager).toHaveLength(2);
    expect(eager[1].target).toEqual({ kind: "file", cwd: CWD, path: "b.md" });
    h.acc.onEvent("s1", AGENT_END, live);
    const settle = h.intents.filter((i) => i.phase === "settle");
    expect(settle[0].target).toEqual({ kind: "file", cwd: CWD, path: "b.md" });
  });

  // Server declare → chip path, no probe/fetch, never a settle target.
  it("server declare broadcasts a chip and never a canvas_intent", () => {
    h.acc.onEvent("s1", canvasEvent({ target: { kind: "server", port: 5173 } }), live);
    expect(h.chips).toEqual([{ sessionId: "s1", port: 5173, title: undefined }]);
    h.acc.onEvent("s1", AGENT_END, live);
    expect(h.intents).toHaveLength(0); // no eager, no settle
  });

  // S32 — a declared server chip stays actionable through its own agent_end and
  // expires only at the NEXT turn boundary (agent_start) or on abort.
  it("S32: chip survives its own agent_end; expires at the next turn boundary", () => {
    h.acc.onEvent("s1", canvasEvent({ target: { kind: "server", port: 5173 } }), live);
    h.acc.onEvent("s1", AGENT_END, live);
    // Still tappable right after the declaring turn ends.
    expect(h.chipExpires).toHaveLength(0);
    // The NEXT turn's start boundary expires it, once, echoing the port.
    h.acc.onEvent("s1", AGENT_START, live);
    expect(h.chipExpires).toEqual([{ sessionId: "s1", port: 5173 }]);
    // Idempotent: another boundary with no active chip does not re-expire.
    h.acc.onEvent("s1", AGENT_START, live);
    expect(h.chipExpires).toHaveLength(1);

    // Abort path also expires an un-settled chip.
    h.acc.onEvent("s2", canvasEvent({ target: { kind: "server", port: 6000 } }), live);
    h.acc.resetTurn("s2");
    expect(h.chipExpires).toContainEqual({ sessionId: "s2", port: 6000 });
  });

  // Eager fires only on the first DOC candidate; later DOC writes just accumulate.
  it("eager opens on the first write only; recency resolves at settle", () => {
    h.acc.onEvent("s1", writeEvent("intro.md"), live);
    h.acc.onEvent("s1", writeEvent("report.md"), live);
    const eager = h.intents.filter((i) => i.phase === "eager");
    expect(eager).toHaveLength(1);
    expect(eager[0].target).toEqual({ kind: "file", cwd: CWD, path: "intro.md" });
    h.acc.onEvent("s1", AGENT_END, live);
    const settle = h.intents.filter((i) => i.phase === "settle");
    expect(settle[0].target).toEqual({ kind: "file", cwd: CWD, path: "report.md" });
  });
});
