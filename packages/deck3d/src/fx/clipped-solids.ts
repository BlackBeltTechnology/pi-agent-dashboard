import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { num, str } from "./util.js";

/**
 * Solids sliced by slowly turning clip planes (three `webgl_clipping_advanced`,
 * `_intersection`, `_stencil` folded into one card via `mode`):
 *  - `planes`        — one plane slices the solid (union clip);
 *  - `intersection`  — `clipIntersection`: three planes carve ONE octant out;
 *  - `caps`          — the same octant cut, with stencil caps closing the cut.
 * The plane normals all lean to -z so the carved octant sits on the +z
 * (camera-facing) corner, and turn about the view axis so it stays there.
 * Clip planes are WORLD-space and the slide group sits anywhere along the
 * rail, so `tick` rebuilds them from the holder's world matrix. Caps are
 * ordinary children of the holder: each frame the world plane is mapped into
 * holder space and the cap is posed there. (A "world-space root" whose
 * `.matrix` is the holder's inverse does NOT work: with `matrixAutoUpdate`
 * off, assigning `.matrix` never flags `matrixWorldNeedsUpdate`, so three kept
 * the first frame's world matrix and the caps sat off the plane — a sliver.)
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng } = ctx;
  const mode = str(params, "mode", "caps");
  const speed = num(params, "speed", 1);
  const size = num(params, "size", 1);
  // One centred solid, like the example: the planes meet at its centre, so
  // the carve always lands on it. Quality buys mesh detail, not more solids.
  const segments = ctx.quality.particles >= 1500 ? 160 : ctx.quality.particles >= 900 ? 110 : 64;
  const count = segments;
  const carve = mode !== "planes";
  const PLANES = carve ? 3 : 1;

  const planes = Array.from({ length: PLANES }, () => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0));
  // Negated copies of the planes: a cap must be KEPT where the other planes
  // are positive (inside the carved octant), which union clipping expresses
  // as "clip by the negated plane".
  const negated = planes.map(() => new THREE.Plane());
  // three discards a plane's NEGATIVE side, so normals leaning to -z put the
  // carved octant (negative of all three) on the +z, camera-facing corner.
  const axes = carve
    ? [new THREE.Vector3(0.75, 0.3, -0.6), new THREE.Vector3(-0.5, 0.55, -0.65), new THREE.Vector3(0.15, -0.7, -0.7)].map((v) => v.normalize())
    : [new THREE.Vector3(0.6, 0.5, -0.62).normalize()];
  const VIEW = new THREE.Vector3(0, 0, 1);
  const geo = new THREE.TorusKnotGeometry(2.4 * size, 0.9 * size, segments, Math.max(8, segments >> 3));
  const mat = new THREE.MeshStandardMaterial({
    color: palette.second,
    metalness: 0.6,
    roughness: 0.35,
    side: THREE.DoubleSide,
    clippingPlanes: planes,
    clipIntersection: carve,
    clipShadows: true,
  });

  const group = new THREE.Group();
  const solids: THREE.Group[] = [];
  const stencilMats: THREE.Material[] = [];
  const CENTRE = new THREE.Vector3(num(params, "x", 5), 0.5, -7);
  {
    const solid = new THREE.Group();
    solid.position.copy(CENTRE);
    solid.userData.spin = 0.25 + rng() * 0.3;
    solid.userData.phase = rng() * 6.28;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = PLANES + 1;
    solid.add(mesh);
    if (mode === "caps") {
      // Per plane p: the solid CLIPPED BY p (so it is open exactly at that cut)
      // writes the stencil — back faces increment, front faces decrement — and
      // the count is non-zero only on p's cross-section, where the cap draws.
      // (Reading this the other way round — clip by the OTHER planes — puts
      // the cap on every cut except p's.)
      for (let p = 0; p < PLANES; p++) {
        const own = [planes[p]];
        const stencil = (side: THREE.Side, op: THREE.StencilOp) =>
          new THREE.MeshBasicMaterial({
            depthWrite: false,
            depthTest: false,
            colorWrite: false,
            stencilWrite: true,
            stencilFunc: THREE.AlwaysStencilFunc,
            side,
            clippingPlanes: own,
            stencilFail: op,
            stencilZFail: op,
            stencilZPass: op,
          });
        const front = stencil(THREE.FrontSide, THREE.DecrementWrapStencilOp);
        const back = stencil(THREE.BackSide, THREE.IncrementWrapStencilOp);
        stencilMats.push(front, back);
        const f = new THREE.Mesh(geo, front);
        const b = new THREE.Mesh(geo, back);
        f.renderOrder = b.renderOrder = p + 1;
        solid.add(f, b);
      }
    }
    group.add(solid);
    solids.push(solid);
  }

  // One cap per plane, posed in holder space each tick. Each cap is clipped
  // by the OTHER planes so it stops at their cuts.
  const capMats: THREE.Material[] = [];
  const capGeo = new THREE.PlaneGeometry(40, 40);
  const caps: THREE.Mesh[] = [];
  if (mode === "caps") {
    for (let p = 0; p < PLANES; p++) {
      const capMat = new THREE.MeshStandardMaterial({
        color: palette.accent,
        metalness: 0.3,
        roughness: 0.6,
        side: THREE.DoubleSide,
        clippingPlanes: negated.filter((_, k) => k !== p),
        stencilWrite: true,
        stencilRef: 0,
        stencilFunc: THREE.NotEqualStencilFunc,
        stencilFail: THREE.ReplaceStencilOp,
        stencilZFail: THREE.ReplaceStencilOp,
        stencilZPass: THREE.ReplaceStencilOp,
      });
      capMats.push(capMat);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.renderOrder = p + 1.1;
      cap.onAfterRender = (renderer) => renderer.clearStencil();
      group.add(cap);
      caps.push(cap);
    }
  }

  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;

  const q = new THREE.Quaternion();
  const n = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const local = new THREE.Plane();
  const Z = new THREE.Vector3(0, 0, 1);
  return {
    object: holder,
    tick: (t) => {
      holder.updateWorldMatrix(true, false);
      for (const s of solids) s.rotation.set(t * 0.3 * speed * s.userData.spin + s.userData.phase, t * 0.5 * speed * s.userData.spin, 0);
      // The planes turn about the field's centre, in world space.
      centre.copy(CENTRE).applyMatrix4(holder.matrixWorld);
      q.setFromAxisAngle(VIEW, t * 0.2 * speed);
      for (let p = 0; p < PLANES; p++) {
        n.copy(axes[p]).applyQuaternion(q);
        planes[p].setFromNormalAndCoplanarPoint(n, centre);
        negated[p].copy(planes[p]).negate();
      }
      if (caps.length) {
        inv.copy(holder.matrixWorld).invert();
        for (let p = 0; p < PLANES; p++) {
          // World plane → holder space; the cap's +Z faces AGAINST the normal,
          // i.e. toward the removed half-space, where the viewer sees the cut.
          local.copy(planes[p]).applyMatrix4(inv);
          local.coplanarPoint(caps[p].position);
          caps[p].quaternion.setFromUnitVectors(Z, n.copy(local.normal).negate());
        }
      }
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      for (const m of capMats) m.dispose();
      capGeo.dispose();
      for (const m of stencilMats) m.dispose();
    },
  };
};
