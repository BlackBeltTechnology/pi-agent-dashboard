/**
 * Camera rail: per-slide anchors (ported from the lab; 40-unit spacing so
 * neighbour backgrounds never bleed; neighbour culling uses a 52-unit radius).
 */
import * as THREE from "three";

export interface Anchor {
  pos: THREE.Vector3;
  rotY: number;
  cam: THREE.Vector3;
  target: THREE.Vector3;
}

export function anchorFor(i: number, distance = 9): Anchor {
  const a: Anchor = { pos: new THREE.Vector3(), rotY: 0, cam: new THREE.Vector3(), target: new THREE.Vector3() };
  a.pos.set(i * 40, 0, 0);
  a.cam.set(i * 40 + 0.6, 0.6, distance);
  a.target.copy(a.pos);
  return a;
}

export const CULL_RADIUS = 52;
