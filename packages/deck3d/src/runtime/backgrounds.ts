/**
 * Background scene library (ported from the lab). Each scene returns an
 * animator `{ g, tick }`; deterministic seeded randomness only.
 */
import * as THREE from "three";
import type { PaletteColors } from "./palette.js";
import type { QualityProfile } from "./quality.js";
import { makeRng } from "./rng.js";

export interface Animator {
  g: THREE.Group;
  tick: (t: number) => void;
}

/** Drifting glyph-like cubes — "language patterns". */
function tokens(P: PaletteColors, particles: number): Animator {
  const g = new THREE.Group();
  const n = Math.max(24, Math.round(160 * (particles / 1500)));
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.18, 0.18, 0.18),
    new THREE.MeshStandardMaterial({ color: P.second, metalness: 0.6, roughness: 0.3, transparent: true, opacity: 0.8 }),
    n,
  );
  const rnd = makeRng(5);
  const items = Array.from({ length: n }, () => ({ x: (rnd() - 0.5) * 30, y: (rnd() - 0.5) * 12, z: -8 - rnd() * 16, s: rnd() * 6, r: rnd() }));
  const dummy = new THREE.Object3D();
  g.add(mesh);
  return {
    g,
    tick(t) {
      items.forEach((it, i) => {
        dummy.position.set(it.x, it.y + Math.sin(t * 0.4 + it.s) * 0.5, it.z);
        dummy.rotation.set(t * 0.3 + it.r, t * 0.2 + it.s, 0);
        dummy.scale.setScalar(0.6 + it.r);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Concentric rotating rings — the loop. */
function rings(P: PaletteColors): Animator {
  const g = new THREE.Group();
  const list: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const r = new THREE.Mesh(
      new THREE.TorusGeometry(3 + i * 1.6, 0.035, 12, 160),
      new THREE.MeshStandardMaterial({
        color: i % 2 ? P.accent : P.second,
        emissive: i % 2 ? P.accent : P.second,
        emissiveIntensity: 0.4,
        metalness: 0.8,
        roughness: 0.3,
        transparent: true,
        opacity: 0.55,
      }),
    );
    r.position.z = -6 - i * 1.2;
    g.add(r);
    list.push(r);
  }
  return {
    g,
    tick(t) {
      list.forEach((r, i) => {
        r.rotation.z = t * (0.08 + i * 0.02) * (i % 2 ? 1 : -1);
        r.rotation.x = Math.sin(t * 0.2 + i) * 0.25;
      });
    },
  };
}

/** Distant agent cloud with connections. */
function swarm(P: PaletteColors, particles: number): Animator {
  const g = new THREE.Group();
  const n = Math.max(16, Math.round(90 * (particles / 1500)));
  const rnd = makeRng(9);
  const items = Array.from({ length: n }, () => ({ x: (rnd() - 0.5) * 34, y: (rnd() - 0.5) * 14, z: -8 - rnd() * 18, ph: rnd() * 6, sp: 0.2 + rnd() * 0.4 }));
  const pts = new Float32Array(n * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  g.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: P.accent, size: 0.12, transparent: true, opacity: 0.9 })));
  const lpos = new Float32Array(n * n * 6);
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute("position", new THREE.BufferAttribute(lpos, 3));
  g.add(new THREE.LineSegments(lGeo, new THREE.LineBasicMaterial({ color: P.second, transparent: true, opacity: 0.25 })));
  return {
    g,
    tick(t) {
      items.forEach((it, i) => {
        pts[i * 3] = it.x + Math.sin(t * it.sp + it.ph) * 1.2;
        pts[i * 3 + 1] = it.y + Math.cos(t * it.sp * 0.7 + it.ph) * 0.8;
        pts[i * 3 + 2] = it.z;
      });
      pGeo.attributes.position.needsUpdate = true;
      let k = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = pts[i * 3] - pts[j * 3];
          const dy = pts[i * 3 + 1] - pts[j * 3 + 1];
          const dz = pts[i * 3 + 2] - pts[j * 3 + 2];
          if (dx * dx + dy * dy + dz * dz < 9) {
            lpos.set([pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]], k);
            k += 6;
          }
        }
      }
      lGeo.setDrawRange(0, k / 3);
      lGeo.attributes.position.needsUpdate = true;
    },
  };
}

/** Slow particle field. */
function particles(P: PaletteColors, count: number): Animator {
  const rnd = makeRng(21);
  const pts = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) pts[i] = (rnd() - 0.5) * (i % 3 === 2 ? 30 : 28) - (i % 3 === 2 ? 10 : 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: P.second, size: 0.06, transparent: true, opacity: 0.7 }));
  const g = new THREE.Group();
  g.add(points);
  return {
    g,
    tick(t) {
      g.rotation.y = t * 0.02;
    },
  };
}

export const BACKGROUNDS: Record<string, (P: PaletteColors, q: QualityProfile) => Animator> = {
  tokens: (P, q) => tokens(P, q.particles),
  rings,
  swarm: (P, q) => swarm(P, q.particles),
  particles: (P, q) => particles(P, q.particles),
};

export function backgroundFor(scene: string | undefined, P: PaletteColors, q: QualityProfile): Animator | undefined {
  const factory = scene ? BACKGROUNDS[scene] : undefined;
  return factory ? factory(P, q) : undefined;
}
