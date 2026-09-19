/** Node shape → three.js primitive (ported from the lab). */
import * as THREE from "three";
import type { NodeShape } from "../ir/types.js";

export function nodeGeometry(shape: NodeShape, w: number, h: number): THREE.BufferGeometry {
  const dpt = 0.16;
  if (shape === "circle" || shape === "doublecircle") return new THREE.SphereGeometry(h / 2, 32, 32);
  if (shape === "round" || shape === "stadium") {
    const g = new THREE.CapsuleGeometry(h / 2, Math.max(0.01, w - h), 8, 24);
    g.rotateZ(Math.PI / 2);
    return g;
  }
  if (shape === "diamond") {
    const g = new THREE.OctahedronGeometry(h * 0.8, 0);
    g.scale((w / h) * 0.7, 1, 0.35);
    return g;
  }
  if (shape === "hexagon") {
    const g = new THREE.CylinderGeometry(h * 0.6, h * 0.6, dpt, 6);
    g.rotateX(Math.PI / 2);
    g.scale((w / h) * 0.75, 1, 1);
    return g;
  }
  if (shape === "cylinder") return new THREE.CylinderGeometry(w / 2, w / 2, h, 32);
  return new THREE.BoxGeometry(w, h, dpt);
}
