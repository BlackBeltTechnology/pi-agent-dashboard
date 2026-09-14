/**
 * Viewer input mapping (change: add-browser-relay) — test-plan #E23 (coordinate
 * BVA) + #E24 (kind EP) + #E24's "never Runtime.*" invariant.
 */
import { describe, expect, it } from "vitest";
import { buildViewerInputCommands } from "../viewer-input.js";

const FRAME = { deviceWidth: 1280, deviceHeight: 800 };

describe("coordinate normalization BVA (E23)", () => {
  it("maps the boundary values (0,0) (0.5,0.5) (1,1) to device pixels", () => {
    const cases: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
      [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      [{ x: 0.5, y: 0.5 }, { x: 640, y: 400 }],
      [{ x: 1, y: 1 }, { x: 1280, y: 800 }],
    ];
    for (const [input, expected] of cases) {
      const r = buildViewerInputCommands({ kind: "mouse", ...input, action: "down" }, FRAME);
      expect(r.ok, JSON.stringify(input)).toBe(true);
      if (r.ok) expect(r.commands[0].params).toMatchObject(expected);
    }
  });

  it("refuses just-outside values rather than clamping them", () => {
    for (const input of [
      { x: 1.0001, y: 0 },
      { x: -0.01, y: 0 },
      { x: 0, y: 1.5 },
      { x: Number.NaN, y: 0 },
      { x: "0.5", y: 0 },
    ]) {
      expect(buildViewerInputCommands({ kind: "mouse", ...input }, FRAME).ok, JSON.stringify(input)).toBe(false);
    }
  });

  it("refuses a positional input before any frame geometry exists", () => {
    expect(buildViewerInputCommands({ kind: "mouse", x: 0.5, y: 0.5 }, undefined)).toEqual({
      ok: false,
      reason: "mouse:no-frame",
    });
  });
});

describe("input kinds (E24)", () => {
  it("maps mouse/key/scroll/bringToFront to the four allowed CDP methods", () => {
    const mouse = buildViewerInputCommands({ kind: "mouse", x: 0.5, y: 0.5, action: "move" }, FRAME);
    expect(mouse.ok && mouse.commands[0].method).toBe("Input.dispatchMouseEvent");

    const key = buildViewerInputCommands({ kind: "key", keyType: "keyDown", key: "a" }, FRAME);
    expect(key.ok && key.commands[0].method).toBe("Input.dispatchKeyEvent");

    const scroll = buildViewerInputCommands({ kind: "scroll", x: 0.5, y: 0.5, deltaY: 120 }, FRAME);
    expect(scroll.ok && scroll.commands[0].method).toBe("Input.synthesizeScrollGesture");
    expect(scroll.ok && scroll.commands[0].params).toMatchObject({ x: 640, y: 400, yDistance: 120 });

    const front = buildViewerInputCommands({ kind: "bringToFront" }, undefined);
    expect(front.ok && front.commands[0].method).toBe("Page.bringToFront");
  });

  it("a click is a press + release pair at the same point", () => {
    const r = buildViewerInputCommands({ kind: "mouse", x: 0.5, y: 0.5, action: "click" }, FRAME);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands.map((c) => c.params.type)).toEqual(["mousePressed", "mouseReleased"]);
    expect(r.commands.every((c) => c.params.x === 640 && c.params.y === 400)).toBe(true);
  });

  it("drops evaluate / empty / unknown kinds with no CDP command at all (E24)", () => {
    for (const kind of ["evaluate", "", "wheel", undefined, 42]) {
      const r = buildViewerInputCommands({ kind }, FRAME);
      expect(r.ok, String(kind)).toBe(false);
    }
  });

  it("refuses a key event carrying no key identity", () => {
    expect(buildViewerInputCommands({ kind: "key", keyType: "keyDown" }, FRAME)).toEqual({
      ok: false,
      reason: "key:empty",
    });
  });

  it("never produces a Runtime.* command for any accepted kind", () => {
    const all = [
      buildViewerInputCommands({ kind: "mouse", x: 0.5, y: 0.5 }, FRAME),
      buildViewerInputCommands({ kind: "key", key: "a" }, FRAME),
      buildViewerInputCommands({ kind: "scroll", x: 0.5, y: 0.5 }, FRAME),
      buildViewerInputCommands({ kind: "bringToFront" }, FRAME),
    ];
    for (const r of all) {
      expect(r.ok).toBe(true);
      if (r.ok) for (const c of r.commands) expect(c.method.startsWith("Runtime.")).toBe(false);
    }
  });
});
