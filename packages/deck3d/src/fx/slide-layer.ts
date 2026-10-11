/**
 * `slide-layer` — draws one slide of an imported `layout.json` as up to four
 * depth layers (body, icon, title, image), each a single camera-facing plane
 * that exactly fills the slide frame from the settled pose (design D4, spec
 * deck3d-slide-layers). Each layer's content is painted into an offscreen
 * canvas at frame resolution, so at rest every item sits on its mapped rect;
 * in flight the layers' different depths give parallax.
 *
 * Text items are registered with `measure()` (kind `layer-text`) through
 * `FxHandle.measure`, so `check`'s rules apply to imported text.
 */
import type * as THREE_NS from "three";
import type { FallbackItem, ImgItem, Layout, LayoutItem, LayoutParagraph, LayoutSlide, RectItem, TextItem } from "../pptx/types.js";
import { type Basis, cameraBasis, fontAssetId, type PlaneMap, planeMap, poseBasis, projectPoints } from "./slide-space.js";
import type { FxContext, FxFactory, FxHandle, FxMeasure, FxParams, FxView } from "./types.js";

type LayerName = "body" | "icon" | "title" | "image";
const LAYERS: LayerName[] = ["body", "icon", "title", "image"];
const DEFAULT_DEPTHS: Record<LayerName, number> = { body: 0, icon: 0.6, title: 0.9, image: 1.2 };
const MAX_CANVAS = 4096;
const CAP_RATIO = 0.7;

/** Axis-aligned bounds of an item's (possibly rotated) rect. */
function boundsOf(item: LayoutItem): { x1: number; y1: number; x2: number; y2: number } {
  const r = item.rect;
  const a = (item.rotation * Math.PI) / 180;
  const w = Math.abs(r.w * Math.cos(a)) + Math.abs(r.h * Math.sin(a));
  const h = Math.abs(r.w * Math.sin(a)) + Math.abs(r.h * Math.cos(a));
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
}

/**
 * Which plane each item is drawn on. By default the kind decides (body, icon,
 * title, image), but the original draw ORDER wins wherever two items overlap:
 * an item is never placed in front of an overlapping item that sits above it
 * in the pptx (a picture under a title must not cover the title). Walking the
 * z-order top-down, each item takes the deepest rank among its default and the
 * ranks of the overlapping items above it. Items on one plane paint in z-order.
 * `order` lists the layer names back to front.
 */
export function assignLayers(items: LayoutItem[], order: LayerName[]): Map<string, LayerName> {
  const rankOf = new Map(order.map((n, i) => [n, i]));
  const rank = items.map((i) => rankOf.get(layerOf(i)) ?? 0);
  const bounds = items.map(boundsOf);
  for (let i = items.length - 1; i >= 0; i--) {
    for (let j = i + 1; j < items.length; j++) {
      const a = bounds[i];
      const b = bounds[j];
      const overlap = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
      if (overlap && rank[i] > rank[j]) rank[i] = rank[j];
    }
  }
  return new Map(items.map((it, i) => [it.id, order[rank[i]]]));
}

function layerOf(item: LayoutItem): LayerName {
  if (item.kind === "text") return item.placeholder === "title" || item.placeholder === "ctrTitle" ? "title" : "body";
  if (item.kind === "img") return item.svg ? "icon" : "image";
  if (item.kind === "fallback") return "image";
  return "body";
}

// ── font availability ────────────────────────────────────────────────────────

const fontCache = new Map<string, boolean>();

/** True when the browser renders `name` itself (width differs from both generic fallbacks). */
function hasFont(name: string): boolean {
  const cached = fontCache.get(name);
  if (cached !== undefined) return cached;
  const c = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  const probe = "mmmmmmmmmmlli WQ@#0123456789";
  const width = (font: string) => {
    c.font = `64px ${font}`;
    return c.measureText(probe).width;
  };
  const quoted = `"${name.replace(/"/g, "")}"`;
  const ok = ["monospace", "serif"].some((g) => width(`${quoted}, ${g}`) !== width(g));
  fontCache.set(name, ok);
  return ok;
}

