/**
 * Camera rail: per-slide anchors (ported from the lab; 40-unit spacing so
 * neighbour backgrounds never bleed; neighbour culling uses a 1.3x radius).
 *
 * `rail` picks the topology the slides are strung along. Every rail keeps the
 * same contract, which is what the transitions and the culler rely on:
 *   - `pos` is the slide's origin and `target` equals it (the camera looks at
 *     the slide, never past it),
 *   - `cam` sits at the slide-local offset `(0.6, 0.6, distance)` turned by
 *     `rotY`, so framing is identical whichever way the slide faces,
 *   - consecutive anchors stay about `spacing` apart (`grid` excepted, which
 *     jumps back across a row by design).
 */
import * as THREE from "three";
import type { Rail } from "../ir/types.js";

export type { Rail };

export interface Anchor {
  pos: THREE.Vector3;
  rotY: number;
  cam: THREE.Vector3;
  target: THREE.Vector3;
}

export const DEFAULT_SPACING = 40;

/** Vertical rise per slide on `helix`, as a fraction of `spacing`. */
const HELIX_RISE = 0.18;
/** Row gap on `grid`, as a fraction of `spacing` (rows sit tighter than columns). */
const GRID_ROW = 0.8;

function place(pos: THREE.Vector3, rotY: number, distance: number): Anchor {
  const cam = new THREE.Vector3(0.6, 0.6, distance).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY).add(pos);
  return { pos, rotY, cam, target: pos.clone() };
}

export function anchorFor(i: number, distance = 9, spacing = DEFAULT_SPACING, rail: Rail = "line", count = 1): Anchor {
  const n = Math.max(count, 1);
  switch (rail) {
    case "orbit":
    case "helix": {
      // Radius chosen so the arc length between slides is exactly `spacing`,
      // i.e. a longer deck makes a wider circle rather than a denser one.
      const radius = (spacing * n) / (2 * Math.PI);
      const theta = (i * 2 * Math.PI) / n;
      const pos = new THREE.Vector3(Math.sin(theta) * radius, rail === "helix" ? i * spacing * HELIX_RISE : 0, Math.cos(theta) * radius - radius);
      return place(pos, theta, distance);
    }
    case "tunnel":
      // Straight back along -Z; the culler keeps the slide behind the camera
      // from floating in frame (see `cullRadius`).
      return place(new THREE.Vector3(0, 0, -i * spacing), 0, distance);
    case "grid": {
      const cols = Math.max(Math.ceil(Math.sqrt(n)), 1);
      return place(new THREE.Vector3((i % cols) * spacing, -Math.floor(i / cols) * spacing * GRID_ROW, 0), 0, distance);
    }
    default:
      return place(new THREE.Vector3(i * spacing, 0, 0), 0, distance);
  }
}

/**
 * Cull radius must track `spacing`: at the stock 40 it is 52, but a wider rail
 * with a fixed 52 would cull the slide the camera is looking at. `tunnel` is
 * tighter still — its neighbours sit directly along the view axis, so a radius
 * that reached them would leave the previous slide hanging in frame.
 */
export function cullRadius(spacing = DEFAULT_SPACING, rail: Rail = "line"): number {
  return spacing * (rail === "tunnel" ? 0.6 : 1.3);
}

export const CULL_RADIUS = cullRadius();
