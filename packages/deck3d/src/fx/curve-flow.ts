import { InstancedFlow } from "three/examples/jsm/modifiers/CurveModifier.js";
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { countFor, num } from "./util.js";

/**
 * Glyph-sized capsules bending along seeded loops (three
 * `webgl_modifier_curve_instanced`). `InstancedFlow` accumulates offsets by
 * design; here each offset is SET from `t` every tick, so the frame is a pure
 * function of time.
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng } = ctx;
  const lanes = Math.max(1, Math.min(6, Math.round(num(params, "lanes", 3))));
  const count = countFor(ctx, 12, num(params, "density", 1), 12);
  const speed = num(params, "speed", 1);

  const curves: THREE.CatmullRomCurve3[] = [];
  for (let l = 0; l < lanes; l++) {
    const pts: THREE.Vector3[] = [];
    const cx = (rng() - 0.5) * 10;
    const cy = (rng() - 0.5) * 4;
    const r = 3 + rng() * 4;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pts.push(new THREE.Vector3(cx + Math.cos(a) * r * (0.8 + rng() * 0.4), cy + Math.sin(a) * r * 0.4 * (0.8 + rng() * 0.4), -4 + (rng() - 0.5) * 3));
    }
    curves.push(new THREE.CatmullRomCurve3(pts, true));
  }

  const geo = new THREE.CapsuleGeometry(0.09, 0.9, 4, 8);
  geo.rotateZ(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.4, roughness: 0.4 });
  // `writeChanges` exists at runtime (r160) but is missing from @types/three.
  const flow = new InstancedFlow(count, lanes, geo, mat) as InstancedFlow & { writeChanges: (i: number) => void };
  curves.forEach((c, i) => flow.updateCurve(i, c));
  const offsets = new Float32Array(count);
  const lane = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    lane[i] = i % lanes;
    offsets[i] = rng();
    flow.setCurve(i, lane[i]);
    flow.object3D.setColorAt(i, new THREE.Color(i % 3 === 0 ? palette.second : palette.accent));
  }

  const group = new THREE.Group();
  group.add(flow.object3D);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;
  return {
    object: holder,
    tick: (t) => {
      for (let i = 0; i < count; i++) {
        flow.offsets[i] = (offsets[i] + t * 0.04 * speed * (1 + (lane[i] % 2) * 0.5)) % 1;
        flow.writeChanges(i);
      }
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
};
