import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Instanced skyline of towers on a ground plane (topics: work, sales). */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const speed = typeof params.speed === "number" ? params.speed : 1;
  const count = Math.max(24, Math.round((quality.particles / 8) * density));

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.5, roughness: 0.6, transparent: true, opacity: 0.75 });
  const towers = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const heights: number[] = [];
  const side = Math.ceil(Math.sqrt(count));

  for (let i = 0; i < count; i++) {
    const h = 0.6 + rng() * 5;
    heights.push(h);
    const x = ((i % side) - side / 2) * 2.4 + (rng() - 0.5) * 0.6;
    const z = (Math.floor(i / side) - side / 2) * 2.4 + (rng() - 0.5) * 0.6;
    m.makeScale(0.9, h, 0.9);
    m.setPosition(x, -6 + h / 2, z);
    towers.setMatrixAt(i, m);
  }
  towers.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.add(towers);
  group.rotation.x = 0.12;
  // The runtime pins the RETURNED object's z, so the scene's own depth
  // offset lives one level below it.
  const holder = new THREE.Group();
  group.position.set(0, -2, -0);
  holder.add(group);
  holder.userData.count = count;

  return {
    object: holder,
    tick: (t) => {
      group.rotation.y = Math.sin(t * 0.04 * speed) * 0.25;
      // A slow breathing skyline reads as a living city without per-frame churn.
      const k = 1 + Math.sin(t * 0.5 * speed) * 0.04;
      towers.scale.y = k;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
};
