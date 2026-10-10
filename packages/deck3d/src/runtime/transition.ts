/**
 * Camera motions between slides — pure functions, no renderer.
 *
 * `makeMotion(kind, from, to, opts)` is built ONCE when a move starts and
 * returns `u ∈ [0,1] → Sample`. The runtime only advances `u`, so a pinned
 * clock (`setTime`) gives the same pose every time, and a reversed move is
 * `u → 1 − u` on the same curve.
 *
 *  - `dolly` / `swing` / `fade` / `cut` keep the pre-change formulas exactly.
 *  - `revolve` / `crane` / `bank` / `flythrough` are canned key lists fed through
 *    the same path code as the author's `path` (`cameraPath`).
 *  - Keys live in the TRAVEL FRAME (from-camera → to-camera): `offset = [r, u, f]`
 *    as fractions of the travel length, so a path reads the same on any rail or
 *    spacing. The end points are implied and pinned, so every move lands
 *    exactly on the anchor.
 */
import * as THREE from "three";
import type { CameraPath, PathEase, PathKey } from "../ir/types.js";

export type { CameraPath, PathEase, PathKey };

export const TRANSITION_IDS = ["dolly", "swing", "revolve", "crane", "bank", "flythrough", "fade", "iris", "path", "cut"] as const;
export type TransitionId = (typeof TRANSITION_IDS)[number];

export interface Pose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

export interface Sample {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  /** Roll in radians. */
  roll: number;
  /** Field of view in degrees. */
  fov: number;
  /** Screen cover 0..1 (`fade`: opacity, `iris`: closed fraction). */
  cover: number;
  overlay: "none" | "fade" | "iris";
}

export type Motion = (u: number) => Sample;

export interface MotionOptions {
  /** Scales canned offsets and rolls (card param, default 1). */
  amount?: number;
  /** Author path for `path`. */
  path?: CameraPath;
  /** Deck field of view, restored at the ends. */
  baseFov?: number;
}

const EASES: Record<PathEase, (t: number) => number> = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  linear: (t) => t,
};
export const easeInOut = EASES.inOut;

const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Piecewise-smoothstep through `(t, v)` stops (sorted by t). */
function interp(stops: Array<[number, number]>, x: number): number {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, v1] = stops[i];
    const [t0, v0] = stops[i - 1];
    if (x <= t1) return v0 + (v1 - v0) * smooth(t1 > t0 ? (x - t0) / (t1 - t0) : 1);
  }
  return stops[stops.length - 1][1];
}

/** Canned key lists for the built-in flying kinds (amount = 1). */
export function cannedKeys(kind: TransitionId): PathKey[] | null {
  switch (kind) {
    case "revolve":
      // Swing wide to the travel-right side, lock onto the arriving slide early
      // and arc in around it.
      return [
        { t: 0.35, offset: [0.32, 0.06, -0.05], look: 0.75 },
        { t: 0.7, offset: [0.22, 0.03, 0.08], look: 1 },
      ];
    case "crane":
      return [{ t: 0.5, offset: [0, 0.3, 0], look: 0.5 }];
    case "bank":
      return [
        { t: 0.35, offset: [0.06, 0, 0], roll: 8 },
        { t: 0.7, offset: [0.03, 0, 0], roll: 3 },
      ];
    case "flythrough":
      return [{ t: 0.5, offset: [-0.04, -0.035, 0], roll: -4, fov: 52 }];
    default:
      return null;
  }
}

function scaleKeys(keys: PathKey[], amount: number, baseFov: number): PathKey[] {
  return keys.map((k) => ({
    ...k,
    offset: k.offset ? [k.offset[0] * amount, k.offset[1] * amount, k.offset[2] * amount] : undefined,
    roll: k.roll === undefined ? undefined : k.roll * amount,
    fov: k.fov === undefined ? undefined : baseFov + (k.fov - baseFov) * amount,
  }));
}

/** The travel frame: forward along the move, up = world up orthogonalised. */
export function travelFrame(from: THREE.Vector3, to: THREE.Vector3): { F: THREE.Vector3; U: THREE.Vector3; R: THREE.Vector3; L: number } {
  const d = to.clone().sub(from);
  const L = d.length();
  const F = L > 1e-9 ? d.divideScalar(L) : new THREE.Vector3(0, 0, -1);
  const U = new THREE.Vector3(0, 1, 0);
  U.addScaledVector(F, -U.dot(F));
  if (U.lengthSq() < 1e-9) U.set(0, 0, 1).addScaledVector(F, -F.z);
  U.normalize();
  const R = F.clone().cross(U).normalize();
  return { F, U, R, L };
}

