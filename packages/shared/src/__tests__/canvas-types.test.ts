/**
 * Canvas-type registry (Decision 6). Pure merge + detect-gate scenarios
 * S18, S19, S20, S22. (S21 read-fresh is server wiring — see the server test.)
 * See change: auto-canvas.
 */
import { describe, expect, it } from "vitest";
import { detectCanvasIntent, selectCanvasTarget } from "../canvas-detect.js";
import { DEFAULT_CANVAS_TYPES, mergeCanvasTypes } from "../canvas-types.js";

describe("canvas-type registry", () => {
  it("S18 — absent config auto-canvases every kind (all-on default)", () => {
    const eff = mergeCanvasTypes(undefined, undefined);
    expect(eff).toEqual(DEFAULT_CANVAS_TYPES);
    const c = detectCanvasIntent("Write", { path: "report.md" }, "/p", eff);
    expect(c).not.toBeNull();
  });

  it("S19 — project disables a kind for detection only", () => {
    const eff = mergeCanvasTypes(undefined, { image: false });
    expect(detectCanvasIntent("Write", { path: "chart.png" }, "/p", eff)).toBeNull();
  });

  it("S20 — a declare bypasses the registry (image disabled, declare still wins)", () => {
    // The registry never gates selectCanvasTarget; a DECLARE candidate is
    // routed regardless of canvasTypes.
    const target = selectCanvasTarget([
      {
        prio: "DECLARE",
        target: { kind: "file", cwd: "/p", path: "chart.png" },
        kind: "image",
      },
    ]);
    expect(target).toEqual({ kind: "file", cwd: "/p", path: "chart.png" });
  });

  it("S22 — sparse shallow merge: global {html:false} + project {} disables html", () => {
    const eff = mergeCanvasTypes({ html: false }, {});
    expect(eff.html).toBe(false);
    expect(eff.markdown).toBe(true); // untouched kinds stay on
    expect(detectCanvasIntent("Write", { path: "x.html" }, "/p", eff)).toBeNull();
  });

  it("project override wins over global for the same kind", () => {
    expect(mergeCanvasTypes({ image: false }, { image: true }).image).toBe(true);
  });
});
