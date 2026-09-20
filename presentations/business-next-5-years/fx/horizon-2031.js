// horizon-2031 — year gates receding toward a horizon (topic: timeline). Licence: MIT.
export default function (ctx, params) {
  const { THREE, palette, quality } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const speed = typeof params.speed === "number" ? params.speed : 1;
  const count = Math.max(6, Math.round((quality.particles / 90) * density));

  const geo = new THREE.TorusGeometry(4, 0.05, 6, 48);
  const mat = new THREE.MeshBasicMaterial({ color: palette.second, transparent: true, opacity: 0.35 });
  const gates = new THREE.InstancedMesh(geo, mat, count);

  const markGeo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
  const markMat = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.6, roughness: 0.35 });
  const marks = new THREE.InstancedMesh(markGeo, markMat, count);

  const group = new THREE.Group();
  group.add(gates, marks);
  group.position.set(0, 0, -8);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const place = function (t) {
    for (let i = 0; i < count; i++) {
      // Wrap so the corridor never runs out of years.
      const z = -(((i * 6 + t * 1.6 * speed) % (count * 6)) - count * 3);
      const k = 1 - Math.min(1, Math.abs(z) / (count * 3));
      v.set(0, 0, z);
      sc.set(1, 1, 1);
      gates.setMatrixAt(i, m.compose(v, q, sc));
      v.set(4, 0, z);
      sc.set(1 + k, 1 + k, 1 + k);
      marks.setMatrixAt(i, m.compose(v, q, sc));
    }
    gates.instanceMatrix.needsUpdate = true;
    marks.instanceMatrix.needsUpdate = true;
  };
  place(0);

  return {
    object: holder,
    tick: place,
    dispose: function () { geo.dispose(); mat.dispose(); markGeo.dispose(); markMat.dispose(); },
  };
}
