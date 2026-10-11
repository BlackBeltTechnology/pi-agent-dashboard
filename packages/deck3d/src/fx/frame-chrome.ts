/**
 * `frame-chrome` — persistent, camera-pinned image layers (master corner art)
 * that fly out of the frame while the camera moves and back in before it ends
 * (design D4, spec deck3d-slide-layers "Persistent effects and frame-chrome").
 *
 * Created once per deck (outside every slide group), driven every frame by
 * `transition({ from, to, p })`. Each layer carries a settled "hidden" state
 * (1 on a `suppress`ed slide, else 0) at both ends of a move; between them its
 * offset follows lerp(hiddenFrom, hiddenTo, ease(p)) plus a tent dip that
 * leaves and re-enters the frame — so the chrome is never absent at BOTH the
 * start and the end of a move, and each layer rises monotonically then falls.
 */
import type * as THREE_NS from "three";
import type { FxContext, FxFactory, FxHandle, FxParams, FxTransition } from "./types.js";

interface LayerSpec {
  asset: string;
  anchor?: "tl" | "tr" | "bl" | "br";
  /** Layer height as a fraction of viewport height. */
  size?: number;
  /** Fly-out vector, in viewport heights. */
  fly?: [number, number];
  /** 0–0.5: share of the move before this layer starts leaving. */
  delay?: number;
  /** Speed multiplier of the layer's own timeline (>= 1 finishes earlier). */
  speed?: number;
  ease?: "inOut" | "in" | "out" | "linear";
}

const DIST = 1.5;
const EASES = {
  inOut: (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  in: (x: number) => x * x,
  out: (x: number) => 1 - (1 - x) ** 2,
  linear: (x: number) => x,
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const create: FxFactory = (ctx: FxContext, params: FxParams): FxHandle => {
  const THREE = ctx.THREE;
  if (!ctx.view) throw new Error("frame-chrome needs the runtime view (persistent corpus effect)");
  const view = ctx.view;
  const specs = (Array.isArray(params.layers) ? params.layers : []) as LayerSpec[];
  const suppress = new Set(Array.isArray(params.suppress) ? (params.suppress as string[]) : []);
  const ids = view.deckSlideIds ?? [];
  const opacity = Math.min(1, Math.max(0, typeof params.opacity === "number" ? params.opacity : 1));
  const sizeScale = Math.min(3, Math.max(0.2, typeof params.scale === "number" ? params.scale : 1));
  const hiddenAt = (index: number) => (suppress.has(ids[index] ?? "") ? 1 : 0);

  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  root.userData.part = "chrome";
  const planes: Array<{ spec: LayerSpec; mesh: THREE_NS.Mesh; aspect: number; offset: number }> = [];
  for (const spec of specs) {
    const img = ctx.assets.get(spec.asset) as HTMLImageElement;
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = 1000;
    root.add(mesh);
    planes.push({ spec, mesh, aspect: (img.naturalWidth || 1) / (img.naturalHeight || 1), offset: 0 });
  }

  let state: FxTransition = { from: 0, to: 0, p: 1 };

  /**
   * Hidden fraction (0 = at rest in frame, 1 = fully out) for the current
   * state. Both ends visible: an out-and-back bump sin(π·q). Otherwise the
   * layer simply travels between the two settled states (0 ↔ 1).
   */
  function offsetOf(spec: LayerSpec): number {
    const a = hiddenAt(state.from);
    const b = hiddenAt(state.to);
    if (state.from === state.to || state.p >= 1) return b;
    if (state.p <= 0) return a;
    const delay = clamp01(spec.delay ?? 0);
    const speed = Math.max(0.2, spec.speed ?? 1);
    const q = clamp01(((state.p - delay) / Math.max(1e-6, 1 - delay)) * speed);
    const eased = EASES[spec.ease ?? "inOut"](q);
    if (a === 0 && b === 0) return Math.sin(Math.PI * eased);
    return a + (b - a) * eased;
  }

  function place(): void {
    const { width, height } = view.viewport();
    const cam = view.camera as THREE_NS.PerspectiveCamera;
    const visH = 2 * DIST * Math.tan((cam.fov * Math.PI) / 360);
    const visW = visH * (width / height);
    for (const p of planes) {
      const h = (p.spec.size ?? 0.3) * sizeScale * visH;
      const w = h * p.aspect;
      const anchor = p.spec.anchor ?? "tl";
      const left = anchor === "tl" || anchor === "bl";
      const top = anchor === "tl" || anchor === "tr";
      const fly = p.spec.fly ?? [left ? -0.5 : 0.5, top ? 0.5 : -0.5];
      const x = (left ? -visW / 2 + w / 2 : visW / 2 - w / 2) + fly[0] * visH * p.offset;
      const y = (top ? visH / 2 - h / 2 : -visH / 2 + h / 2) + fly[1] * visH * p.offset;
      p.mesh.position.set(x, y, -DIST);
      p.mesh.scale.set(w, h, 1);
    }
  }

  function pin(): void {
    view.camera.updateMatrixWorld();
    root.matrix.copy(view.camera.matrixWorld);
    root.matrixWorldNeedsUpdate = true;
  }

  const apply = (): void => {
    for (const p of planes) p.offset = offsetOf(p.spec);
    place();
    pin();
  };
  apply();

  return {
    object: root,
    transition: (s) => {
      state = s;
      apply();
    },
    tick: () => apply(),
    debug: () => ({ offsets: planes.map((p) => p.offset), from: state.from, to: state.to, p: state.p }),
    dispose: () => {
      for (const p of planes) {
        (p.mesh.material as THREE_NS.MeshBasicMaterial).map?.dispose();
        (p.mesh.material as THREE_NS.Material).dispose();
        p.mesh.geometry.dispose();
      }
    },
  } as FxHandle;
};