// ── text layout ──────────────────────────────────────────────────────────────

interface Token {
  text: string;
  font: string;
  color: string;
  size: number;
  underline: boolean;
  width: number;
  space: boolean;
  newline: boolean;
}

interface Line {
  tokens: Token[];
  width: number;
  height: number;
  ascent: number;
  align: LayoutParagraph["align"];
  indent: number;
}

function cssFont(run: { bold: boolean; italic: boolean }, px: number, family: string): string {
  return `${run.italic ? "italic " : ""}${run.bold ? "700" : "400"} ${px}px ${family}, "Poppins", sans-serif`;
}

export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const THREE = ctx.THREE;
  if (!ctx.view) throw new Error("slide-layer needs the runtime view (corpus layer effect)");
  const view: FxView = ctx.view;
  const layoutId = typeof params.layout === "string" ? params.layout : "pptx-layout";
  const layout = ctx.assets.get(layoutId) as Layout;
  const slideId = typeof params.slide === "string" ? params.slide : ctx.slide.id;
  const found = layout.slides?.find((s: LayoutSlide) => s.id === slideId);
  if (!found) throw new Error(`slide-layer: layout '${layoutId}' has no slide '${slideId}'`);
  const slide: LayoutSlide = found;

  const mode = params.mode === "screen" || params.mode === "panel" ? params.mode : "free";
  const depths = { ...DEFAULT_DEPTHS, ...((params.depths as Record<string, number> | undefined) ?? {}) };
  const panel = (params.panel as { tilt?: number; material?: string } | undefined) ?? {};
  const tilt = mode === "panel" ? Number(panel.tilt ?? 0) : 0;
  const halo = Math.min(1, Math.max(0, Number(params.halo ?? 0)));
  const skip = new Set(Array.isArray(params.skip) ? (params.skip as string[]) : []);
  const retext = (params.retext as Record<string, string> | undefined) ?? {};
  const widen = (params.widen as Record<string, number> | undefined) ?? {};
  const drawBackground = params.background !== false;
  const size = layout.size;
  const tier = ctx.quality.shadowMapSize >= 4096 ? 2 : ctx.quality.shadowMapSize >= 2048 ? 1.5 : 1;
  const fallbacks = new Set<string>();

  /** Family to draw `name` with: the font itself, a `font-*` asset, else the deck font. */
  const familyCache = new Map<string, string>();
  const familyFor = (name: string): string => {
    const hit = familyCache.get(name);
    if (hit) return hit;
    let family: string;
    if (name && hasFont(name)) family = `"${name.replace(/"/g, "")}"`;
    else if (ctx.assets.has(fontAssetId(name))) family = `"${String(ctx.assets.get(fontAssetId(name)))}"`;
    else {
      family = '"Poppins"';
      if (name) fallbacks.add(name);
    }
    familyCache.set(name, family);
    return family;
  };

  const items = slide.items.filter((i) => !skip.has(i.id));
  // Planes back to front by their depth (a deck may reorder them with `depths`).
  const order = [...LAYERS].sort((a, b) => depths[a] - depths[b] || LAYERS.indexOf(a) - LAYERS.indexOf(b));
  const planeOf = assignLayers(items, order);
  const textItems = items.filter((i): i is TextItem => i.kind === "text");
  const haloColor = slide.background?.color ?? ctx.palette.bg;

  const root = new THREE.Group();
  root.userData.part = "layers";
  const meshes = new Map<LayerName, THREE_NS.Mesh>();
  const canvases = new Map<LayerName, HTMLCanvasElement>();
  for (const name of LAYERS) {
    if (!items.some((i) => planeOf.get(i.id) === name) && !(name === "body" && drawBackground && slide.background)) continue;
    const canvas = document.createElement("canvas");
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = 3 + order.indexOf(name);
    mesh.userData.layer = name;
    root.add(mesh);
    meshes.set(name, mesh);
    canvases.set(name, canvas);
  }
  let glass: THREE_NS.Mesh | undefined;
  if (mode === "panel") {
    glass = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshPhysicalMaterial({
        color: ctx.palette.card,
        transparent: true,
        opacity: panel.material === "matte" ? 0.92 : 0.55,
        roughness: panel.material === "matte" ? 0.8 : 0.15,
        transmission: panel.material === "matte" ? 0 : 0.4,
        thickness: 0.2,
        depthWrite: false,
      }),
    );
    glass.renderOrder = 2;
    root.add(glass);
  }

  // ── painting ────────────────────────────────────────────────────────────────
  const image = (asset: string | undefined): CanvasImageSource | undefined => {
    if (!asset || !ctx.assets.has(asset)) return undefined;
    return ctx.assets.get(asset) as CanvasImageSource;
  };

  function withTransform(g: CanvasRenderingContext2D, item: LayoutItem, k: number, draw: (w: number, h: number) => void): void {
    const r = item.rect;
    g.save();
    g.translate((r.x + r.w / 2) * k, (r.y + r.h / 2) * k);
    if (item.rotation) g.rotate((item.rotation * Math.PI) / 180);
    g.scale(item.flipH ? -1 : 1, item.flipV ? -1 : 1);
    g.translate((-r.w / 2) * k, (-r.h / 2) * k);
    draw(r.w * k, r.h * k);
    g.restore();
  }

  function paintRect(g: CanvasRenderingContext2D, item: RectItem, k: number): void {
    withTransform(g, item, k, (w, h) => {
      g.beginPath();
      if (item.preset === "ellipse") g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else if (item.preset === "roundRect") g.roundRect(0, 0, w, h, Math.min(w, h) / 6);
      else if (item.preset === "line") {
        g.moveTo(0, 0);
        g.lineTo(w, h);
      } else g.rect(0, 0, w, h);
      if (item.fill && item.alpha > 0 && item.preset !== "line") {
        g.globalAlpha = item.alpha;
        g.fillStyle = item.fill;
        g.fill();
        g.globalAlpha = 1;
      }
      if (item.line) {
        g.strokeStyle = item.line.color;
        g.lineWidth = Math.max(1, item.line.width * k);
        g.stroke();
      }
    });
  }

  function paintImg(g: CanvasRenderingContext2D, item: ImgItem, k: number): void {
    const src = image(item.svgAsset) ?? image(item.asset);
    if (!src) return;
    const sw = (src as HTMLImageElement).naturalWidth || (src as ImageBitmap).width || 1;
    const sh = (src as HTMLImageElement).naturalHeight || (src as ImageBitmap).height || 1;
    // Crop fractions apply to the raster; an SVG alternative draws whole.
    const c = item.svgAsset && src === image(item.svgAsset) ? { l: 0, t: 0, r: 0, b: 0 } : item.crop;
    withTransform(g, item, k, (w, h) => {
      g.drawImage(src, c.l * sw, c.t * sh, sw * (1 - c.l - c.r), sh * (1 - c.t - c.b), 0, 0, w, h);
    });
  }

  function paintFallback(g: CanvasRenderingContext2D, item: FallbackItem, k: number): void {
    const src = image(item.asset);
    if (src) {
      // The crop was taken at the rotated bounding rect: draw it upright there.
      const a = (item.rotation * Math.PI) / 180;
      const w = Math.abs(item.rect.w * Math.cos(a)) + Math.abs(item.rect.h * Math.sin(a));
      const h = Math.abs(item.rect.w * Math.sin(a)) + Math.abs(item.rect.h * Math.cos(a));
      const cx = item.rect.x + item.rect.w / 2;
      const cy = item.rect.y + item.rect.h / 2;
      g.drawImage(src, (cx - w / 2) * k, (cy - h / 2) * k, w * k, h * k);
      return;
    }
    withTransform(g, item, k, (w, h) => {
      g.setLineDash([8, 6]);
      g.strokeStyle = ctx.palette.accent;
      g.lineWidth = 2;
      g.strokeRect(1, 1, w - 2, h - 2);
      g.setLineDash([]);
      g.fillStyle = ctx.palette.text;
      g.font = `400 ${Math.max(10, Math.min(28, h / 6))}px "Poppins", sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(item.construct, w / 2, h / 2);
    });
  }

  function paragraphsOf(item: TextItem): LayoutParagraph[] {
    const replacement = retext[item.id];
    if (replacement === undefined) return item.paragraphs;
    const first = item.paragraphs.find((p) => p.runs.length) ?? item.paragraphs[0];
    const run = first?.runs[0];
    if (!first || !run) return item.paragraphs;
    return [{ ...first, runs: [{ ...run, text: replacement }] }];
  }

  function layoutText(g: CanvasRenderingContext2D, item: TextItem, k: number, boxW: number): Line[] {
    const lines: Line[] = [];
    const paras = paragraphsOf(item);
    let lastSize = 18;
    paras.forEach((p, pi) => {
      const bulletW = p.bullet ? (p.runs[0]?.size ?? lastSize) * 0.9 * k : 0;
      const indent = p.level * 0.5 * (p.runs[0]?.size ?? lastSize) * k + bulletW;
      const tokens: Token[] = [];
      for (const run of p.runs) {
        const px = run.size * k;
        lastSize = run.size;
        const font = cssFont(run, px, familyFor(run.font));
        for (const piece of run.text.split(/(\n|\s+)/)) {
          if (!piece) continue;
          g.font = font;
          tokens.push({
            text: piece,
            font,
            color: run.color,
            size: px,
            underline: run.underline,
            width: piece === "\n" ? 0 : g.measureText(piece).width,
            space: /^\s+$/.test(piece) && piece !== "\n",
            newline: piece === "\n",
          });
        }
      }
      const height = (sz: number) => sz * 1.2 * p.lineSpacing;
      const before = pi === 0 ? 0 : p.spaceBefore * k;
      let cur: Line = { tokens: [], width: 0, height: 0, ascent: 0, align: p.align, indent };
      const push = (): void => {
        while (cur.tokens.length && cur.tokens[cur.tokens.length - 1].space) cur.width -= (cur.tokens.pop() as Token).width;
        const maxSize = Math.max(lastSize * k, ...cur.tokens.map((t) => t.size));
        cur.height = height(maxSize);
        cur.ascent = maxSize * 0.95;
        lines.push(cur);
        cur = { tokens: [], width: 0, height: 0, ascent: 0, align: p.align, indent };
      };
      const firstLine = lines.length;
      for (const t of tokens) {
        if (t.newline) {
          push();
          continue;
        }
        if (cur.tokens.length && !t.space && cur.width + t.width > boxW - indent) push();
        if (!cur.tokens.length && t.space) continue;
        cur.tokens.push(t);
        cur.width += t.width;
      }
      push();
      if (lines[firstLine]) {
        lines[firstLine].height += before;
        lines[firstLine].ascent += before;
        if (p.bullet) (lines[firstLine] as Line & { bullet?: { char: string; token?: Token } }).bullet = { char: p.bullet, token: tokens[0] };
      }
      const last = lines[lines.length - 1];
      if (last) last.height += p.spaceAfter * k;
    });
    return lines;
  }

  function paintText(g: CanvasRenderingContext2D, item: TextItem, k: number): void {
    const r = item.rect;
    const extra = Number(widen[item.id] ?? 0);
    const ins = item.insets;
    // PowerPoint never mirrors text: `flipH` leaves it alone and `flipV` turns it upside
    // down (180°). Vertical text reads along the box's HEIGHT, top-down (`vert`) or
    // bottom-up (`vert270`), so its layout frame has the box's width and height swapped.
    const vertical = item.vertical ? (item.textRotation ?? 90) : 0;
    const turn = vertical + (item.flipV ? 180 : 0);
    const frameW = vertical ? r.h : r.w;
    const frameH = vertical ? r.w : r.h;
    const boxW = Math.max(1, (frameW + extra - ins.l - ins.r) * k);
    const boxH = (frameH - ins.t - ins.b) * k;
    const lines = layoutText(g, item, k, boxW);
    const total = lines.reduce((a, l) => a + l.height, 0);
    const top = item.anchor === "b" ? boxH - total : item.anchor === "ctr" ? (boxH - total) / 2 : 0;
    g.save();
    // Rotate about the SHAPE's centre by the shape rotation plus the text turn, then
    // step to the top-left of the text area in the (possibly swapped) frame.
    g.translate((r.x + r.w / 2) * k, (r.y + r.h / 2) * k);
    const angle = item.rotation + turn;
    if (angle) g.rotate((angle * Math.PI) / 180);
    g.translate((-frameW / 2 + ins.l) * k, (-frameH / 2 + ins.t) * k);
    g.textBaseline = "alphabetic";
    let y = top;
    for (const line of lines) {
      const base = y + line.ascent;
      const free = boxW - line.indent - line.width;
      let x = line.indent + (line.align === "ctr" ? free / 2 : line.align === "r" ? free : 0);
      const bullet = (line as Line & { bullet?: { char: string; token?: Token } }).bullet;
      if (bullet?.token) {
        g.font = bullet.token.font;
        g.fillStyle = bullet.token.color;
        g.fillText(bullet.char, line.indent - bullet.token.size * 0.9, base);
      }
      for (const t of line.tokens) {
        g.font = t.font;
        if (halo > 0 && !t.space) {
          g.save();
          g.shadowColor = haloColor;
          g.shadowBlur = t.size * 0.5;
          g.globalAlpha = halo;
          g.fillStyle = haloColor;
          g.fillText(t.text, x, base);
          g.restore();
        }
        g.fillStyle = t.color;
        g.fillText(t.text, x, base);
        if (t.underline) g.fillRect(x, base + t.size * 0.1, t.width, Math.max(1, t.size * 0.06));
        x += t.width;
      }
      y += line.height;
    }
    g.restore();
  }

  let paintedFor = "";
  function paint(frameH: number): void {
    const key = String(Math.round(frameH));
    if (key === paintedFor) return;
    paintedFor = key;
    const height = Math.min(MAX_CANVAS * (size.h / size.w), Math.max(64, frameH * tier));
    const k = height / size.h;
    for (const [name, canvas] of canvases) {
      canvas.width = Math.round(size.w * k);
      canvas.height = Math.round(size.h * k);
      const g = canvas.getContext("2d") as CanvasRenderingContext2D;
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (name === "body" && drawBackground && slide.background) {
        if (slide.background.color) {
          g.fillStyle = slide.background.color;
          g.fillRect(0, 0, canvas.width, canvas.height);
        }
        const bg = image(slide.background.asset);
        if (bg) g.drawImage(bg, 0, 0, canvas.width, canvas.height);
      }
      for (const item of items) {
        if (planeOf.get(item.id) !== name) continue;
        if (item.kind === "rect") paintRect(g, item, k);
        else if (item.kind === "img") paintImg(g, item, k);
        else if (item.kind === "fallback") paintFallback(g, item, k);
        else paintText(g, item, k);
      }
      const mat = meshes.get(name)?.material as THREE_NS.MeshBasicMaterial;
      if (mat.map) mat.map.needsUpdate = true;
    }
  }

  // ── placement ──────────────────────────────────────────────────────────────
  const maps = new Map<LayerName, PlaneMap>();
  let placedFor = "";
  const basisFor = (): Basis => {
    const settled = poseBasis(THREE, view);
    return mode === "screen" ? cameraBasis(THREE, settled.distance) : settled;
  };

  function place(): void {
    const { width, height } = view.viewport();
    const key = `${width}x${height}`;
    if (key === placedFor) return;
    placedFor = key;
    const basis = basisFor();
    for (const [name, mesh] of meshes) {
      const map = planeMap(THREE, basis, view.pose.fov, width, height, size, depths[name]);
      maps.set(name, map);
      mesh.position.copy(map.centre);
      mesh.quaternion.copy(map.quaternion);
      mesh.scale.set(map.width, map.height, 1);
    }
    if (glass) {
      const map = planeMap(THREE, basis, view.pose.fov, width, height, size, depths.body - 0.05);
      glass.position.copy(map.centre);
      glass.quaternion.copy(map.quaternion);
      glass.scale.set(map.width * 1.04, map.height * 1.06, 1);
    }
    if (tilt) {
      // Tilt the whole panel about its horizontal axis through the body plane.
      const pivot = planeMap(THREE, basis, view.pose.fov, width, height, size, depths.body).centre;
      const q = new THREE.Quaternion().setFromAxisAngle(basis.right, tilt);
      for (const o of root.children) {
        o.position.sub(pivot).applyQuaternion(q).add(pivot);
        o.quaternion.premultiply(q);
      }
    }
    const frameH = Math.min(height, width * (size.h / size.w));
    paint(frameH);
  }

  const parentInverse = new THREE.Matrix4();
  /** Camera-pinned mode: re-derive the root from the live camera each frame. */
  function pin(): void {
    if (mode !== "screen" || !root.parent) return;
    root.matrixAutoUpdate = false;
    view.camera.updateMatrixWorld();
    root.parent.updateMatrixWorld();
    parentInverse.copy(root.parent.matrixWorld).invert();
    root.matrix.copy(parentInverse).multiply(view.camera.matrixWorld);
    root.matrixWorldNeedsUpdate = true;
  }

  place();

  // ── measurement ────────────────────────────────────────────────────────────
  function corners(item: LayoutItem, extraW = 0): Array<[number, number]> {
    const r = item.rect;
    const w = r.w + extraW;
    const cx = r.x + w / 2;
    const cy = r.y + r.h / 2;
    const a = (item.rotation * Math.PI) / 180;
    return [
      [-w / 2, -r.h / 2],
      [w / 2, -r.h / 2],
      [w / 2, r.h / 2],
      [-w / 2, r.h / 2],
    ].map(([x, y]) => [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]);
  }

  function projected(item: LayoutItem, camera: THREE_NS.Camera, width: number, height: number, extraW = 0) {
    const mesh = meshes.get(planeOf.get(item.id) as LayerName);
    if (!mesh) return undefined;
    mesh.updateWorldMatrix(true, false);
    const pts = corners(item, extraW).map(([sx, sy]) => new THREE.Vector3(sx / size.w - 0.5, 0.5 - sy / size.h, 0).applyMatrix4(mesh.matrixWorld));
    return projectPoints(pts, camera, width, height);
  }

  function measure(camera: unknown, width: number, height: number): FxMeasure[] {
    place();
    pin();
    const cam = camera as THREE_NS.Camera;
    const out: FxMeasure[] = [];
    for (const item of textItems) {
      const extra = Number(widen[item.id] ?? 0);
      const rect = projected(item, cam, width, height, extra);
      if (!rect) continue;
      const paras = paragraphsOf(item);
      const text = paras.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
      const run = paras.find((p) => p.runs.length)?.runs[0];
      const k = rect.h / Math.max(1e-6, item.rect.h);
      out.push({ id: item.id, text, rect, capHeight: (run?.size ?? 0) * CAP_RATIO * k, ...(run ? { color: run.color } : {}) });
    }
    return out;
  }

  return {
    object: root,
    tick: () => {
      place();
      pin();
    },
    measure,
    fontFallbacks: () => [...fallbacks],
    // Probe for tests: every drawn item's projected rect at the current camera.
    debug: () => {
      const { width, height } = view.viewport();
      return {
        mode,
        frame: maps.get("body") ? { width: maps.get("body")?.width, height: maps.get("body")?.height } : null,
        items: items.map((i) => ({ id: i.id, kind: i.kind, layer: planeOf.get(i.id), rect: projected(i, view.camera, width, height, Number(widen[i.id] ?? 0)) })),
      };
    },
    dispose: () => {
      for (const mesh of meshes.values()) {
        mesh.geometry.dispose();
        const mat = mesh.material as THREE_NS.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
      glass?.geometry.dispose();
      (glass?.material as THREE_NS.Material | undefined)?.dispose();
    },
  } as FxHandle;
};
