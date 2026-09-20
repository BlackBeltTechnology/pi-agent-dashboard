// trust-ledger — verification seals stacking into an append-only chain (topic: trust). Licence: MIT.
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

export const create: FxFactory = function (ctx: FxContext, params: FxParams): FxHandle {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const count = Math.max(12, Math.round((quality.particles / 30) * density));

  const geo = new THREE.BoxGeometry(1.5, 0.5, 1.5);
  const mat = new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.6, roughness: 0.35, transparent: true, opacity: 0.6 });
  const blocks = new THREE.InstancedMesh(geo, mat, count);

  const seeds: Array<Record<string, number>> = [];
  for (let i = 0; i < count; i++) {
    seeds.push({ x: (i % 4 - 1.5) * 4.5, y: -5 + Math.floor(i / 4) * 1.1, ph: rng() * 6.283 });
  }

  const linkGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6);
  const linkMat = new THREE.MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.6 });
  const links = new THREE.InstancedMesh(linkGeo, linkMat, count);

  const group = new THREE.Group();
  group.add(blocks, links);
  group.position.set(0, 0, -6);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const m = new THREE.Matrix4();
  const place = function (t: number) {
    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      const y = s.y + Math.sin(t * 0.35 + s.ph) * 0.12;
      blocks.setMatrixAt(i, m.makeTranslation(s.x, y, 0));
      links.setMatrixAt(i, m.makeTranslation(s.x, y + 0.8, 0));
    }
    blocks.instanceMatrix.needsUpdate = true;
    links.instanceMatrix.needsUpdate = true;
  };
  place(0);

  return {
    object: holder,
    tick: place,
    dispose: function () { geo.dispose(); mat.dispose(); linkGeo.dispose(); linkMat.dispose(); },
  };
}
