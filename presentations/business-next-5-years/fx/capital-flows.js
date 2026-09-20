// capital-flows — capital streams converging on a narrowing gate (topic: money). Licence: MIT.
export default function (ctx, params) {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const count = Math.max(30, Math.round((quality.particles / 6) * density));

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: palette.accent, size: 0.16, transparent: true, opacity: 0.85 });
  const points = new THREE.Points(geo, mat);

  const seeds = [];
  for (let i = 0; i < count; i++) seeds.push({ lane: rng(), off: rng(), speed: 0.1 + rng() * 0.25, jitter: (rng() - 0.5) * 0.02 });

  const group = new THREE.Group();
  group.add(points);
  group.position.set(0, 0, -12);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const place = function (t) {
    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      const k = (s.off + t * s.speed) % 1;
      // Wide at the source, pinched at the gate: scrutiny, not scarcity.
      const spread = (1 - k) * 9 + 0.3;
      positions[i * 3] = (s.lane - 0.5) * 2 * spread;
      positions[i * 3 + 1] = s.jitter + Math.sin(s.lane * 12) * spread * 0.35;
      positions[i * 3 + 2] = -k * 16;
    }
    geo.attributes.position.needsUpdate = true;
  };
  place(0);

  return { object: holder, tick: place, dispose: function () { geo.dispose(); mat.dispose(); } };
}
