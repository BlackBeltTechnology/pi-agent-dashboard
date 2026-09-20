import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Layered node mesh with signal lines between adjacent layers (topic: ai). */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const speed = typeof params.speed === "number" ? params.speed : 1;
  const perLayer = Math.max(4, Math.round((quality.particles / 90) * density));
  const layers = 4;
  const count = perLayer * layers;

  const pts: THREE.Vector3[][] = [];
  for (let l = 0; l < layers; l++) {
    const layer: THREE.Vector3[] = [];
    for (let i = 0; i < perLayer; i++) {
      layer.push(new THREE.Vector3((l - (layers - 1) / 2) * 6, (i - (perLayer - 1) / 2) * 2.1 + (rng() - 0.5), (rng() - 0.5) * 3));
    }
    pts.push(layer);
  }

  const nodeGeo = new THREE.SphereGeometry(0.16, 10, 10);
  const nodeMat = new THREE.MeshBasicMaterial({ color: palette.accent, transparent: true, opacity: 0.85 });
  const nodes = new THREE.InstancedMesh(nodeGeo, nodeMat, count);
  const m = new THREE.Matrix4();
  let k = 0;
  for (const layer of pts) for (const p of layer) nodes.setMatrixAt(k++, m.makeTranslation(p.x, p.y, p.z));
  nodes.instanceMatrix.needsUpdate = true;

  const segs: number[] = [];
  for (let l = 0; l + 1 < layers; l++) {
    for (const a of pts[l]) {
      for (const b of pts[l + 1]) {
        if (rng() > 0.35) continue;
        segs.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs), 3));
  const lineMat = new THREE.LineBasicMaterial({ color: palette.second, transparent: true, opacity: 0.25 });

  const group = new THREE.Group();
  group.add(nodes, new THREE.LineSegments(lineGeo, lineMat));
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  return {
    object: holder,
    tick: (t) => {
      group.rotation.y = Math.sin(t * 0.09 * speed) * 0.5;
      nodeMat.opacity = 0.6 + Math.sin(t * 1.4 * speed) * 0.25;
    },
    dispose: () => {
      nodeGeo.dispose();
      nodeMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
    },
  };
};
