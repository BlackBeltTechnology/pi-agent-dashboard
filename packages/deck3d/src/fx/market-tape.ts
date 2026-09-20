import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Scrolling ticker bands with a candlestick ridge (topics: money, data). */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const speed = typeof params.speed === "number" ? params.speed : 1;
  const count = Math.max(20, Math.round((quality.particles / 10) * density));

  const barGeo = new THREE.BoxGeometry(0.22, 1, 0.22);
  const barMat = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.8 });
  const bars = new THREE.InstancedMesh(barGeo, barMat, count);

  const m = new THREE.Matrix4();
  const rows = 3;
  const seeds = Array.from({ length: count }, (_, i) => ({
    h: 0.5 + rng() * 4,
    row: i % rows,
    x0: ((i / count) * 2 - 1) * 26,
  }));

  const group = new THREE.Group();
  group.add(bars);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const place = (t: number) => {
    seeds.forEach((s, i) => {
      // Wrap into [-13, 13] so the tape scrolls forever without reallocating.
      const x = (((s.x0 + t * 1.4 * speed + 13) % 26) + 26) % 26 - 13;
      m.makeScale(1, s.h, 1);
      m.setPosition(x, -4 + s.row * 4.2 + s.h / 2, -s.row * 1.5);
      bars.setMatrixAt(i, m);
    });
    bars.instanceMatrix.needsUpdate = true;
  };
  place(0);

  return {
    object: holder,
    tick: place,
    dispose: () => {
      barGeo.dispose();
      barMat.dispose();
    },
  };
};
