// fab-wafer — one wafer feeding everything: a deliberately single-source supply chain (topic: compute). Licence: MIT.
export default function (ctx, params) {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const wave = typeof params.wave === "number" ? params.wave : 1;
  const waveSpeed = typeof params.waveSpeed === "number" ? params.waveSpeed : 1.1;
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
  const cells = [];
  for (let i = 0; i < count; i++) {
    const x = ((i % side) - side / 2) * 0.78;
    const y = (Math.floor(i / side) - side / 2) * 0.78;
    cells.push({ x: x, y: y, ph: rng() * 6.283 });
    m.makeTranslation(x, y, 0.1);
    dies.setMatrixAt(i, m);
    phases.push(rng() * 6.283);
  }
  dies.instanceMatrix.needsUpdate = true;

  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  // Die height rides a wave radiating out from the wafer centre — the dies
  // grow OUT of the wafer (z), which is the axis the box is flat on.
  const place = function (t) {
    for (let i = 0; i < count; i++) {
      const c = cells[i];
      const rad = Math.sqrt(c.x * c.x + c.y * c.y);
      // The wafer sits nearly edge-on, so its normal is almost horizontal on
      // screen: a tall extrusion smears sideways instead of reading as height.
      const h = 1 + (Math.sin(t * waveSpeed - rad * 0.55 + c.ph * 0.3) * 0.5 + 0.5) * 2.2 * wave;
      v.set(c.x, c.y, 0.1 + h * 0.04);
      sc.set(1, 1, h);
      dies.setMatrixAt(i, m.compose(v, q, sc));
    }
    dies.instanceMatrix.needsUpdate = true;
  };
  place(0);
  wafer.add(dies);

  group.position.set(0, 0, -14);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  return {
    object: holder,
    tick: function (t) {
      place(t);
      wafer.rotation.z = t * 0.06;
      dieMat.opacity = 0.7 + Math.sin(t * 1.1 + phases[0]) * 0.25;
      dieMat.transparent = true;
    },
    dispose: function () { dieGeo.dispose(); dieMat.dispose(); },
  };
}
