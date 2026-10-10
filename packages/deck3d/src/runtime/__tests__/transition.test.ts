import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { anchorFor } from "../camera.js";
import { easeInOut, makeMotion, resolveTransition, reversed, travelFrame, type Pose } from "../transition.js";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const poseOf = (i: number, rail: "line" | "tunnel" | "orbit" = "line"): Pose => {
  const a = anchorFor(i, 9, 40, rail, 8);
  return { pos: a.cam, target: a.target };
};
const close = (a: THREE.Vector3, b: THREE.Vector3, eps = 1e-6) => expect(a.distanceTo(b)).toBeLessThan(eps);

/** The pre-change `stepAnim` formulas, kept here as the regression oracle. */
function legacy(mode: string, from: Pose, to: Pose, t: number): Pose {
  const k = easeInOut(t);
  const pos = from.pos.clone().lerp(to.pos, k);
  const target = from.target.clone().lerp(to.target, k);
  if (mode === "swing") {
    const mid = from.target.clone().add(to.target).multiplyScalar(0.5);
    const out = pos.clone().sub(mid).normalize();
    pos.addScaledVector(out, Math.sin(t * Math.PI) * 6);
  }
  return { pos, target };
}

const FLYING = ["dolly", "swing", "revolve", "crane", "bank", "flythrough", "fade", "iris", "cut"];

describe("transition motions", () => {
  const A = poseOf(2);
  const B = poseOf(3);

  it("dolly and swing reproduce the legacy stepAnim poses", () => {
    for (const mode of ["dolly", "swing"]) {
      const m = makeMotion(mode, A, B);
      for (const t of [0, 0.1, 0.37, 0.5, 0.8, 1]) {
        const want = legacy(mode, A, B, t);
        close(m(t).pos, want.pos);
        close(m(t).target, want.target);
      }
    }
  });

  it("every kind lands exactly: anchor pose, roll 0, deck fov, no cover", () => {
    for (const kind of [...FLYING, "path"]) {
      const m = makeMotion(kind, A, B, { baseFov: 42, path: { keys: [{ t: 0.5, offset: [0.2, 0.1, 0], roll: 20, fov: 60 }] } });
      const s = m(1);
      close(s.pos, B.pos);
      close(s.target, B.target);
      expect(s.roll, kind).toBe(0);
      expect(s.fov, kind).toBe(42);
      expect(s.cover, kind).toBe(0);
    }
  });

  it("every flying kind starts at the live pose", () => {
    for (const kind of FLYING.filter((k) => k !== "cut")) close(makeMotion(kind, A, B)(0).pos, A.pos);
  });

  it("crane rises above the straight line at mid-move, scaled by amount", () => {
    const line = A.pos.clone().lerp(B.pos, 0.5);
    const rise1 = makeMotion("crane", A, B)(0.5).pos.y - line.y;
    const rise2 = makeMotion("crane", A, B, { amount: 2 })(0.5).pos.y - line.y;
    expect(rise1).toBeGreaterThan(5);
    expect(rise2 / rise1).toBeCloseTo(2, 1);
  });

  it("revolve swings sideways off the travel line", () => {
    const { R } = travelFrame(A.pos, B.pos);
    const off = makeMotion("revolve", A, B)(0.4).pos.sub(A.pos.clone().lerp(B.pos, easeInOut(0.4)));
    expect(off.dot(R)).toBeGreaterThan(5);
  });

  it("bank rolls in flight and flythrough widens the lens", () => {
    expect(Math.abs(makeMotion("bank", A, B)(0.4).roll)).toBeGreaterThan(THREE.MathUtils.degToRad(4));
    expect(makeMotion("bank", A, B)(0.4).roll).toBeLessThanOrEqual(THREE.MathUtils.degToRad(8) + 1e-9);
    expect(makeMotion("flythrough", A, B, { baseFov: 42 })(0.5).fov).toBeGreaterThan(46);
  });

  it("fade is fully covered at the mid-point and switches the camera there", () => {
    const m = makeMotion("fade", A, B);
    expect(m(0.5).cover).toBeCloseTo(1, 6);
    close(m(0.49).pos, A.pos);
    close(m(0.5).pos, B.pos);
    expect(m(0.5).overlay).toBe("fade");
    expect(makeMotion("iris", A, B)(0.5).overlay).toBe("iris");
  });

  it("back mirrors forward: 2→3 at u equals reversed at 1−u", () => {
    for (const kind of ["dolly", "swing", "revolve", "crane", "bank", "flythrough"]) {
      const fwd = makeMotion(kind, A, B);
      const back = reversed(fwd);
      for (const u of [0.3, 0.55, 0.9]) close(fwd(u).pos, back(1 - u).pos);
    }
  });

  it("is deterministic: two builds sample identically", () => {
    const p = { keys: [{ t: 0.3, offset: [0.1, 0.2, 0] as [number, number, number] }, { t: 0.7, offset: [-0.1, 0.05, 0.1] as [number, number, number], look: 1 }] };
    const a = makeMotion("path", A, B, { path: p });
    const b = makeMotion("path", A, B, { path: p });
    for (const u of [0.13, 0.5, 0.77]) expect(a(u).pos.toArray()).toEqual(b(u).pos.toArray());
  });

  it("a path has the same travel-frame shape on line, tunnel and orbit rails", () => {
    const keys = [
      { t: 0.25, offset: [0.1, 0.2, 0] as [number, number, number] },
      { t: 0.5, offset: [0, 0.3, 0.05] as [number, number, number] },
      { t: 0.8, offset: [-0.1, 0.05, 0] as [number, number, number] },
    ];
    const shape = (rail: "line" | "tunnel" | "orbit") => {
      const from = poseOf(1, rail);
      const to = poseOf(2, rail);
      const { F, U, R, L } = travelFrame(from.pos, to.pos);
      const s = makeMotion("path", from, to, { path: { keys } })(0.5).pos.sub(from.pos);
      return [s.dot(R) / L, s.dot(U) / L, s.dot(F) / L];
    };
    const line = shape("line");
    for (const rail of ["tunnel", "orbit"] as const) shape(rail).forEach((v, i) => expect(v).toBeCloseTo(line[i], 3));
  });

  it("one-key and eight-key paths land exactly", () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ t: (i + 1) / 9, offset: [Math.sin(i), 0.1, 0] as [number, number, number] }));
    for (const keys of [[{ t: 0.5, offset: [0.3, 0, 0] as [number, number, number] }], eight]) {
      close(makeMotion("path", A, B, { path: { keys } })(1).pos, B.pos);
    }
  });

  it("resolves own > cycle > default", () => {
    expect(resolveTransition("cut", 4, ["dolly", "revolve"], "fade")).toBe("cut");
    expect(resolveTransition(undefined, 3, ["dolly", "revolve", "crane"], "fade")).toBe("dolly");
    expect(resolveTransition(undefined, 5, ["dolly", "revolve", "crane"], "fade")).toBe("crane");
    expect(resolveTransition(undefined, 1, undefined, "fade")).toBe("fade");
    expect(resolveTransition(undefined, 1, [], undefined)).toBe("dolly");
  });
});

describe("transition ids match the corpus", async () => {
  const { REGISTRY } = await import("../../fx/index.js");
  const { TRANSITION_IDS } = await import("../transition.js");
  it("every transition card has a motion and every motion but cut has a card", () => {
    const cards = Object.values(REGISTRY)
      .filter((e) => e.card.kind === "transition")
      .map((e) => e.card.id)
      .sort();
    expect(cards).toEqual(TRANSITION_IDS.filter((id) => id !== "cut").sort());
  });
});
