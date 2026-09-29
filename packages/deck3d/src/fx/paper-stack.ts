import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Drifting sheets settling into a stack — a process/handoff motif (topic: process). */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const speed = typeof params.speed === "number" ? params.speed : 1;
  const count = Math.max(14, Math.round((quality.particles / 22) * density));

  const geo = new THREE.PlaneGeometry(3.1, 4.2);
  const mat = new THREE.MeshStandardMaterial({
    color: palette.second,
    metalness: 0.2,
    roughness: 0.7,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });
  const sheets = new THREE.InstancedMesh(geo, mat, count);

  const seeds = Array.from({ length: count }, (_, i) => ({
    x: (rng() - 0.5) * 18,
    y0: -5 + i * 0.5,
    z: (rng() - 0.5) * 5,
    rot: (rng() - 0.5) * 0.7,
    ph: rng() * Math.PI * 2,
  }));

  const group = new THREE.Group();
  group.add(sheets);
  group.rotation.x = -0.1;
  // The runtime pins the RETURNED object's z, so the scene's own depth
  // offset lives one level below it.
  const holder = new THREE.Group();
  group.position.set(0, 0, -11);
  holder.add(group);
  holder.userData.count = count;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const place = (t: number) => {
    seeds.forEach((s, i) => {
      v.set(s.x, s.y0 + Math.sin(t * 0.3 * speed + s.ph) * 0.8, s.z);
      q.setFromEuler(new THREE.Euler(-Math.PI / 7, 0, s.rot + Math.sin(t * 0.2 * speed + s.ph) * 0.1));
      sheets.setMatrixAt(i, m.compose(v, q, one));
    });
    sheets.instanceMatrix.needsUpdate = true;
  };
  place(0);

  return {
    object: holder,
    tick: place,
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
};
