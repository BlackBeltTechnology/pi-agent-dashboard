// closing-mark — local deck3d effect for this deck. Licence: MIT.
//
// ctx = { THREE, palette, mode, quality, rng, slide: { id, title, kind } }
// Determinism guardrail: Math.random() is the deck's seeded stream, and
// window/document/fetch/setTimeout/Date/Promise are all undefined here.
// No imports, no other exports.
export default function (ctx, params) {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === 'number' ? params.density : 1;
  const count = Math.max(8, Math.round((quality.particles / 30) * density));

  const geo = new THREE.TetrahedronGeometry(0.4, 0);
  const mat = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.6, roughness: 0.4 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const seeds = [];
  for (let i = 0; i < count; i++) {
    seeds.push({ x: (rng() - 0.5) * 24, y: (rng() - 0.5) * 12, z: (rng() - 0.5) * 10, ph: rng() * 6.283 });
    m.makeTranslation(seeds[i].x, seeds[i].y, seeds[i].z);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.add(mesh);
  group.userData.count = count;

  return {
    object: group,
    tick: function (t) {
      for (let i = 0; i < count; i++) {
        const s = seeds[i];
        m.makeTranslation(s.x, s.y + Math.sin(t * 0.6 + s.ph) * 0.8, s.z);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose: function () {
      geo.dispose();
      mat.dispose();
    },
  };
}
