import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Concentric vault rings with orbiting seal glyphs (topics: trust, security). */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const speed = typeof params.speed === "number" ? params.speed : 1;
  const count = Math.max(8, Math.round((quality.particles / 40) * density));

  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const ringMat = new THREE.MeshBasicMaterial({ color: palette.second, transparent: true, opacity: 0.3 });
  disposables.push(ringMat);

  for (let r = 0; r < 3; r++) {
    const geo = new THREE.TorusGeometry(4 + r * 2.2, 0.06, 8, 96);
    disposables.push(geo);
    group.add(new THREE.Mesh(geo, ringMat));
  }

  const glyphGeo = new THREE.OctahedronGeometry(0.34, 0);
  disposables.push(glyphGeo);
  const glyphMat = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.8, roughness: 0.3 });
  disposables.push(glyphMat);
  const glyphs = new THREE.InstancedMesh(glyphGeo, glyphMat, count);
  const seeds = Array.from({ length: count }, () => ({ r: 4 + Math.floor(rng() * 3) * 2.2, ph: rng() * Math.PI * 2, sp: 0.15 + rng() * 0.2 }));
  group.add(glyphs);

  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const m = new THREE.Matrix4();
  const place = (t: number) => {
    seeds.forEach((s, i) => {
      const a = s.ph + t * s.sp * speed;
      m.makeRotationZ(a);
      m.setPosition(Math.cos(a) * s.r, Math.sin(a) * s.r, 0);
      glyphs.setMatrixAt(i, m);
    });
    glyphs.instanceMatrix.needsUpdate = true;
  };
  place(0);

  return {
    object: holder,
    tick: (t) => {
      place(t);
      group.rotation.z = t * 0.02 * speed;
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
};
