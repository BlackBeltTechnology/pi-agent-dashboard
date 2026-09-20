import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Wire globe with great-circle arcs between seeded cities (topic: geo). */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const speed = typeof params.speed === "number" ? params.speed : 1;
  const arcs = Math.max(4, Math.round((quality.particles / 60) * density));

  const group = new THREE.Group();
  const geometries: Array<{ dispose: () => void }> = [];
  // Far enough back that the whole sphere reads as a globe, not a tangle.
  const R = 6;

  const sphere = new THREE.SphereGeometry(R, 28, 18);
  geometries.push(sphere);
  group.add(
    new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: palette.second, wireframe: true, transparent: true, opacity: 0.22 })),
  );

  const onSphere = (): THREE.Vector3 => {
    const u = rng() * Math.PI * 2;
    const v = Math.acos(2 * rng() - 1);
    return new THREE.Vector3(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)).multiplyScalar(R);
  };

  const arcMat = new THREE.MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.55 });
  const travellers: Array<{ m: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; off: number }> = [];
  const dot = new THREE.SphereGeometry(0.12, 8, 8);
  geometries.push(dot);

  for (let i = 0; i < arcs; i++) {
    const a = onSphere();
    const b = onSphere();
    const mid = a.clone().add(b).normalize().multiplyScalar(R * 1.45);
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const tube = new THREE.TubeGeometry(curve, 24, 0.035, 6, false);
    geometries.push(tube);
    group.add(new THREE.Mesh(tube, arcMat));
    const m = new THREE.Mesh(dot, new THREE.MeshBasicMaterial({ color: palette.accent }));
    group.add(m);
    travellers.push({ m, curve, off: rng() });
  }

  const holder = new THREE.Group();
  group.position.set(0, 0, -10);
  holder.add(group);
  holder.userData.count = arcs;

  return {
    object: holder,
    tick: (t) => {
      group.rotation.y = t * 0.06 * speed;
      for (const tr of travellers) tr.m.position.copy(tr.curve.getPoint((t * 0.12 * speed + tr.off) % 1));
    },
    dispose: () => {
      for (const g of geometries) g.dispose();
      arcMat.dispose();
    },
  };
};