function pathMotion(from: Pose, to: Pose, keys: PathKey[], ease: (t: number) => number, baseFov: number): Motion {
  const { F, U, R, L } = travelFrame(from.pos, to.pos);
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const pts = [from.pos.clone()];
  for (const k of sorted) {
    const [r, u, f] = k.offset ?? [0, 0, 0];
    pts.push(
      from.pos
        .clone()
        .lerp(to.pos, k.t)
        .addScaledVector(R, r * L)
        .addScaledVector(U, u * L)
        .addScaledVector(F, f * L),
    );
  }
  pts.push(to.pos.clone());
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const looks: Array<[number, number]> = [[0, 0], ...sorted.filter((k) => k.look !== undefined).map((k) => [k.t, k.look!] as [number, number]), [1, 1]];
  const rolls: Array<[number, number]> = [[0, 0], ...sorted.filter((k) => k.roll !== undefined).map((k) => [k.t, k.roll!] as [number, number]), [1, 0]];
  const fovs: Array<[number, number]> = [[0, baseFov], ...sorted.filter((k) => k.fov !== undefined).map((k) => [k.t, k.fov!] as [number, number]), [1, baseFov]];
  const authoredLook = looks.length > 2;
  return (u) => {
    const x = clamp01(u);
    const e = ease(x);
    const pos = x <= 0 ? from.pos.clone() : x >= 1 ? to.pos.clone() : curve.getPointAt(e);
    const w = authoredLook ? interp(looks, e) : e;
    return {
      pos,
      target: from.target.clone().lerp(to.target, w),
      roll: x >= 1 ? 0 : THREE.MathUtils.degToRad(interp(rolls, e)),
      fov: x >= 1 ? baseFov : interp(fovs, e),
      cover: 0,
      overlay: "none",
    };
  };
}

/**
 * Build the motion for one move. `from` is the live camera pose (a move may
 * start mid-flight), `to` the arriving anchor (`pos` = camera, `target`).
 */
export function makeMotion(kind: string, from: Pose, to: Pose, opts: MotionOptions = {}): Motion {
  const baseFov = opts.baseFov ?? 42;
  const amount = opts.amount ?? 1;
  const flat = (pos: THREE.Vector3, target: THREE.Vector3, cover = 0, overlay: Sample["overlay"] = "none"): Sample => ({
    pos,
    target,
    roll: 0,
    fov: baseFov,
    cover,
    overlay,
  });
  switch (kind) {
    case "cut":
      return () => flat(to.pos.clone(), to.target.clone());
    case "fade":
    case "iris":
      return (u) => {
        const x = clamp01(u);
        const after = x >= 0.5;
        // Fully covered at the mid-point, where the camera switches.
        const cover = x >= 1 ? 0 : smooth(1 - Math.abs(2 * x - 1));
        return flat((after ? to : from).pos.clone(), (after ? to : from).target.clone(), cover, kind);
      };
    case "swing": {
      const mid = from.target.clone().add(to.target).multiplyScalar(0.5);
      return (u) => {
        const x = clamp01(u);
        const k = easeInOut(x);
        const pos = from.pos.clone().lerp(to.pos, k);
        const out = pos.clone().sub(mid).normalize();
        pos.addScaledVector(out, Math.sin(x * Math.PI) * 6 * amount);
        return flat(pos, from.target.clone().lerp(to.target, k));
      };
    }
    case "path":
      if (opts.path && opts.path.keys.length) return pathMotion(from, to, opts.path.keys, EASES[opts.path.ease ?? "inOut"], baseFov);
      break;
    default: {
      const keys = cannedKeys(kind as TransitionId);
      if (keys) return pathMotion(from, to, scaleKeys(keys, amount, baseFov), easeInOut, baseFov);
    }
  }
  // dolly, and any unknown id (validate rejects those; the runtime stays safe).
  return (u) => {
    const k = easeInOut(clamp01(u));
    return flat(from.pos.clone().lerp(to.pos, k), from.target.clone().lerp(to.target, k));
  };
}

/** Play a motion backwards: same curve, time 1 → 0. */
export const reversed =
  (m: Motion): Motion =>
  (u) =>
    m(1 - u);

/** Effective transition for slide `index`: own override, else the cycle, else the deck default. */
export function resolveTransition(own: string | undefined, index: number, cycle: string[] | undefined, fallback: string | undefined): string {
  if (own) return own;
  if (cycle && cycle.length) return cycle[index % cycle.length];
  return fallback ?? "dolly";
}
