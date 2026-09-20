import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** Rows of rack units with blinking status LEDs (topic: compute). */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, quality, rng } = ctx;
  const density = typeof params.density === "number" ? params.density : 1;
  const speed = typeof params.speed === "number" ? params.speed : 1;
  const count = Math.max(16, Math.round((quality.particles / 14) * density));

  const unitGeo = new THREE.BoxGeometry(3.4, 0.34, 1.2);
  const unitMat = new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.8 });
  const units = new THREE.InstancedMesh(unitGeo, unitMat, count);

  const ledGeo = new THREE.SphereGeometry(0.06, 6, 6);
  const ledMat = new THREE.MeshBasicMaterial({ color: palette.accent });
  const leds = new THREE.InstancedMesh(ledGeo, ledMat, count);

  const perColumn = 10;
  const m = new THREE.Matrix4();
  const phases: number[] = [];
  for (let i = 0; i < count; i++) {
    const col = Math.floor(i / perColumn);
    const x = (col - 1.5) * 5.2;
    const y = -4 + (i % perColumn) * 0.46;
    m.makeTranslation(x, y, 0);
    units.setMatrixAt(i, m);
    leds.setMatrixAt(i, m.clone().setPosition(x + 1.5, y, 0.65));
    phases.push(rng() * Math.PI * 2);
  }
  units.instanceMatrix.needsUpdate = true;
  leds.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.add(units, leds);
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  return {
    object: holder,
    tick: (t) => {
      group.rotation.y = Math.sin(t * 0.05 * speed) * 0.2;
      // One shared blink phase keeps the cost flat while still reading as traffic.
      ledMat.opacity = 0.45 + Math.sin(t * 2.4 * speed + phases[0]) * 0.4;
      ledMat.transparent = true;
    },
    dispose: () => {
      unitGeo.dispose();
      unitMat.dispose();
      ledGeo.dispose();
      ledMat.dispose();
    },
  };
};
