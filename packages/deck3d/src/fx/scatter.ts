import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { countFor, num, str } from "./util.js";

/**
 * Small instanced sprouts scattered over a host surface (three
 * `webgl_instancing_scatter`). The sampler is fed `ctx.rng` so the scatter is
 * the same every run; `surface` = knot | sphere | plane.
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng } = ctx;
  const count = countFor(ctx, 1.2, num(params, "density", 1), 120);
  const size = num(params, "size", 1);
  const spin = num(params, "spin", 1);
  const surface = str(params, "surface", "knot");

  const hostGeo =
    surface === "sphere" ? new THREE.SphereGeometry(3, 48, 32) : surface === "plane" ? new THREE.PlaneGeometry(18, 10, 1, 1) : new THREE.TorusKnotGeometry(2.4, 0.8, 128, 24);
  const hostMat = new THREE.MeshStandardMaterial({ color: palette.card, metalness: 0.2, roughness: 0.8, transparent: true, opacity: surface === "plane" ? 0 : 0.35 });
  const host = new THREE.Mesh(hostGeo, hostMat);

  // `setRandomGenerator` exists at runtime (r160) but is missing from @types/three.
  const sampler = (new MeshSurfaceSampler(host) as MeshSurfaceSampler & { setRandomGenerator: (f: () => number) => MeshSurfaceSampler }).setRandomGenerator(rng).build();
  const sproutGeo = new THREE.ConeGeometry(0.06 * size, 0.32 * size, 5);
  sproutGeo.translate(0, 0.16 * size, 0);
  const sproutMat = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.3, roughness: 0.5 });
  const sprouts = new THREE.InstancedMesh(sproutGeo, sproutMat, count);

  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const phases = new Float32Array(count);
  const bases: THREE.Matrix4[] = [];
  for (let i = 0; i < count; i++) {
    sampler.sample(pos, nrm);
    q.setFromUnitVectors(up, nrm.normalize());
    m.compose(pos, q, new THREE.Vector3(1, 1, 1));
    bases.push(m.clone());
    sprouts.setMatrixAt(i, m);
    phases[i] = rng() * 6.28;
  }
  sprouts.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.add(host, sprouts);
  if (surface === "plane") group.rotation.x = -0.9;
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const s = new THREE.Vector3();
  return {
    object: holder,
    tick: (t) => {
      group.rotation.y = t * 0.12 * spin;
      for (let i = 0; i < count; i++) {
        // Sprouts breathe in height; the base matrix keeps their footing.
        const k = 0.75 + 0.25 * Math.sin(t * 1.4 + phases[i]);
        s.set(1, k, 1);
        m.copy(bases[i]).scale(s);
        sprouts.setMatrixAt(i, m);
      }
      sprouts.instanceMatrix.needsUpdate = true;
    },
    dispose: () => {
      hostGeo.dispose();
      hostMat.dispose();
      sproutGeo.dispose();
      sproutMat.dispose();
    },
  };
};
