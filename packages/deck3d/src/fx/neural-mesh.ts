import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Layered node mesh with signal lines between adjacent layers (topic: ai). */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const speed = typeof params.speed === "number" ? params.speed : 1;
  const drift = typeof params.drift === "number" ? params.drift : 0.5;
  const metalness = typeof params.metalness === "number" ? params.metalness : 0.9;
  const glow = typeof params.glow === "number" ? params.glow : 0.8;
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
  // Per-node phase: without it every node would swim in lockstep, which reads
  // as the whole mesh sliding rather than as nodes with their own life.
  const phase = Array.from({ length: count }, () => rng() * Math.PI * 2);

  const nodeGeo = new THREE.SphereGeometry(0.16, 12, 12);
  // Standard (not Basic) so the key and rim lights actually land on the balls;
  // `emissive` is what the bloom pass picks up.
  const nodeMat = new THREE.MeshStandardMaterial({
    color: palette.accent,
    metalness,
    roughness: Math.max(0.05, 0.35 - metalness * 0.25),
    emissive: new THREE.Color(palette.accent),
    emissiveIntensity: glow,
    envMapIntensity: 1.4,
  });
  const nodes = new THREE.InstancedMesh(nodeGeo, nodeMat, count);

  const lineGeo = new THREE.BufferGeometry();
  const lineMat = new THREE.LineBasicMaterial({ color: palette.second, transparent: true, opacity: 0.25 });
  // Which pairs are wired is fixed; the endpoints move, so the buffer is
  // rewritten each tick from the same index pairs.
  const wires: Array<[number, number]> = [];
  for (let l = 0; l + 1 < layers; l++) {
    for (let a = 0; a < perLayer; a++) {
      for (let b = 0; b < perLayer; b++) {
        if (rng() > 0.35) continue;
        wires.push([l * perLayer + a, (l + 1) * perLayer + b]);
      }
    }
  }
  const linePos = new Float32Array(wires.length * 6);
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));

  const group = new THREE.Group();
  group.add(nodes, new THREE.LineSegments(lineGeo, lineMat));
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const flat = pts.flat();
  const m = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const nodeAt = (i: number, t: number): THREE.Vector3 => {
    const base = flat[i];
    return at.set(
      base.x + Math.sin(t * 0.7 * speed + phase[i]) * 0.35 * drift,
      base.y + Math.cos(t * 0.9 * speed + phase[i] * 1.3) * 0.5 * drift,
      base.z + Math.sin(t * 0.5 * speed + phase[i] * 0.7) * 0.6 * drift,
    );
  };

  const place = (t: number): void => {
    for (let i = 0; i < count; i++) {
      const p = nodeAt(i, t);
      nodes.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
    }
    nodes.instanceMatrix.needsUpdate = true;
    wires.forEach(([a, b], w) => {
      const pa = nodeAt(a, t);
      linePos[w * 6] = pa.x;
      linePos[w * 6 + 1] = pa.y;
      linePos[w * 6 + 2] = pa.z;
      const pb = nodeAt(b, t);
      linePos[w * 6 + 3] = pb.x;
      linePos[w * 6 + 4] = pb.y;
      linePos[w * 6 + 5] = pb.z;
    });
    lineGeo.attributes.position.needsUpdate = true;
  };
  place(0);

  return {
    object: holder,
    tick: (t) => {
      place(t);
      group.rotation.y = Math.sin(t * 0.09 * speed) * 0.5;
      // Pulse the glow rather than the opacity: a metal ball that fades out
      // stops reading as metal.
      nodeMat.emissiveIntensity = glow * (0.65 + Math.sin(t * 1.4 * speed) * 0.35);
    },
    dispose: () => {
      nodeGeo.dispose();
      nodeMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
    },
  };
};
