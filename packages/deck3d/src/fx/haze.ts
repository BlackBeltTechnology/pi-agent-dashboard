/**
 * `haze` — background-coloured, soft-edged translucent planes between the
 * slide and its distant background world, so a bold backdrop recedes behind
 * the content (design D4). Every plane's bottom edge sits at `floor` (default
 * the deck floor, y −2.6) and no vertex goes below it, so the planes never
 * poke through the floor and there is no hard horizontal seam where they meet
 * it: the texture is opaque-soft at the bottom edge, fading upward and
 * sideways.
 */
import type * as THREE_NS from "three";
import type { FxContext, FxFactory, FxHandle, FxParams } from "./types.js";

/** y of the deck floor (`runtime/scene.ts`). */
export const FLOOR_Y = -2.6;

const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

function softTexture(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  // Alpha: soft on the sides and top, strongest toward (but gently into) the bottom edge.
  const horiz = g.createLinearGradient(0, 0, 256, 0);
  horiz.addColorStop(0, "rgba(255,255,255,0)");
  horiz.addColorStop(0.25, "rgba(255,255,255,1)");
  horiz.addColorStop(0.75, "rgba(255,255,255,1)");
  horiz.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = horiz;
  g.fillRect(0, 0, 256, 128);
  g.globalCompositeOperation = "destination-in";
  const vert = g.createLinearGradient(0, 0, 0, 128);
  vert.addColorStop(0, "rgba(0,0,0,0)");
  vert.addColorStop(0.55, "rgba(0,0,0,1)");
  vert.addColorStop(1, "rgba(0,0,0,0.55)");
  g.fillStyle = vert;
  g.fillRect(0, 0, 256, 128);
  return c;
}

export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const THREE = ctx.THREE;
  const layers = Math.max(1, Math.round(num(params.layers, 4)));
  const near = num(params.near, 6);
  const far = num(params.far, 26);
  const density = Math.min(1, Math.max(0, num(params.density, 0.5)));
  const drift = num(params.drift, 0.15);
  const floor = num(params.floor, FLOOR_Y);
  const color = new THREE.Color(typeof params.color === "string" ? params.color : ctx.palette.bg);

  const root = new THREE.Group();
  const tex = new THREE.CanvasTexture(softTexture());
  const geom = new THREE.PlaneGeometry(1, 1);
  // Bottom edge at y = 0 in the plane's local space, so `position.y = floor` pins it there.
  geom.translate(0, 0.5, 0);
  const mats: THREE_NS.MeshBasicMaterial[] = [];
  const planes: THREE_NS.Mesh[] = [];
  for (let i = 0; i < layers; i++) {
    const k = layers === 1 ? 0 : i / (layers - 1);
    const z = -(near + (far - near) * k);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: density * (0.35 + 0.65 * k), depthWrite: false, fog: false });
    mats.push(mat);
    const mesh = new THREE.Mesh(geom, mat);
    const h = 9 + 7 * k;
    const w = 26 + 22 * k;
    mesh.scale.set(w, h, 1);
    mesh.position.set(0, floor, z);
    mesh.renderOrder = 2;
    planes.push(mesh);
    root.add(mesh);
  }

  return {
    object: root,
    tick: (t: number) => {
      planes.forEach((p, i) => {
        p.position.x = Math.sin(t * drift + i * 1.7) * 1.2;
      });
    },
    dispose: () => {
      geom.dispose();
      tex.dispose();
      for (const m of mats) m.dispose();
    },
  };
};
