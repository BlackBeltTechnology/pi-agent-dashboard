import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { countFor, num, softSprite } from "./util.js";

/**
 * Layered drifting sprites — soft discs in three palette tints falling at
 * three rates (three `webgl_points_sprites`). Positions wrap by modulo of `t`.
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng } = ctx;
  const density = num(params, "density", 1);
  const size = num(params, "size", 1);
  const fall = num(params, "fall", 1);
  const tex = softSprite(THREE, 32, 1.6);
  const tints = [palette.second, palette.accent, palette.text];
  const H = 14;
  const layers: Array<{ points: THREE.Points; base: Float32Array; rate: number; sway: number }> = [];
  let total = 0;
  for (let l = 0; l < 3; l++) {
    const n = countFor(ctx, 3 * (l + 1), density, 40);
    total += n;
    const base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      base[i * 3] = (rng() - 0.5) * 30;
      base[i * 3 + 1] = rng() * H;
      base[i * 3 + 2] = -(1 + rng() * 12);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(base.slice(), 3));
    const mat = new THREE.PointsMaterial({ color: tints[l], map: tex, size: (0.3 + l * 0.2) * size, transparent: true, opacity: 0.75 - l * 0.15, depthWrite: false, sizeAttenuation: true });
    layers.push({ points: new THREE.Points(geo, mat), base, rate: (0.6 + l * 0.5) * fall, sway: 0.3 + l * 0.2 });
  }
  const group = new THREE.Group();
  for (const l of layers) group.add(l.points);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = total;
  return {
    object: holder,
    tick: (t) => {
      for (const l of layers) {
        const arr = l.points.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < l.base.length; i += 3) {
          arr[i] = l.base[i] + Math.sin(t * 0.4 + l.base[i + 2]) * l.sway;
          arr[i + 1] = ((((l.base[i + 1] - t * l.rate) % H) + H) % H) - H / 2;
        }
        l.points.geometry.attributes.position.needsUpdate = true;
      }
    },
    dispose: () => {
      tex.dispose();
      for (const l of layers) {
        l.points.geometry.dispose();
        (l.points.material as THREE.Material).dispose();
      }
    },
  };
};
