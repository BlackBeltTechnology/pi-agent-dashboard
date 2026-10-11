/**
 * Slide space → scene, shared by the imported-pptx built-ins (design D4).
 *
 * The SLIDE FRAME is the slide aspect contain-fitted into the viewport —
 * centred, the largest size that fits (`compare` crops with the same rule).
 * A slide-space point at layer depth `d` maps to the scene point on the plane
 * `d` units toward the camera from the settled target that projects onto the
 * point's frame pixel from the settled pose. At rest every item therefore
 * lands exactly on its mapped rect, whatever the viewport or slide aspect.
 */
import type * as THREE_NS from "three";
import type { FxView } from "./types.js";

export interface Frame {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** Contain-fit `slideW × slideH` into `vw × vh` CSS px, centred. */
export function slideFrame(vw: number, vh: number, slideW: number, slideH: number): Frame {
  const a = slideW / slideH;
  if (vw / vh > a) {
    const w = vh * a;
    return { x0: (vw - w) / 2, y0: 0, w, h: vh };
  }
  const h = vw / a;
  return { x0: 0, y0: (vh - h) / 2, w: vw, h };
}

/** Camera basis: origin, right, up, forward (unit vectors). */
export interface Basis {
  origin: THREE_NS.Vector3;
  right: THREE_NS.Vector3;
  up: THREE_NS.Vector3;
  forward: THREE_NS.Vector3;
  /** Camera → target distance. */
  distance: number;
}

/** Basis of the settled pose in the effect's parent space. */
export function poseBasis(THREE: typeof THREE_NS, view: FxView): Basis {
  const origin = new THREE.Vector3(...view.pose.cam);
  const target = new THREE.Vector3(...view.pose.target);
  const forward = target.clone().sub(origin);
  const distance = forward.length();
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  return { origin, right, up, forward, distance };
}

/** Camera-local basis (the camera looks down −Z): for camera-pinned layers. */
export function cameraBasis(THREE: typeof THREE_NS, distance: number): Basis {
  return {
    origin: new THREE.Vector3(0, 0, 0),
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
    forward: new THREE.Vector3(0, 0, -1),
    distance,
  };
}

export interface PlaneMap {
  /** Scene point of slide-space `(sx, sy)` on this plane. */
  point(sx: number, sy: number): THREE_NS.Vector3;
  /** Scene units per slide unit on this plane. */
  unit: number;
  /** Centre of the slide frame on this plane. */
  centre: THREE_NS.Vector3;
  /** Frame size on this plane in scene units. */
  width: number;
  height: number;
  /** Rotation that turns a +Z-facing XY plane to face the camera. */
  quaternion: THREE_NS.Quaternion;
}

/**
 * The plane `depth` units toward the camera from the target, mapped so the
 * slide frame fills exactly its frame rect at viewport `vw × vh`.
 */
export function planeMap(
  THREE: typeof THREE_NS,
  basis: Basis,
  fovDeg: number,
  vw: number,
  vh: number,
  slide: { w: number; h: number },
  depth: number,
): PlaneMap {
  const D = Math.max(0.05, basis.distance - depth);
  const halfH = D * Math.tan((fovDeg * Math.PI) / 360);
  const halfW = halfH * (vw / vh);
  const frame = slideFrame(vw, vh, slide.w, slide.h);
  const base = basis.origin.clone().addScaledVector(basis.forward, D);
  const point = (sx: number, sy: number): THREE_NS.Vector3 => {
    const px = frame.x0 + (sx * frame.w) / slide.w;
    const py = frame.y0 + (sy * frame.h) / slide.h;
    const nx = (px / vw) * 2 - 1;
    const ny = 1 - (py / vh) * 2;
    return base.clone().addScaledVector(basis.right, nx * halfW).addScaledVector(basis.up, ny * halfH);
  };
  const perPx = (2 * halfH) / vh;
  const m = new THREE.Matrix4().makeBasis(basis.right, basis.up, basis.forward.clone().negate());
  return {
    point,
    unit: (perPx * frame.h) / slide.h,
    centre: point(slide.w / 2, slide.h / 2),
    width: perPx * frame.w,
    height: perPx * frame.h,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(m),
  };
}

/** Screen rect (CSS px) of scene points projected through `camera`. */
export function projectPoints(
  points: THREE_NS.Vector3[],
  camera: THREE_NS.Camera,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    const v = p.clone().project(camera);
    const x = ((v.x + 1) / 2) * width;
    const y = ((1 - v.y) / 2) * height;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Font-name → deck font asset id (`font-` + lowercase, non-alnum runs → `-`). */
export function fontAssetId(name: string): string {
  return `font-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
