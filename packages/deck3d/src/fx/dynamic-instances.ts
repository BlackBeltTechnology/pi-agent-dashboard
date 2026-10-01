import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { countFor, num } from "./util.js";

/**
 * A cube of cubes, each turning on its own phase (three
 * `webgl_instancing_dynamic`). Pure function of `t`: no accumulated state.
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng } = ctx;
  const side = Math.max(3, Math.round(Math.cbrt(countFor(ctx, 2, num(params, "density", 1), 27))));
  const count = side ** 3;
  const spin = num(params, "spin", 1);
  const gap = num(params, "gap", 1.3);

  const geo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
  const mat = new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.55, roughness: 0.4 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) phases[i] = rng() * 6.28;

  const group = new THREE.Group();
  group.add(mesh);
  group.position.z = -14;
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const off = (side - 1) / 2;
  return {
    object: holder,
    tick: (t) => {
      let i = 0;
      for (let x = 0; x < side; x++) {
        for (let y = 0; y < side; y++) {
          for (let z = 0; z < side; z++) {
            const ph = phases[i];
            e.set(Math.sin(x / 4 + t * spin + ph), Math.sin(y / 4 + t * spin), Math.sin(z / 4 + t * spin));
            q.setFromEuler(e);
            p.set((x - off) * gap, (y - off) * gap, (z - off) * gap);
            mesh.setMatrixAt(i++, m.compose(p, q, one));
          }
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.rotation.y = t * 0.05 * spin;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
};
