// cohort-grid — a ranked grid of figures split into two cohorts (topic: work). Licence: MIT.
import type * as ThreeNS from "three";
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

export const create: FxFactory = function (ctx: FxContext, params: FxParams): FxHandle {
  const { THREE, palette, quality } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const cycleSpeed = typeof params.cycleSpeed === "number" ? params.cycleSpeed : 0.12;
  const cycleDepth = typeof params.cycleDepth === "number" ? params.cycleDepth : 0.6;
  const share = typeof params.share === "number" ? params.share : 0.5;
  const count = Math.max(40, Math.min(100, Math.round(100 * density * (quality.particles >= 900 ? 1 : 0.45))));

  const geo = new THREE.CapsuleGeometry(0.16, 0.42, 4, 8);
  const upskilled = new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.4, roughness: 0.5 });
  const rest = new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.3, roughness: 0.7, transparent: true, opacity: 0.55 });

  // The split is the message, so it is proportional — the deck supplies it via `share`.
  const marked = Math.round(count * share);
  const a = new THREE.InstancedMesh(geo, upskilled, marked);
  const b = new THREE.InstancedMesh(geo, rest, count - marked);

  const cols = 20;
  const m = new THREE.Matrix4();
  const place = function (mesh: ThreeNS.InstancedMesh, from: number, n: number) {
    for (let i = 0; i < n; i++) {
      const idx = from + i;
      m.makeTranslation(((idx % cols) - cols / 2) * 0.95, Math.floor(idx / cols) * 0.95 - 3, 0);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(a, 0, marked);
  place(b, marked, count - marked);

  const group = new THREE.Group();
  group.add(a, b);
  group.position.set(0, 0, -11);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  // Colour cycling is a slow, deliberate sweep between the two palette
  // colours the two cohorts already use — NOT a per-figure re-roll, which
  // reads as random flicker.
  const from = new THREE.Color(palette.accent);
  const to = new THREE.Color(palette.second);
  const litA = new THREE.Color();
  const litB = new THREE.Color();

  return {
    object: holder,
    tick: function (t) {
      group.rotation.y = Math.sin(t * 0.16) * 0.2;
      a.position.y = Math.sin(t * 0.6) * 0.08;
      // Half-amplitude around each cohort's own colour, in antiphase, so the
      // split stays legible while the field breathes.
      const k = (Math.sin(t * cycleSpeed * 6.283) * 0.5 + 0.5) * cycleDepth;
      upskilled.color.copy(litA.copy(from).lerp(to, k * 0.5));
      rest.color.copy(litB.copy(to).lerp(from, k * 0.5));
    },
    dispose: function () { geo.dispose(); upskilled.dispose(); rest.dispose(); },
  };
}
