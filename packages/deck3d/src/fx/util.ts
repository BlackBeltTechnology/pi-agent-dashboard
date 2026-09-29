/**
 * Shared helpers for corpus effect modules (Section 18). Everything here is
 * deterministic: no `Math.random`, no wall clock, no DOM — the corpus gate
 * constructs every card in plain Node.
 */
import type * as THREE from "three";
import type { FxContext, FxParams } from "./types.js";

export const num = (p: FxParams, k: string, d: number): number => (typeof p[k] === "number" ? (p[k] as number) : d);
export const str = (p: FxParams, k: string, d: string): string => (typeof p[k] === "string" ? (p[k] as string) : d);
export const bool = (p: FxParams, k: string, d: boolean): boolean => (typeof p[k] === "boolean" ? (p[k] as boolean) : d);

/** Instance count for the tier: `high` ≈ `particles / divisor`, `low` lands at ≤ half. */
export const countFor = (ctx: FxContext, divisor: number, density = 1, min = 8): number =>
  Math.max(min, Math.round((ctx.quality.particles / divisor) * density));

/**
 * Soft radial sprite as a `DataTexture` (no canvas — the corpus gate runs
 * without a DOM). White with alpha falloff so `PointsMaterial.color` tints it.
 */
export function softSprite(T: typeof THREE, size = 32, hardness = 1): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      const a = Math.max(0, 1 - d) ** hardness;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new T.DataTexture(data, size, size);
  tex.needsUpdate = true;
  return tex;
}

/** Deterministic value noise on a 3D lattice, seeded from `rng` once. */
export function makeNoise3(rng: () => number): (x: number, y: number, z: number) => number {
  const P = new Uint8Array(512);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const grad = (h: number, x: number, y: number, z: number) => {
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  return (x, y, z) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = P[X] + Y;
    const AA = P[A] + Z;
    const AB = P[A + 1] + Z;
    const B = P[X + 1] + Y;
    const BA = P[B] + Z;
    const BB = P[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(P[AA] & 15, x, y, z), grad(P[BA] & 15, x - 1, y, z), u), lerp(grad(P[AB] & 15, x, y - 1, z), grad(P[BB] & 15, x - 1, y - 1, z), u), v),
      lerp(lerp(grad(P[AA + 1] & 15, x, y, z - 1), grad(P[BA + 1] & 15, x - 1, y, z - 1), u), lerp(grad(P[AB + 1] & 15, x, y - 1, z - 1), grad(P[BB + 1] & 15, x - 1, y - 1, z - 1), u), v),
      w,
    );
  };
}

/** A seeded 3D noise volume as a `Data3DTexture` (red channel), for the volume raymarchers. */
export function noiseVolume(T: typeof THREE, rng: () => number, size: number, scale = 0.08, octaves = 3): THREE.Data3DTexture {
  const noise = makeNoise3(rng);
  const data = new Uint8Array(size * size * size);
  const c = size / 2;
  let i = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        let amp = 1;
        let f = scale;
        for (let o = 0; o < octaves; o++) {
          v += noise(x * f, y * f, z * f) * amp;
          amp *= 0.5;
          f *= 2;
        }
        // Fade to zero at the box edges so the cloud never shows a hard cube.
        const d = 1 - Math.hypot(x - c, y - c, z - c) / c;
        data[i++] = Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255 * Math.max(0, d))));
      }
    }
  }
  const tex = new T.Data3DTexture(data, size, size, size);
  tex.format = T.RedFormat;
  tex.minFilter = T.LinearFilter;
  tex.magFilter = T.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
