/**
 * Slide cross-fade: scale the opacity of everything under some roots by a
 * weight `w ∈ [0,1]`, without cloning materials (local fx keep live refs to
 * theirs and animate them).
 *
 * Per material we keep the author's base opacity / transparency. A material an
 * effect re-writes between frames (its opacity no longer equals what we last
 * wrote) is re-based on its new value, so effect-driven fades compose with
 * this one. Materials shared by several faded roots take the LARGEST weight.
 * `ShaderMaterial`s with an `opacity` uniform are scaled through the uniform.
 * At w = 1 the base is restored and the material is released; at w ≈ 0 the
 * root is hidden outright (covers shaders that ignore opacity).
 */
import * as THREE from "three";

interface Tracked {
  base: number;
  transparent: boolean;
  written: number;
}

const HIDE_BELOW = 0.01;

type OpacityHost = { get: () => number; set: (v: number) => void };

function hostOf(m: THREE.Material): OpacityHost | null {
  const u = (m as THREE.ShaderMaterial).uniforms?.opacity;
  if (u && typeof u.value === "number") return { get: () => u.value as number, set: (v) => (u.value = v) };
  if (typeof m.opacity === "number") return { get: () => m.opacity, set: (v) => (m.opacity = v) };
  return null;
}

export interface Fader {
  /** Weight per root for this frame; roots not listed are released (w = 1). */
  apply: (weights: Map<THREE.Object3D, number>) => void;
  /** Release everything (base opacity back, roots visible). */
  clear: () => void;
}

export function createFader(): Fader {
  const tracked = new Map<THREE.Material, Tracked>();
  const hidden = new Set<THREE.Object3D>();

  function release(m: THREE.Material, t: Tracked): void {
    const h = hostOf(m);
    if (h && h.get() === t.written) h.set(t.base);
    if (m.transparent !== t.transparent) {
      m.transparent = t.transparent;
      m.needsUpdate = true;
    }
    tracked.delete(m);
  }

  function apply(weights: Map<THREE.Object3D, number>): void {
    const want = new Map<THREE.Material, number>();
    for (const [root, raw] of weights) {
      const w = Math.min(1, Math.max(0, raw));
      if (w < HIDE_BELOW) {
        if (root.visible) {
          root.visible = false;
          hidden.add(root);
        }
      } else if (hidden.has(root)) {
        root.visible = true;
        hidden.delete(root);
      }
      root.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!mat) return;
        for (const m of Array.isArray(mat) ? mat : [mat]) want.set(m, Math.max(want.get(m) ?? 0, w));
      });
    }
    for (const [root] of [...hidden].map((r) => [r] as const)) {
      if (!weights.has(root)) {
        root.visible = true;
        hidden.delete(root);
      }
    }
    for (const [m, t] of tracked) if (!want.has(m) || want.get(m)! >= 1) release(m, t);
    for (const [m, w] of want) {
      if (w >= 1) continue;
      const h = hostOf(m);
      if (!h) continue;
      let t = tracked.get(m);
      if (!t) {
        t = { base: h.get(), transparent: m.transparent, written: Number.NaN };
        tracked.set(m, t);
      } else if (h.get() !== t.written) {
        t.base = h.get(); // the effect animated it since our last write
      }
      t.written = t.base * w;
      h.set(t.written);
      if (!m.transparent) {
        m.transparent = true;
        m.needsUpdate = true;
      }
    }
  }

  return {
    apply,
    clear: () => apply(new Map()),
  };
}

/** Ease for the cross-fade window `[a, b]` of the move. */
export function fadeWindow(u: number, a: number, b: number): number {
  const x = Math.min(1, Math.max(0, (u - a) / (b - a)));
  return x * x * (3 - 2 * x);
}
