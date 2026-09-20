// workforce-100 — 100 figures, 59 needing training, in four bands. Topic: work. Licence: MIT.
export default function (ctx, params) {
  const { THREE, palette, quality } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const count = Math.max(40, Math.min(100, Math.round(100 * density * (quality.particles >= 900 ? 1 : 0.45))));

  const geo = new THREE.CapsuleGeometry(0.16, 0.42, 4, 8);
  const upskilled = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.4, roughness: 0.5 });
  const rest = new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.3, roughness: 0.7, transparent: true, opacity: 0.55 });

  // 59 in 100 need training; the split is the message, so it is proportional.
  const marked = Math.round(count * 0.59);
  const a = new THREE.InstancedMesh(geo, upskilled, marked);
  const b = new THREE.InstancedMesh(geo, rest, count - marked);

  const cols = 20;
  const m = new THREE.Matrix4();
  const place = function (mesh, from, n) {
    for (let i = 0; i < n; i++) {
      const idx = from + i;
      m.makeTranslation(((idx % cols) - cols / 2) * 0.95, Math.floor(idx / cols) * 0.95 - 3, 0);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(a, 0, marked);
  place(b, marked, count - marked);

  const group = new THREE.Group();
  group.add(a, b);
  group.position.set(0, 0, -11);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  return {
    object: holder,
    tick: function (t) {
      group.rotation.y = Math.sin(t * 0.16) * 0.2;
      upskilled.emissiveIntensity = 0;
      a.position.y = Math.sin(t * 0.6) * 0.08;
    },
    dispose: function () { geo.dispose(); upskilled.dispose(); rest.dispose(); },
  };
}
