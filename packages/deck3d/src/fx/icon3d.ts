/**
 * `icon3d` — builds an icon as a 3D object at a layout item's rect:
 *  - an `art icon` polyline asset → capsule tubes (radius = stroke width / 2,
 *    rounded at joints and ends), or
 *  - an outline asset (`art trace`) → extruded.
 * Optionally seats it on a glass card with a rim. The ENTRY animation (spin +
 * flash) starts when the runtime reports the slide settled (`setActive(true)`)
 * — never from frame-timing gaps — and plays once per arrival; an idle sway,
 * bob and periodic flash follow. List the item in `slide-layer.skip` so the
 * flat glyph is not drawn as well.
 */
import type * as THREE_NS from "three";
import type { IconOutput } from "../art/icon.js";
import type { Outline } from "../art/trace.js";
import type { Layout } from "../pptx/types.js";
import { extrudePolygon, outlineBounds, segmentMatrix } from "./art-geometry.js";
import { planeMap, poseBasis, projectPoints } from "./slide-space.js";
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const ENTRY_SECONDS = 1.1;
const easeOut = (x: number) => 1 - (1 - x) ** 3;

export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const THREE = ctx.THREE;
  if (!ctx.view) throw new Error("icon3d needs the runtime view (corpus layer effect)");
  const view = ctx.view;
  const layout = ctx.assets.get(String(params.layout ?? "pptx-layout")) as Layout;
  const slide = layout.slides.find((s) => s.id === (typeof params.slide === "string" ? params.slide : ctx.slide.id));
  const item = slide?.items.find((i) => i.id === params.item);
  if (!item) throw new Error(`icon3d: no layout item '${String(params.item)}' on slide '${ctx.slide.id}'`);
  const asset = ctx.assets.get(String(params.asset)) as IconOutput | Outline;
  const color = new THREE.Color(typeof params.color === "string" ? params.color : ctx.palette.accent);
  const rim = new THREE.Color(typeof params.rim === "string" ? params.rim : ctx.palette.second);
  const card = params.card === true;

  const { width, height } = view.viewport();
  const basis = poseBasis(THREE, view);
  const map = planeMap(THREE, basis, view.pose.fov, width, height, layout.size, num(params.depth, 0.6));
  const cx = item.rect.x + item.rect.w / 2;
  const cy = item.rect.y + item.rect.h / 2;
  const centre = map.point(cx, cy);
  const box = Math.min(item.rect.w, item.rect.h) * map.unit;

  const root = new THREE.Group();
  root.position.copy(centre);
  root.quaternion.copy(map.quaternion);
  const spinner = new THREE.Group();
  root.add(spinner);
  const disposables: Array<{ dispose(): void }> = [];

  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.3, emissive: color, emissiveIntensity: 0.05 });
  disposables.push(mat);

  if ("polylines" in asset) {
    const [vx, vy, vw, vh] = asset.viewBox;
    const k = (card ? 0.62 : 0.92) * box / Math.max(vw, vh);
    const segs: Array<[THREE_NS.Vector3, THREE_NS.Vector3, number]> = [];
    const joints: Array<[THREE_NS.Vector3, number]> = [];
    for (const line of asset.polylines) {
      const pts = line.points.map(([x, y]) => new THREE.Vector3((x - vx - vw / 2) * k, -(y - vy - vh / 2) * k, 0));
      const r = Math.max(0.01, (line.width * k) / 2);
      const n = line.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) segs.push([pts[i], pts[(i + 1) % pts.length], r]);
      for (const p of pts) joints.push([p, r]);
    }
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    const ball = new THREE.SphereGeometry(1, 10, 8);
    disposables.push(cyl, ball);
    const tubes = new THREE.InstancedMesh(cyl, mat, Math.max(1, segs.length));
    segs.forEach(([a, b, r], i) => tubes.setMatrixAt(i, segmentMatrix(THREE, a, b, r)));
    tubes.count = segs.length;
    const balls = new THREE.InstancedMesh(ball, mat, Math.max(1, joints.length));
    joints.forEach(([p, r], i) => balls.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(r, r, r))));
    balls.count = joints.length;
    spinner.add(tubes, balls);
  } else {
    const b = outlineBounds(asset);
    const w = Math.max(1, b.maxX - b.minX);
    const h = Math.max(1, b.maxY - b.minY);
    const scale = ((card ? 0.62 : 0.92) * box) / Math.max(w, h);
    for (const poly of asset.polygons) {
      const geom = extrudePolygon(THREE, poly.outer, poly.holes, { depth: box * 0.12, bevel: box * 0.01, scale, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2 });
      if (!geom) continue;
      disposables.push(geom);
      spinner.add(new THREE.Mesh(geom, mat));
    }
  }

  if (card) {
    const cardMat = new THREE.MeshPhysicalMaterial({ color: ctx.palette.card, transparent: true, opacity: 0.6, roughness: 0.15, transmission: 0.35, thickness: 0.2, depthWrite: false });
    const rimMat = new THREE.MeshBasicMaterial({ color: rim, toneMapped: false });
    const half = box / 2;
    const r = box * 0.12;
    const shape = new THREE.Shape();
    shape.moveTo(-half + r, -half);
    shape.lineTo(half - r, -half);
    shape.quadraticCurveTo(half, -half, half, -half + r);
    shape.lineTo(half, half - r);
    shape.quadraticCurveTo(half, half, half - r, half);
    shape.lineTo(-half + r, half);
    shape.quadraticCurveTo(-half, half, -half, half - r);
    shape.lineTo(-half, -half + r);
    shape.quadraticCurveTo(-half, -half, -half + r, -half);
    const slab = new THREE.Mesh(new THREE.ShapeGeometry(shape), cardMat);
    slab.position.z = -box * 0.08;
    const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(shape.getPoints(8)), new THREE.LineBasicMaterial({ color: rim }));
    edge.position.z = -box * 0.075;
    root.add(slab, edge);
    disposables.push(cardMat, rimMat, slab.geometry, edge.geometry, edge.material as THREE_NS.Material);
  }

  // ── animation ───────────────────────────────────────────────────────────────
  let active = false;
  /** Clock time the current arrival's entry began; null until the first tick after arrival. */
  let entryStart: number | null = null;
  let arrivals = 0;
  let progress = 0;
  let last = 0;
  const idleSway = num(params.sway, 0.12);

  function pose(t: number): void {
    last = t;
    if (!active) {
      spinner.rotation.set(0, 0, 0);
      progress = 0;
      return;
    }
    if (entryStart === null) {
      entryStart = t;
      arrivals++;
    }
    const e = Math.min(1, Math.max(0, (t - entryStart) / ENTRY_SECONDS));
    progress = e;
    const spin = (1 - easeOut(e)) * Math.PI * 2;
    const idle = e >= 1 ? Math.sin((t - entryStart) * 0.9) * idleSway : 0;
    spinner.rotation.y = spin + idle;
    spinner.position.y = e >= 1 ? Math.sin((t - entryStart) * 1.3) * box * 0.02 : 0;
    // A flash as the spin lands, then a slow periodic pulse.
    const flash = e < 1 ? Math.sin(Math.PI * e) : Math.max(0, Math.sin((t - entryStart) * 0.7)) ** 8 * 0.5;
    mat.emissiveIntensity = 0.05 + flash * 0.9;
  }

  return {
    object: root,
    setActive: (a: boolean) => {
      if (a === active) return;
      active = a;
      // Arrival: the entry begins on the NEXT tick, with the clock that tick
      // carries (a pose here would use the previous slide's stale time).
      if (a) entryStart = null;
      else pose(last);
    },
    tick: pose,
    // Probe for tests: how many arrivals have started an entry, and its progress.
    debug: () => {
      const { width: vw, height: vh } = view.viewport();
      root.updateWorldMatrix(true, false);
      const half = box / 2;
      const corners = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, y]) => root.localToWorld(new THREE.Vector3(x, y, 0)));
      return { arrivals, progress, active, rect: projectPoints(corners, view.camera, vw, vh) };
    },
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  } as FxHandle;
};
