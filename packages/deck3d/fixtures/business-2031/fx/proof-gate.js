// proof-gate — deals passing a proof gate before commercial terms (topic: sales). Licence: MIT.
export default function (ctx, params) {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const count = Math.max(16, Math.round((quality.particles / 20) * density));

  const group = new THREE.Group();
  const frame = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.09, 8, 4),
    new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.7, roughness: 0.3 }),
  );
  frame.rotation.z = Math.PI / 4;
  group.add(frame);

  const dealGeo = new THREE.OctahedronGeometry(0.22, 0);
  const passMat = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.6, roughness: 0.4 });
  const holdMat = new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.3, roughness: 0.7, transparent: true, opacity: 0.5 });
  const passing = new THREE.InstancedMesh(dealGeo, passMat, count);
  const held = new THREE.InstancedMesh(dealGeo, holdMat, count);
  group.add(passing, held);

  const seeds = [];
  for (let i = 0; i < count; i++) {
    seeds.push({ x: (rng() - 0.5) * 3.2, y: (rng() - 0.5) * 3.2, off: rng(), speed: 0.12 + rng() * 0.2 });
  }

  group.position.set(0, 0, -9);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const m = new THREE.Matrix4();
  const place = function (t) {
    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      const k = (s.off + t * s.speed) % 1;
      // Past the gate it accelerates; short of it, it stalls and drifts back.
      passing.setMatrixAt(i, m.makeTranslation(s.x * (1 - k * 0.7), s.y * (1 - k * 0.7), -12 + k * 24));
      held.setMatrixAt(i, m.makeTranslation(s.x * 2.4, s.y * 2.4, -14 + ((k * 0.35) % 1) * 10));
    }
    passing.instanceMatrix.needsUpdate = true;
    held.instanceMatrix.needsUpdate = true;
  };
  place(0);

  return {
    object: holder,
    tick: function (t) { place(t); frame.rotation.z = Math.PI / 4 + Math.sin(t * 0.2) * 0.08; },
    dispose: function () { dealGeo.dispose(); passMat.dispose(); holdMat.dispose(); },
  };
}
