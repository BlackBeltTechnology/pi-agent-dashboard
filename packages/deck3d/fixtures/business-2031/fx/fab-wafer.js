// fab-wafer — one wafer feeding everything: a deliberately single-source supply chain (topic: compute). Licence: MIT.
export default function (ctx, params) {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const count = Math.max(24, Math.round((quality.particles / 12) * density));

  const group = new THREE.Group();
  const wafer = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6, 0.12, 64),
    new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.85, roughness: 0.2, transparent: true, opacity: 0.4 }),
  );
  wafer.rotation.x = Math.PI / 2.2;
  group.add(wafer);

  const dieGeo = new THREE.BoxGeometry(0.6, 0.6, 0.08);
  const dieMat = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.7, roughness: 0.3 });
  const dies = new THREE.InstancedMesh(dieGeo, dieMat, count);
  const side = Math.ceil(Math.sqrt(count));
  const m = new THREE.Matrix4();
  const phases = [];
  for (let i = 0; i < count; i++) {
    const x = ((i % side) - side / 2) * 0.78;
    const y = (Math.floor(i / side) - side / 2) * 0.78;
    m.makeTranslation(x, y, 0.1);
    dies.setMatrixAt(i, m);
    phases.push(rng() * 6.283);
  }
  dies.instanceMatrix.needsUpdate = true;
  wafer.add(dies);

  group.position.set(0, 0, -14);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  return {
    object: holder,
    tick: function (t) {
      wafer.rotation.z = t * 0.06;
      dieMat.opacity = 0.7 + Math.sin(t * 1.1 + phases[0]) * 0.25;
      dieMat.transparent = true;
    },
    dispose: function () { dieGeo.dispose(); dieMat.dispose(); },
  };
}
