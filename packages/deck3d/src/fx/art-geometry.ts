/**
 * Geometry for `art3d` / `icon3d` (design D4): outline polygons → extrusion,
 * polylines → capsule tubes. Both repair what breaks three.js shading:
 * duplicate and collinear vertices are removed BEFORE extruding, and a final
 * pass replaces any vertex normal that is not unit length (a zero-length
 * normal makes `MeshStandardMaterial` render NaN black).
 */
import type * as THREE_NS from "three";
import type { Outline, Pt } from "../art/trace.js";

type T3 = typeof THREE_NS;

/** Remove consecutive duplicates (incl. a repeated closing vertex) and collinear vertices. */
export function cleanRing(ring: Pt[], eps = 1e-6): Pt[] {
  let pts = ring.filter((p, i) => i === 0 || Math.hypot(p[0] - ring[i - 1][0], p[1] - ring[i - 1][1]) > eps);
  while (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= eps) pts = pts.slice(0, -1);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) <= eps) {
        pts = pts.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

export interface ExtrudeOptions {
  depth: number;
  bevel: number;
  /** Source-pixel → world scale and centre (outline y points down). */
  scale: number;
  cx: number;
  cy: number;
}

/** Replace every non-unit normal with the face normal (or +Z for a degenerate face). */
export function repairNormals(geom: THREE_NS.BufferGeometry): number {
  const pos = geom.getAttribute("position");
  let nor = geom.getAttribute("normal");
  if (!nor) {
    geom.computeVertexNormals();
    nor = geom.getAttribute("normal");
  }
  let fixed = 0;
  const n = nor.count;
  for (let i = 0; i < n; i++) {
    const x = nor.getX(i);
    const y = nor.getY(i);
    const z = nor.getZ(i);
    const len = Math.hypot(x, y, z);
    if (Number.isFinite(len) && Math.abs(len - 1) <= 1e-6) continue;
    fixed++;
    if (Number.isFinite(len) && len > 1e-12) {
      nor.setXYZ(i, x / len, y / len, z / len);
      continue;
    }
    // Face normal of the triangle this vertex belongs to.
    const t = i - (i % 3);
    if (t + 2 < pos.count) {
      const ax = pos.getX(t + 1) - pos.getX(t);
      const ay = pos.getY(t + 1) - pos.getY(t);
      const az = pos.getZ(t + 1) - pos.getZ(t);
      const bx = pos.getX(t + 2) - pos.getX(t);
      const by = pos.getY(t + 2) - pos.getY(t);
      const bz = pos.getZ(t + 2) - pos.getZ(t);
      const fx = ay * bz - az * by;
      const fy = az * bx - ax * bz;
      const fz = ax * by - ay * bx;
      const fl = Math.hypot(fx, fy, fz);
      if (fl > 1e-12) {
        nor.setXYZ(i, fx / fl, fy / fl, fz / fl);
        continue;
      }
    }
    nor.setXYZ(i, 0, 0, 1);
  }
  nor.needsUpdate = true;
  return fixed;
}

/** One extruded polygon (holes open) as a geometry in world units, centred and y-up. */
export function extrudePolygon(THREE: T3, outer: Pt[], holes: Pt[][], o: ExtrudeOptions): THREE_NS.BufferGeometry | undefined {
  const map = (p: Pt) => new THREE.Vector2((p[0] - o.cx) * o.scale, -(p[1] - o.cy) * o.scale);
  const o2 = cleanRing(outer);
  if (o2.length < 3) return undefined;
  const shape = new THREE.Shape(o2.map(map));
  for (const h of holes) {
    const h2 = cleanRing(h);
    if (h2.length >= 3) shape.holes.push(new THREE.Path(h2.map(map)));
  }
  const bevel = Math.min(o.bevel, o.depth / 2);
  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: o.depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments: 1,
    steps: 1,
  });
  geom.translate(0, 0, -o.depth / 2);
  repairNormals(geom);
  return geom;
}

/** Bounding box of every outer ring, in source pixels. */
export function outlineBounds(outline: Outline): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of outline.polygons) {
    for (const [x, y] of p.outer) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** Matrix placing a unit-length capsule (cylinder along +Y) between two points. */
export function segmentMatrix(THREE: T3, a: THREE_NS.Vector3, b: THREE_NS.Vector3, radius: number): THREE_NS.Matrix4 {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), len > 1e-9 ? dir.normalize() : new THREE.Vector3(0, 1, 0));
  return new THREE.Matrix4().compose(mid, q, new THREE.Vector3(radius, Math.max(len, 1e-6), radius));
}
