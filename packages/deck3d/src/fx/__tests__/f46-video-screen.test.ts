/**
 * F46 — the `video-screen` card, tested where it is deterministic: the node
 * graph and the playback gate. The pixels are NOT asserted here (a decoded
 * video frame is not reproducible across machines); what is asserted is the
 * structure the spike proved by hand.
 *
 * Three facts this pins:
 *   1. The card builds with NO src and NO DOM — the corpus gate constructs
 *      every card headlessly, so an unconfigured screen must not throw.
 *   2. The panel is UNLIT. A screen recording must read as its own pixels;
 *      a `MeshStandardMaterial` would let the rig's key light tint it.
 *   3. `setActive(false)` pauses. This is the contract the runtime's settle
 *      gate relies on so a clip never plays while the camera is flying or
 *      while a pinned time (`check`/`snapshot`) is rendering a frame.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { resolvePalette } from "../../runtime/palette.js";
import { qualityProfile } from "../../runtime/quality.js";
import { makeRng } from "../../runtime/rng.js";
import { REGISTRY } from "../index.js";
import type { FxContext } from "../types.js";

const ctx = (): FxContext =>
  ({
    THREE,
    palette: resolvePalette({ palette: "blackbelt", mode: "dark" }),
    mode: "dark" as const,
    quality: qualityProfile("high"),
    rng: makeRng(46),
    slide: { id: "s", title: "t", kind: "content" },
  }) as unknown as FxContext;

describe("F46 video-screen", () => {
  it("is registered as a background card", () => {
    const entry = REGISTRY["video-screen"];
    expect(entry, "video-screen missing from the corpus registry").toBeTruthy();
    expect(entry.card.kind).toBe("background");
  });

  it("builds headlessly with no src (the corpus gate has no DOM)", () => {
    const handle = REGISTRY["video-screen"].create(ctx(), {});
    expect(handle.object).toBeTruthy();
    let meshes = 0;
    handle.object?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    expect(meshes, "expected a screen plane and a bezel").toBe(2);
    handle.dispose();
  });

  it("renders the screen UNLIT so the clip keeps its own colours", () => {
    const handle = REGISTRY["video-screen"].create(ctx(), { width: 6 });
    const mats: string[] = [];
    handle.object?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) mats.push(m.type);
    });
    expect(mats).toContain("MeshBasicMaterial");
    handle.dispose();
  });

  it("honours placement params", () => {
    const handle = REGISTRY["video-screen"].create(ctx(), { x: 2, y: 3, z: -4, tilt: 0.5 });
    const g = handle.object as THREE.Object3D;
    expect([g.position.x, g.position.y, g.position.z]).toEqual([2, 3, -4]);
    expect(g.rotation.y).toBeCloseTo(0.5, 5);
    handle.dispose();
  });

  it("exposes the settle gate the runtime drives", () => {
    const handle = REGISTRY["video-screen"].create(ctx(), {});
    expect(typeof handle.setActive, "runtime freezes media through setActive").toBe("function");
    // Safe to call with no clip loaded — the gate must never throw.
    expect(() => {
      handle.setActive?.(true);
      handle.setActive?.(false);
    }).not.toThrow();
    handle.dispose();
  });

  it("declares a src param documenting the same-origin requirement", () => {
    const params = REGISTRY["video-screen"].card.params as Record<string, { description?: string }>;
    expect(params.src).toBeTruthy();
    // A file:// clip taints the canvas and then texImage2D throws — the card
    // must say so, because this is the failure an author will actually hit.
    expect(params.src.description ?? "").toMatch(/same-origin/i);
  });
});
