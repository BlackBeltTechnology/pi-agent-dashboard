import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Agents on nested tilted orbits around a shared core (topic: agents). */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const speed = typeof params.speed === "number" ? params.speed : 1;
  const count = Math.max(12, Math.round((quality.particles / 25) * density));

  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const coreGeo = new THREE.IcosahedronGeometry(1.5, 1);
  disposables.push(coreGeo);
  const coreMat = new THREE.MeshBasicMaterial({ color: palette.accent, wireframe: true, transparent: true, opacity: 0.4 });
  disposables.push(coreMat);
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  const agentGeo = new THREE.TetrahedronGeometry(0.28, 0);
  disposables.push(agentGeo);
  const agentMat = new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.6, roughness: 0.4 });
  disposables.push(agentMat);
  const agents = new THREE.InstancedMesh(agentGeo, agentMat, count);
  group.add(agents);

  const seeds = Array.from({ length: count }, () => ({
    r: 3.5 + rng() * 6,
    ph: rng() * Math.PI * 2,
    sp: 0.12 + rng() * 0.3,
    tilt: rng() * Math.PI,
  }));

  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const place = (t: number) => {
    seeds.forEach((s, i) => {
      const a = s.ph + t * s.sp * speed;
      v.set(Math.cos(a) * s.r, Math.sin(a) * s.r * Math.cos(s.tilt), Math.sin(a) * s.r * Math.sin(s.tilt));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      agents.setMatrixAt(i, m.compose(v, q, one));
    });
    agents.instanceMatrix.needsUpdate = true;
  };
  place(0);

  return {
    object: holder,
    tick: (t) => {
      place(t);
      core.rotation.set(t * 0.1 * speed, t * 0.14 * speed, 0);
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
};
