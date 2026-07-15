/**
 * Unit coverage for the pure auto-canvas decision core (change: auto-canvas,
 * Sections 6–7). Pins the responsive viewport gate (S23–S25) and the
 * two-phase per-session state reducer (S26/S27).
 */

import type {
  CanvasIntentMessage,
  CanvasServerChipMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  canvasViewportTier,
  classifyServerProbe,
  EMPTY_CANVAS_STATE,
  expireCanvasChip,
  gateAllowsAutoOpen,
  reduceCanvasChip,
  reduceCanvasIntent,
  sameTarget,
} from "../canvas-gate.js";

const fileA: ViewTarget = { kind: "file", cwd: "/repo", path: "report.md" };
const fileB: ViewTarget = { kind: "file", cwd: "/repo", path: "other.md" };

function intent(partial: Partial<CanvasIntentMessage>): CanvasIntentMessage {
  return {
    type: "canvas_intent",
    sessionId: "s1",
    phase: "eager",
    target: null,
    ...partial,
  };
}

describe("canvasViewportTier (S23/S24/S25 gate)", () => {
  it("desktop = ≥1024w ∧ ≥600h", () => {
    expect(canvasViewportTier(1024, 700)).toBe("desktop"); // S23
    expect(canvasViewportTier(1440, 900)).toBe("desktop");
  });

  it("tablet = 768–1023w, ≥600h", () => {
    expect(canvasViewportTier(1023, 700)).toBe("tablet"); // S24
    expect(canvasViewportTier(768, 600)).toBe("tablet");
  });

  it("mobile = <768w OR <600h (mobile arm checked first)", () => {
    expect(canvasViewportTier(767, 800)).toBe("mobile"); // S25
    expect(canvasViewportTier(1024, 500)).toBe("mobile"); // short landscape
    expect(canvasViewportTier(500, 900)).toBe("mobile");
  });
});

describe("gateAllowsAutoOpen", () => {
  it("desktop + tablet auto-open; mobile degrades to chip", () => {
    expect(gateAllowsAutoOpen("desktop")).toBe(true);
    expect(gateAllowsAutoOpen("tablet")).toBe(true);
    expect(gateAllowsAutoOpen("mobile")).toBe(false);
  });
});

describe("sameTarget", () => {
  it("compares file cwd+path and url", () => {
    expect(sameTarget(fileA, { kind: "file", cwd: "/repo", path: "report.md" })).toBe(true);
    expect(sameTarget(fileA, fileB)).toBe(false);
    expect(sameTarget({ kind: "url", url: "u" }, { kind: "url", url: "u" })).toBe(true);
    expect(sameTarget(null, null)).toBe(true);
    expect(sameTarget(fileA, null)).toBe(false);
  });
});

describe("reduceCanvasIntent — eager (S26 liveness)", () => {
  it("null eager target is a no-op", () => {
    expect(reduceCanvasIntent(EMPTY_CANVAS_STATE, intent({ phase: "eager", target: null }))).toBe(
      EMPTY_CANVAS_STATE,
    );
  });

  it("first eager write opens immediately", () => {
    const next = reduceCanvasIntent(EMPTY_CANVAS_STATE, intent({ phase: "eager", target: fileA }));
    expect(next.target).toEqual(fileA);
    expect(next.phase).toBe("eager");
    expect(next.version).toBe(1);
  });

  it("same-target rewrite bumps version (refresh in place)", () => {
    const s1 = reduceCanvasIntent(EMPTY_CANVAS_STATE, intent({ phase: "eager", target: fileA }));
    const s2 = reduceCanvasIntent(s1, intent({ phase: "eager", target: fileA }));
    expect(s2.target).toEqual(fileA);
    expect(s2.version).toBe(2);
  });

  it("different eager target replaces content when nothing pinned", () => {
    const s1 = reduceCanvasIntent(EMPTY_CANVAS_STATE, intent({ phase: "eager", target: fileA }));
    const s2 = reduceCanvasIntent(s1, intent({ phase: "eager", target: fileB }));
    expect(s2.target).toEqual(fileB);
  });

  it("a pinned slot is not disturbed by a different eager target", () => {
    const pinned = reduceCanvasIntent(
      EMPTY_CANVAS_STATE,
      intent({ phase: "eager", target: fileA, mode: "pin" }),
    );
    const s2 = reduceCanvasIntent(pinned, intent({ phase: "eager", target: fileB }));
    expect(s2.target).toEqual(fileA);
  });
});

