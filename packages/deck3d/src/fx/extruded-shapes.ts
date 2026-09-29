import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";
import { countFor, num, str } from "./util.js";

type T3 = typeof import("three");

/** Built-in parametric outlines (three `webgl_geometry_shapes`); each is a "path as a function". */
function builtin(THREE: T3, name: string, lobes: number): THREE.Shape {
  const s = new THREE.Shape();
  const polar = (r: (a: number) => number, steps = 128) => {
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const rr = r(a);
      if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
  };
  switch (name) {
    case "gear":
      polar((a) => 0.8 + 0.2 * Math.sign(Math.sin(a * lobes)), lobes * 8);
      break;
    case "rose":
      polar((a) => 0.35 + 0.65 * Math.abs(Math.cos((lobes / 2) * a)));
      break;
    case "superformula": {
      const m = lobes;
      const n1 = 0.3;
      polar((a) => (Math.abs(Math.cos((m * a) / 4)) ** 8 + Math.abs(Math.sin((m * a) / 4)) ** 8) ** (-1 / n1) * 0.9);
      break;
    }
    case "heart":
      s.moveTo(0.25, 0.25);
      s.bezierCurveTo(0.25, 0.25, 0.2, 0, 0, 0);
      s.bezierCurveTo(-0.3, 0, -0.3, 0.35, -0.3, 0.35);
      s.bezierCurveTo(-0.3, 0.55, -0.1, 0.77, 0.25, 0.95);
      s.bezierCurveTo(0.6, 0.77, 0.8, 0.55, 0.8, 0.35);
      s.bezierCurveTo(0.8, 0.35, 0.8, 0, 0.5, 0);
      s.bezierCurveTo(0.35, 0, 0.25, 0.25, 0.25, 0.25);
      break;
    case "arrow":
      s.moveTo(-0.9, -0.25);
      s.lineTo(0.2, -0.25);
      s.lineTo(0.2, -0.6);
      s.lineTo(0.9, 0);
      s.lineTo(0.2, 0.6);
      s.lineTo(0.2, 0.25);
      s.lineTo(-0.9, 0.25);
      s.closePath();
      break;
    default: // star
      polar((a) => (Math.round((a / Math.PI) * lobes) % 2 === 0 ? 1 : 0.45), lobes * 2);
  }
  return s;
}

/** Shapes from an SVG `<path d>` string; empty on any parse failure (the caller falls back). */
function fromSvgPath(THREE: T3, d: string): THREE.Shape[] {
  try {
    const parsed = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d.replace(/"/g, "")}"/></svg>`);
    const shapes = parsed.paths.flatMap((p) => SVGLoader.createShapes(p));
    return shapes.filter((sh) => sh.getPoints(8).length > 2);
  } catch {
    return [];
  }
}

/** Fit a set of shapes into a unit box: SVG data arrives in arbitrary pixel units. */
function normalised(THREE: T3, shapes: THREE.Shape[]): { shapes: THREE.Shape[]; scale: number; centre: THREE.Vector2 } {
  const box = new THREE.Box2();
  for (const sh of shapes) for (const p of sh.getPoints(12)) box.expandByPoint(p);
  const size = new THREE.Vector2();
  box.getSize(size);
  const scale = 2 / Math.max(size.x, size.y, 1e-6);
  const centre = new THREE.Vector2();
  box.getCenter(centre);
  return { shapes, scale, centre };
}

/**
 * Extruded outlines drifting in depth (three `webgl_geometry_extrude_shapes`).
 * `shape` picks a built-in parametric path; `svgPath` = an SVG `<path d>`
 * string wins when it parses (paste it from the file — the module is offline).
 */
export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const { THREE, palette, rng } = ctx;
  const count = countFor(ctx, 110, num(params, "density", 1), 4);
  const depth = num(params, "depth", 0.35);
  const spin = num(params, "spin", 1);
  const lobes = Math.max(3, Math.round(num(params, "lobes", 5)));
  const svgPath = str(params, "svgPath", "");

  let shapes = svgPath ? fromSvgPath(THREE, svgPath) : [];
  if (!shapes.length) shapes = [builtin(THREE, str(params, "shape", "star"), lobes)];
  const fit = normalised(THREE, shapes);
  const geo = new THREE.ExtrudeGeometry(fit.shapes, { depth, bevelEnabled: true, bevelThickness: depth * 0.25, bevelSize: 0.05, bevelSegments: 2, curveSegments: 24 });
  geo.translate(-fit.centre.x, -fit.centre.y, 0);
  geo.scale(fit.scale, -fit.scale, 1); // SVG y is down
  geo.computeVertexNormals();

  const mats = [
    new THREE.MeshStandardMaterial({ color: palette.accent, metalness: 0.5, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ color: palette.second, metalness: 0.5, roughness: 0.35 }),
  ];
  const group = new THREE.Group();
  const items: THREE.Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, mats[i % 2]);
    const s = 0.5 + rng() * 1.1;
    m.scale.setScalar(s);
    m.position.set((rng() - 0.5) * 22, (rng() - 0.5) * 9, -(1 + rng() * 9));
    m.userData.phase = rng() * 6.28;
    m.userData.rate = 0.15 + rng() * 0.35;
    m.userData.baseY = m.position.y;
    group.add(m);
    items.push(m);
  }
  const holder = new THREE.Group();
  holder.add(group);
  holder.userData.count = count;
  return {
    object: holder,
    tick: (t) => {
      for (const m of items) {
        m.rotation.set(t * m.userData.rate * spin, t * 0.7 * m.userData.rate * spin + m.userData.phase, 0);
        m.position.y = m.userData.baseY + Math.sin(t * 0.5 + m.userData.phase) * 0.25;
      }
    },
    dispose: () => {
      geo.dispose();
      for (const m of mats) m.dispose();
    },
  };
};
