/**
 * E49 (task 13.13) — runtime: slide rail topologies.
 *
 * `rail` decides where consecutive slide anchors sit and which way each slide
 * faces. The invariants that matter are the ones a deck notices: consecutive
 * anchors stay `spacing` apart (so backgrounds never bleed), the camera always
 * sits `distance` in front of the slide it frames, and the cull radius is tight
 * enough that a slide behind the camera cannot occlude the one in view.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { anchorFor, cullRadius, type Rail } from "../camera.js";
import { projectRect } from "../measure.js";

const RAILS: Rail[] = ["line", "orbit", "tunnel", "helix", "grid"];
const COUNT = 12;
const SPACING = 40;

function anchors(rail: Rail, count = COUNT) {
  return Array.from({ length: count }, (_, i) => anchorFor(i, 9, SPACING, rail, count));
}

describe("E49 rail geometry", () => {
  it("line keeps the v1 anchors exactly", () => {
    const a = anchorFor(3, 9, SPACING, "line", COUNT);
    expect(a.pos.toArray()).toEqual([120, 0, 0]);
    expect(a.cam.toArray()).toEqual([120.6, 0.6, 9]);
    expect(a.rotY).toBe(0);
  });

  it("defaults to line when no rail is named", () => {
    expect(anchorFor(3).pos.toArray()).toEqual(anchorFor(3, 9, SPACING, "line", COUNT).pos.toArray());
  });

  it.each(RAILS)("%s never puts two slides closer than half a spacing", (rail) => {
    const all = anchors(rail);
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        expect(all[i].pos.distanceTo(all[j].pos)).toBeGreaterThan(SPACING * 0.5);
      }
    }
  });

  // `grid` is exempt: stepping off the end of a row jumps back across it, which
  // is the point of the topology, not a defect.
  it.each(RAILS.filter((r) => r !== "grid"))("%s advances by about one spacing per slide", (rail) => {
    const all = anchors(rail);
    for (let i = 1; i < all.length; i += 1) {
      const gap = all[i].pos.distanceTo(all[i - 1].pos);
      // `orbit`/`helix` walk an arc, so the chord is shorter than the arc length.
      expect(gap).toBeGreaterThan(SPACING * 0.5);
      expect(gap).toBeLessThanOrEqual(SPACING * 1.5);
    }
  });

  it.each(RAILS)("%s puts the camera `distance` in front of the slide it frames", (rail) => {
    for (const a of anchors(rail)) {
      // Ignore the fixed (0.6, 0.6) framing nudge: the radial distance from the
      // slide to the camera is what decides how much fits in frame.
      expect(a.cam.distanceTo(a.target)).toBeGreaterThan(8);
      expect(a.cam.distanceTo(a.target)).toBeLessThan(10.5);
      expect(a.target.distanceTo(a.pos)).toBeLessThan(1e-9);
    }
  });

  it("orbit and helix turn each slide to face its camera", () => {
    for (const rail of ["orbit", "helix"] as const) {
      const turned = anchors(rail).map((a) => a.rotY);
      expect(new Set(turned.map((r) => r.toFixed(4))).size).toBe(COUNT);
      // A slide's own +Z axis must point at its camera, or it faces away.
      for (const a of anchors(rail)) {
        const facing = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), a.rotY);
        const toCam = a.cam.clone().sub(a.pos).setY(0).normalize();
        expect(facing.dot(toCam)).toBeGreaterThan(0.95);
      }
    }
  });

  it("helix rises while orbit stays level", () => {
    const orbitY = anchors("orbit").map((a) => a.pos.y);
    expect(Math.max(...orbitY) - Math.min(...orbitY)).toBeLessThan(1e-9);
    const helixY = anchors("helix").map((a) => a.pos.y);
    for (let i = 1; i < helixY.length; i += 1) expect(helixY[i]).toBeGreaterThan(helixY[i - 1]);
  });

  it("tunnel recedes along -Z and culls hard enough to hide the slide behind", () => {
    const a = anchors("tunnel");
    for (let i = 1; i < a.length; i += 1) expect(a[i].pos.z).toBeLessThan(a[i - 1].pos.z);
    expect(a[0].pos.x).toBe(0);
    // The camera stands between slide i and slide i-1, so a cull radius that
    // reached a neighbour would leave the previous slide floating in frame.
    expect(cullRadius(SPACING, "tunnel")).toBeLessThan(SPACING);
  });

  it("grid wraps into rows and columns", () => {
    const a = anchors("grid", 9);
    const cols = new Set(a.map((n) => n.pos.x)).size;
    const rows = new Set(a.map((n) => n.pos.y)).size;
    expect(cols).toBeGreaterThan(1);
    expect(rows).toBeGreaterThan(1);
    expect(cols * rows).toBeGreaterThanOrEqual(9);
  });

  it("cull radius tracks spacing so a wide rail never culls the framed slide", () => {
    for (const rail of RAILS) {
      expect(cullRadius(120, rail)).toBeGreaterThan(cullRadius(40, rail));
      // Must always clear the camera's own distance from the slide.
      expect(cullRadius(40, rail)).toBeGreaterThan(9);
    }
  });
});

/**
 * E50 (task 13.13) — measurement must be rotation-invariant.
 *
 * `measure()` projected a WORLD-axis-aligned `Box3`, which inflates as soon as
 * a slide is turned (orbit/helix rotate every slide but the last). A title
 * measured 1.5x its real size tripped `fit` findings on a layout that was
 * actually correct, so the box has to be taken in the object's own frame.
 */
describe("E50 projected rect is rotation-invariant", () => {
  function screenRect(rotY: number) {
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 300);
    const slide = new THREE.Group();
    const anchor = anchorFor(0, 9, SPACING, "line", 1);
    slide.position.copy(anchor.pos);
    slide.rotation.y = rotY;
    // A plate that is wide, tall and thin — the shape an AABB inflates most.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.9, 0.08));
    plate.position.set(-2.4, -0.35, 0);
    slide.add(plate);
    slide.updateMatrixWorld(true);

    // Put the camera where that slide's own anchor puts it, turned the same way.
    const cam = new THREE.Vector3(0.6, 0.6, 9).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY).add(anchor.pos);
    camera.position.copy(cam);
    camera.lookAt(anchor.pos);
    camera.updateMatrixWorld(true);
    return projectRect(plate, camera, 1920, 1080) as { x: number; y: number; w: number; h: number };
  }

  it("measures the same plate identically however the slide is turned", () => {
    const straight = screenRect(0);
    for (const rot of [Math.PI / 5, Math.PI / 2, (2 * Math.PI) / 3]) {
      const turned = screenRect(rot);
      expect(turned.w).toBeCloseTo(straight.w, 3);
      expect(turned.h).toBeCloseTo(straight.h, 3);
      expect(turned.y).toBeCloseTo(straight.y, 3);
    }
  });
});
