import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { countFor, num, str } from "./util.js";

/**
 * Drifting nodes that link to neighbours within reach (three
 * `webgl_buffergeometry_drawrange`). Each node's position is a pure function
 * of `t` (a triangle-wave bounce inside the box), so the frame is
 * deterministic; the link buffer is rebuilt per tick and `drawRange` trims it.
 * `nodeShape` = point | sphere | cube — sphere/cube use one instanced mesh.
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng } = ctx;
  const count = countFor(ctx, 5, num(params, "density", 0.5) * 2, 24);
  const speed = num(params, "speed", 1);
  const reach = num(params, "linkDistance", 3.2);
  const shape = str(params, "nodeShape", "point");
  const HALF = new THREE.Vector3(14, 6, 6);

  const origin = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) {
    origin[i] = (rng() - 0.5) * 2 * [HALF.x, HALF.y, HALF.z][i % 3];
    vel[i] = (rng() - 0.5) * 0.8;
  }
  const positions = new Float32Array(count * 3);
  const nodeGeo = new THREE.BufferGeometry();
  nodeGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const group = new THREE.Group();
  let points: THREE.Points | null = null;
  let inst: THREE.InstancedMesh | null = null;
  const nodeMat: THREE.Material =
    shape === "point"
      ? new THREE.PointsMaterial({ color: palette.accent, size: 0.16, transparent: true, opacity: 0.9, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.5, roughness: 0.4 });
  const instGeo = shape === "cube" ? new THREE.BoxGeometry(0.22, 0.22, 0.22) : new THREE.SphereGeometry(0.12, 10, 8);
  if (shape === "point") {
    points = new THREE.Points(nodeGeo, nodeMat);
    group.add(points);
  } else {
    inst = new THREE.InstancedMesh(instGeo, nodeMat, count);
    group.add(inst);
  }

  const maxLinks = count * count;
  const linkPos = new Float32Array(maxLinks * 3);
  const linkGeo = new THREE.BufferGeometry();
  linkGeo.setAttribute("position", new THREE.BufferAttribute(linkPos, 3).setUsage(THREE.DynamicDrawUsage));
  const linkMat = new THREE.LineBasicMaterial({ color: palette.second, transparent: true, opacity: 0.35, depthWrite: false });
  const lines = new THREE.LineSegments(linkGeo, linkMat);
  group.add(lines);
  group.position.z = -4;

  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  // Triangle wave: bounces between -h and +h without integrating anything.
  const bounce = (x: number, h: number) => {
    const p = 4 * h;
    const m = ((((x + h) % p) + p) % p);
    return m < 2 * h ? m - h : 3 * h - m;
  };
  const m4 = new THREE.Matrix4();
  const r2 = reach * reach;
  return {
    object: holder,
    tick: (t) => {
      const half = [HALF.x, HALF.y, HALF.z];
      for (let i = 0; i < count * 3; i++) positions[i] = bounce(origin[i] + vel[i] * t * speed, half[i % 3]);
      if (points) nodeGeo.attributes.position.needsUpdate = true;
      if (inst) {
        for (let i = 0; i < count; i++) inst.setMatrixAt(i, m4.makeTranslation(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]));
        inst.instanceMatrix.needsUpdate = true;
      }
      let n = 0;
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = positions[i * 3] - positions[j * 3];
          const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
          const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          linkPos[n++] = positions[i * 3];
          linkPos[n++] = positions[i * 3 + 1];
          linkPos[n++] = positions[i * 3 + 2];
          linkPos[n++] = positions[j * 3];
          linkPos[n++] = positions[j * 3 + 1];
          linkPos[n++] = positions[j * 3 + 2];
        }
      }
      linkGeo.setDrawRange(0, n / 3);
      linkGeo.attributes.position.needsUpdate = true;
      group.rotation.y = Math.sin(t * 0.05) * 0.15;
    },
    dispose: () => {
      nodeGeo.dispose();
      instGeo.dispose();
      nodeMat.dispose();
      linkGeo.dispose();
      linkMat.dispose();
    },
  };
};
