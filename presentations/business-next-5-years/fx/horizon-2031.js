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
  const AXIS = new THREE.Vector3(0.3, 0.6, 0.74).normalize();
  const place = function (t) {
    for (let i = 0; i < count; i++) {
      // Wrap so the corridor never runs out of years.
      const z = -(((i * 6 + t * 1.6 * speed) % (count * 6)) - count * 3);
      const k = 1 - Math.min(1, Math.abs(z) / (count * 3));
      v.set(0, 0, z);
      sc.set(1, 1, 1);
      gates.setMatrixAt(i, m.compose(v, q, sc));
      // The marker rides ITS gate: a phase offset per ring plus a steady
      // sweep, so each cube travels the circumference instead of sitting
      // pinned at x = 4. Depends only on `i` and `t`, so a fixed time still
      // renders byte-identically.
      const a = i * 1.7 + t * 0.55 * speed;
      v.set(Math.cos(a) * 4, Math.sin(a) * 4, z);
      // Tumble as it rides, so the travel reads on a cube's flat faces.
      q.setFromAxisAngle(AXIS, a * 0.8);
      sc.set(1 + k, 1 + k, 1 + k);
      marks.setMatrixAt(i, m.compose(v, q, sc));
      q.identity();
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
