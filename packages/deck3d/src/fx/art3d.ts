/**
 * `art3d` — extrudes an outline asset (polygons with holes, as written by
 * `art trace`) into the slide. Holes render open; vertex normals are always
 * unit length (art-geometry.ts). Optional vertical gradient, sway and a sweep
 * highlight. Placement is either free (`x y z scale`, scene units) or taken
 * from a layout item so the extrusion sits exactly on the flat art's rect.
 */
import type * as THREE_NS from "three";
import type { Outline } from "../art/trace.js";
import type { Layout, LayoutItem } from "../pptx/types.js";
import { extrudePolygon, outlineBounds } from "./art-geometry.js";
import { planeMap, poseBasis } from "./slide-space.js";
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const THREE = ctx.THREE;
  const outline = ctx.assets.get(String(params.outline)) as Outline;
  if (!outline?.polygons) throw new Error(`art3d: asset '${String(params.outline)}' is not an outline`);
  const depth = num(params.depth, 0.25);
  const bevel = num(params.bevel, 0.03);
  const sway = num(params.sway, 0);
  const speed = num(params.speed, 0.6);
  const sweep = params.sweep === true;
  const gradient = Array.isArray(params.gradient) ? (params.gradient as string[]) : undefined;
  const colors = (params.colors as Record<string, string> | undefined) ?? {};
  const b = outlineBounds(outline);
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;

  // Placement: a layout item's rect (projected like slide-layer) or free x/y/z/scale.
  let scale = num(params.scale, 4) / Math.max(w, h);
  let position = new THREE.Vector3(num(params.x, 0), num(params.y, 0), num(params.z, 0.4));
  const item = typeof params.item === "string" ? findItem(ctx, params) : undefined;
  if (item && ctx.view) {
    const layout = ctx.assets.get(String(params.layout ?? "pptx-layout")) as Layout;
    const basis = poseBasis(THREE, ctx.view);
    const { width, height } = ctx.view.viewport();
    const map = planeMap(THREE, basis, ctx.view.pose.fov, width, height, layout.size, num(params.depthOffset, 0.4));
    scale = (Math.min(item.rect.w / w, item.rect.h / h) * map.unit) || scale;
    position = map.point(item.rect.x + item.rect.w / 2, item.rect.y + item.rect.h / 2);
  }

  const root = new THREE.Group();
  root.position.copy(position);
  const mats: THREE_NS.Material[] = [];
  const geoms: THREE_NS.BufferGeometry[] = [];
  const sweepUniform = { value: 0 };
  const topY = (h / 2) * scale;
  for (const poly of outline.polygons) {
    const geom = extrudePolygon(THREE, poly.outer, poly.holes, { depth, bevel, scale, cx, cy });
    if (!geom) continue;
    const base = new THREE.Color(colors[poly.color] ?? poly.color);
    if (gradient && gradient.length >= 2) {
      const top = new THREE.Color(gradient[0]);
      const bottom = new THREE.Color(gradient[1]);
      const pos = geom.getAttribute("position");
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const k = Math.min(1, Math.max(0, (topY - pos.getY(i)) / (2 * topY || 1)));
        const c = top.clone().lerp(bottom, k);
        col.set([c.r, c.g, c.b], i * 3);
      }
      geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    const mat = new THREE.MeshStandardMaterial({
      color: gradient ? 0xffffff : base,
      vertexColors: !!gradient,
      metalness: num(params.metalness, 0.25),
      roughness: num(params.roughness, 0.4),
      envMapIntensity: 0.8,
    });
    if (sweep) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uSweep = sweepUniform;
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform float uSweep;\nvarying vec3 vSweepPos;")
          .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0) * smoothstep(0.12, 0.0, abs(vSweepPos.x - uSweep)) * 0.6;");
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vSweepPos;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSweepPos = position;");
      };
    }
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = false;
    root.add(mesh);
    mats.push(mat);
    geoms.push(geom);
  }

  // Probe for tests: screen-space centre of every hole (CSS px), at the current camera.
  const holeCentres = outline.polygons.flatMap((poly) =>
    poly.holes.map((h) => {
      const xs = h.map((p) => p[0]);
      const ys = h.map((p) => p[1]);
      return new THREE.Vector3(((Math.min(...xs) + Math.max(...xs)) / 2 - cx) * scale, -((Math.min(...ys) + Math.max(...ys)) / 2 - cy) * scale, 0);
    }),
  );
  return {
    object: root,
    debug: () => {
      const view = ctx.view;
      if (!view) return null;
      const { width, height } = view.viewport();
      root.updateWorldMatrix(true, true);
      return {
        holes: holeCentres.map((c) => {
          const v = root.localToWorld(c.clone()).project(view.camera);
          return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
        }),
      };
    },
    tick: (t: number) => {
      if (sway) root.rotation.y = Math.sin(t * speed) * sway;
      if (sweep) sweepUniform.value = ((t * speed * 0.5) % 2) * (w * scale) - w * scale;
    },
    dispose: () => {
      for (const g of geoms) g.dispose();
      for (const m of mats) m.dispose();
    },
  } as FxHandle;
};

function findItem(ctx: FxContext, params: FxParams): LayoutItem | undefined {
  const layout = ctx.assets.get(String(params.layout ?? "pptx-layout")) as Layout;
  const slide = layout.slides.find((s) => s.id === (typeof params.slide === "string" ? params.slide : ctx.slide.id));
  return slide?.items.find((i) => i.id === params.item);
}