describe("reduceCanvasIntent — settle (turn end)", () => {
  it("settle fixes the winning target", () => {
    const s1 = reduceCanvasIntent(EMPTY_CANVAS_STATE, intent({ phase: "eager", target: fileA }));
    const s2 = reduceCanvasIntent(s1, intent({ phase: "settle", target: fileB }));
    expect(s2.target).toEqual(fileB);
    expect(s2.phase).toBe("settle");
  });

  it("null settle drops a transient slot but keeps a pin", () => {
    const transient = reduceCanvasIntent(EMPTY_CANVAS_STATE, intent({ phase: "eager", target: fileA }));
    expect(reduceCanvasIntent(transient, intent({ phase: "settle", target: null })).target).toBeNull();

    const pinned = reduceCanvasIntent(
      EMPTY_CANVAS_STATE,
      intent({ phase: "eager", target: fileA, mode: "pin" }),
    );
    expect(reduceCanvasIntent(pinned, intent({ phase: "settle", target: null })).target).toEqual(fileA);
  });

  it("null settle preserves an existing chip", () => {
    const withChip = reduceCanvasChip(EMPTY_CANVAS_STATE, {
      type: "canvas_server_chip",
      sessionId: "s1",
      port: 5173,
    });
    const settled = reduceCanvasIntent(withChip, intent({ phase: "settle", target: null }));
    expect(settled.chip).toEqual({ kind: "server", port: 5173, title: undefined });
  });
});

describe("server chip (S29/S32)", () => {
  const chipMsg: CanvasServerChipMessage = { type: "canvas_server_chip", sessionId: "s1", port: 5173 };

  it("surfaces a chip carrying only the port (no host)", () => {
    const next = reduceCanvasChip(EMPTY_CANVAS_STATE, chipMsg);
    expect(next.chip).toEqual({ kind: "server", port: 5173, title: undefined });
    expect(next.chip && "host" in next.chip).toBe(false);
  });

  it("expires the chip at turn boundary / server-exit", () => {
    const withChip = reduceCanvasChip(EMPTY_CANVAS_STATE, chipMsg);
    expect(expireCanvasChip(withChip).chip).toBeNull();
    // idempotent when already empty
    expect(expireCanvasChip(EMPTY_CANVAS_STATE)).toBe(EMPTY_CANVAS_STATE);
  });

  it("consumes an expire:true broadcast for the matching port (S32)", () => {
    const withChip = reduceCanvasChip(EMPTY_CANVAS_STATE, chipMsg);
    const expired = reduceCanvasChip(withChip, {
      type: "canvas_server_chip",
      sessionId: "s1",
      port: 5173,
      expire: true,
    });
    expect(expired.chip).toBeNull();
  });

  it("ignores an expire:true broadcast for a non-matching port", () => {
    const withChip = reduceCanvasChip(EMPTY_CANVAS_STATE, chipMsg);
    const expired = reduceCanvasChip(withChip, {
      type: "canvas_server_chip",
      sessionId: "s1",
      port: 9999,
      expire: true,
    });
    expect(expired.chip).toEqual({ kind: "server", port: 5173, title: undefined });
  });
});

describe("classifyServerProbe (S30/S31 chip tap)", () => {
  it("reachable probe → iframe", () => {
    expect(classifyServerProbe({ aborted: false, ok: true })).toBe("iframe");
  });

  it("refused / proxy error → not-running (S30), no iframe", () => {
    expect(classifyServerProbe({ aborted: false, ok: false })).toBe("not-running");
  });

  it(">3000ms abort → not-responding (S31), checked before status", () => {
    // Even if a stale `ok` slipped through, an abort always wins.
    expect(classifyServerProbe({ aborted: true, ok: false })).toBe("not-responding");
    expect(classifyServerProbe({ aborted: true, ok: true })).toBe("not-responding");
  });
});
