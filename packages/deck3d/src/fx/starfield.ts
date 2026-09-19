import { makeRng } from "../runtime/rng.js";
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Permissive port of a three.js example (see the card's source). */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette } = ctx;
  const n = Math.max(32, Math.round(ctx.quality.particles / 3));
  const rnd = makeRng(63);
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) positions[i] = (rnd() - 0.5) * 30;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: palette.second, size: 0.08, transparent: true, opacity: 0.8 }));
  const group = new THREE.Group();
  group.add(points);
  const speed = typeof params.speed === "number" ? params.speed : 0.2;
  return { object: group, tick: (t) => { group.rotation.y = t * speed * 0.1; }, dispose: () => geo.dispose() };
};
