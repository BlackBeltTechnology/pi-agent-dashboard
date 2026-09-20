// agent-depth — a wide shallow field pierced by a few narrow deep shafts (topic: agents). Licence: MIT.
import type * as ThreeNS from "three";
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

export const create: FxFactory = function (ctx: FxContext, params: FxParams): FxHandle {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const wave = typeof params.wave === "number" ? params.wave : 0.55;
  const waveSpeed = typeof params.waveSpeed === "number" ? params.waveSpeed : 0.9;
  const count = Math.max(24, Math.round((quality.particles / 14) * density));

  const geo = new THREE.CylinderGeometry(0.22, 0.22, 1, 10);
  const mat = new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.5, roughness: 0.5, transparent: true, opacity: 0.65 });
  const shafts = new THREE.InstancedMesh(geo, mat, count);

  const deepMat = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.7, roughness: 0.3 });
  const deepCount = Math.max(2, Math.round(count * 0.08));
  const deep = new THREE.InstancedMesh(geo, deepMat, deepCount);

  const side = Math.ceil(Math.sqrt(count));
  const seeds: Array<Record<string, number>> = [];
  for (let i = 0; i < count; i++) {
    seeds.push({ x: ((i % side) - side / 2) * 2.3, z: (Math.floor(i / side) - side / 2) * 2.3, d: 0.4 + rng() * 0.5, ph: rng() * 6.283 });
  }
  const deepSeeds = seeds.slice(0, deepCount).map(function (s, i) {
    return { x: s.x, z: s.z, d: 5 + i * 0.8, ph: s.ph };
  });

  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const put = function (mesh: ThreeNS.InstancedMesh, list: Array<Record<string, number>>, t: number, wobble: number) {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      // Height is a travelling sine across the grid: the phase carries the
      // shaft's own seed AND its x/z, so the field ripples instead of
      // pumping in unison.
      const k = Math.sin(t * waveSpeed + s.ph + s.x * 0.18 + s.z * 0.12);
      const d = s.d * (1 + Math.sin(t * 0.5 + s.ph) * wobble + k * wave);
      // Base-anchored: the foot stays on the floor plane and the TOP rises
      // and falls. Pinning the top instead made the wave read upside down.
      v.set(s.x, -3 + d / 2, s.z);
      sc.set(1, d, 1);
      mesh.setMatrixAt(i, m.compose(v, q, sc));
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  const group = new THREE.Group();
  group.add(shafts, deep);
  group.rotation.x = 0.16;
  group.position.set(0, 1, -10);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const place = function (t: number) { put(shafts, seeds, t, 0.08); put(deep, deepSeeds, t, 0.03); };
  place(0);

  return { object: holder, tick: place, dispose: function () { geo.dispose(); mat.dispose(); deepMat.dispose(); } };
}
