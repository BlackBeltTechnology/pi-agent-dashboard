// geo-fragments — drifting continental plates pulling apart (topic: geo). Licence: MIT.
export default function (ctx, params) {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const count = Math.max(10, Math.round((quality.particles / 36) * density));

  const geo = new THREE.CircleGeometry(1, 6);
  const mat = new THREE.MeshStandardMaterial({
    color: palette.second, metalness: 0.3, roughness: 0.7,
    // depthWrite off: translucent plates that overlap must blend, not fight.
    transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
  });
  const plates = new THREE.InstancedMesh(geo, mat, count);
  const seeds = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = 3 + rng() * 9;
    seeds.push({ a: a, r: r, s: 0.6 + rng() * 2.2, drift: 0.2 + rng() * 0.5 });
  }

  const group = new THREE.Group();
  group.add(plates);
  group.rotation.x = -Math.PI / 2.6;
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const place = function (t) {
    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      // The drift is the point: the map keeps coming apart, never back together.
      const r = s.r + Math.sin(t * 0.15 * s.drift) * 1.6 + t * 0.02 * s.drift;
      // Every plate used to sit at exactly z=0, so overlapping pairs z-fought
      // and the hexagons shimmered as they drifted. Stratify them in depth.
      v.set(Math.cos(s.a) * r, Math.sin(s.a) * r, i * 0.004);
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), s.a);
      scale.set(s.s, s.s, s.s);
      plates.setMatrixAt(i, m.compose(v, q, scale));
    }
    plates.instanceMatrix.needsUpdate = true;
  };
  place(0);

  return { object: holder, tick: place, dispose: function () { geo.dispose(); mat.dispose(); } };
}
