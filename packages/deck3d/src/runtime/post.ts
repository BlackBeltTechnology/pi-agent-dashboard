/**
 * Post-processing stack (task 17.x / spec deck3d-effects "Post-processing
 * cards drive real composer passes").
 *
 * One slot per `post` corpus card. Passes are created lazily the first time a
 * slide lists the card, then enabled/disabled per slide; their uniforms are
 * refreshed from the card params on every `setActive`. Order is CANONICAL
 * (`POST_ORDER`), never the order of `effects[]`, so two lists with the same
 * members render byte-identically.
 *
 * Determinism rules every slot obeys:
 *  - no pass reads wall-clock time; `film` gets the deck clock through
 *    `render(t)` and `god-rays` projects the rim light with the frame camera;
 *  - nothing here allocates per frame beyond what three's own passes do.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { FilmPass } from "three/examples/jsm/postprocessing/FilmPass.js";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { SAOPass } from "three/examples/jsm/postprocessing/SAOPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { LuminosityShader } from "three/examples/jsm/shaders/LuminosityShader.js";
import { RGBShiftShader } from "three/examples/jsm/shaders/RGBShiftShader.js";
import { SobelOperatorShader } from "three/examples/jsm/shaders/SobelOperatorShader.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";
import type { FxParams } from "../fx/types.js";
import type { PaletteColors } from "./palette.js";

/** Canonical pass order, first to last. `ascii` is a DOM mode, not a pass. */
export const POST_ORDER = [
  "sao",
  "outline",
  "selective-bloom",
  "bloom",
  "depth-of-field",
  "god-rays",
  "film",
  "chromatic-aberration",
  "dot-screen",
  "sobel",
  "pixelate",
  "vignette",
  "smaa",
] as const;
export type PostId = (typeof POST_ORDER)[number] | "ascii";
export const POST_IDS: readonly PostId[] = [...POST_ORDER, "ascii"];

export type PartName = "diagram" | "title" | "props" | "all";

/** What the stack needs from the rig to apply a slide's post list. */
export interface PostLook {
  mode: "dark" | "light";
  palette: PaletteColors;
  /** Root objects of the named part on the current slide (for selective passes). */
  parts: (name: PartName) => THREE.Object3D[];
  /** World position of the light `god-rays` streams from. */
  sun: () => THREE.Vector3;
  /** Camera → current slide distance: the `depth-of-field` auto focus. */
  focusDistance: () => number;
}

export interface PostRef {
  id: string;
  params: FxParams;
}

interface Slot {
  id: PostId;
  /** Composer pass names, in order (one slot may own two passes). */
  names: string[];
  passes: Pass[];
  enabled: boolean;
  params: FxParams;
  apply: (params: FxParams, look: PostLook) => void;
  /** Per-frame hook for passes that depend on the camera or the deck clock. */
  tick?: (t: number, camera: THREE.Camera) => void;
  dispose: () => void;
}

export interface PostStack {
  composer: EffectComposer;
  /** Enable exactly `refs` (plus baseline bloom when the profile asks for it); everything else off. */
  setActive: (refs: PostRef[], look: PostLook) => void;
  /** Pass names as `effects().active` reports them: RenderPass, enabled passes, OutputPass. */
  passNames: () => string[];
  probe: () => Array<{ id: string; enabled: boolean; params: FxParams }>;
  /** True when at least one pass beyond the render pass is on (else the rig may draw directly). */
  any: () => boolean;
  ascii: () => boolean;
  /** Feed the deck clock + camera to time-/view-dependent passes. Call before `composer.render()`. */
  tick: (t: number, camera: THREE.Camera) => void;
  /** Draw the ASCII overlay from the framebuffer just rendered. */
  drawAscii: (canvas: HTMLCanvasElement) => void;
  resize: (w: number, h: number) => void;
}

const num = (p: FxParams, k: string, d: number): number => (typeof p[k] === "number" ? (p[k] as number) : d);
const str = (p: FxParams, k: string, d: string): string => (typeof p[k] === "string" ? (p[k] as string) : d);

// ---------------------------------------------------------------------------
// Custom passes
// ---------------------------------------------------------------------------

/** UV-quantising pixelate. NOT `RenderPixelatedPass`: that one replaces the render pass and would drop the backdrop isolation. */
const PixelateShader = {
  uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(1, 1) }, size: { value: 8 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: [
    "uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float size; varying vec2 vUv;",
    "void main(){",
    "  vec2 cell = size / resolution;",
    "  vec2 uv = (floor(vUv / cell) + 0.5) * cell;",
    "  gl_FragColor = texture2D(tDiffuse, uv);",
    "}",
  ].join("\n"),
};

/** Radial light shafts streaming from a screen-space sun, luminance-masked. One pass; deterministic. */
const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    sun: { value: new THREE.Vector2(0.5, 0.5) },
    intensity: { value: 0.6 },
    decay: { value: 0.96 },
    density: { value: 0.6 },
    threshold: { value: 0.55 },
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: [
    "uniform sampler2D tDiffuse; uniform vec2 sun; uniform float intensity, decay, density, threshold; varying vec2 vUv;",
    "const int SAMPLES = 64;",
    "void main(){",
    "  vec4 base = texture2D(tDiffuse, vUv);",
    "  vec2 d = (vUv - sun) * density / float(SAMPLES);",
    "  vec2 uv = vUv; float w = 1.0; vec3 acc = vec3(0.0);",
    "  for (int i = 0; i < SAMPLES; i++) {",
    "    uv -= d;",
    "    vec3 s = texture2D(tDiffuse, uv).rgb;",
    "    float l = dot(s, vec3(0.2126, 0.7152, 0.0722));",
    "    acc += s * max(0.0, l - threshold) * w;",
    "    w *= decay;",
    "  }",
    "  gl_FragColor = vec4(base.rgb + acc * intensity / float(SAMPLES) * 8.0, base.a);",
    "}",
  ].join("\n"),
};

/** Three's `DotScreenShader` with its output clamped: unclamped, dark pixels go negative and tone-map to white. */
const DotScreenClampedShader = {
  uniforms: { tDiffuse: { value: null }, tSize: { value: new THREE.Vector2(256, 256) }, center: { value: new THREE.Vector2(0.5, 0.5) }, angle: { value: 1.57 }, scale: { value: 1.0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: [
    "uniform vec2 center; uniform float angle; uniform float scale; uniform vec2 tSize; uniform sampler2D tDiffuse; varying vec2 vUv;",
    "float pattern() {",
    "  float s = sin(angle), c = cos(angle);",
    "  vec2 tex = vUv * tSize - center;",
    "  vec2 point = vec2(c * tex.x - s * tex.y, s * tex.x + c * tex.y) * scale;",
    "  return (sin(point.x) * sin(point.y)) * 4.0;",
    "}",
    "void main() {",
    "  vec4 color = texture2D(tDiffuse, vUv);",
    "  float average = (color.r + color.g + color.b) / 3.0;",
    "  gl_FragColor = vec4(clamp(color.rgb * vec3(average * 10.0 - 5.0 + pattern()), 0.0, 1.0), color.a);",
    "}",
  ].join("\n"),
};

const AddShader = {
  uniforms: { tDiffuse: { value: null }, tAdd: { value: null }, strength: { value: 1 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader:
    "uniform sampler2D tDiffuse; uniform sampler2D tAdd; uniform float strength; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv) + strength * texture2D(tAdd, vUv); }",
};

/** `FilmPass` accumulates real elapsed time in `render`; pin it to the deck clock instead. */
class DeterministicFilmPass extends FilmPass {
  time = 0;
  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    (this.uniforms as { time: { value: number } }).time.value = this.time;
    super.render(renderer, write, read, 0, false);
  }
}

/**
 * Selective bloom (the three `unreal_bloom_selective` technique): render the
 * scene with every non-selected material blacked out, bloom that, and add the
 * result onto the frame. `render` is the layered backdrop/content draw the rig
 * uses, so the mask respects the same depth isolation as the main pass.
 */
class SelectiveBloomPass extends Pass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly bloom: UnrealBloomPass;
  private readonly mix: ShaderPass;
  private readonly dark = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private readonly black = new THREE.Color(0x000000);
  selected = new Set<THREE.Object3D>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly draw: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void,
  ) {
    super();
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.5, 0.15);
    this.mix = new ShaderPass(AddShader);
    this.needsSwap = true;
  }

  setSize(w: number, h: number): void {
    this.target.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  set strength(v: number) {
    this.mix.uniforms.strength.value = v;
  }

  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const swapped: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
      if (this.selected.has(o)) return;
      swapped.push([m, m.material]);
      m.material = this.dark;
    });
    const bg = this.scene.background;
    const fog = this.scene.fog;
    this.scene.background = this.black;
    this.scene.fog = null;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    this.draw(renderer, this.scene, this.camera);
    this.scene.background = bg;
    this.scene.fog = fog;
    for (const [m, mat] of swapped) m.material = mat;

    // Bloom composites additively INTO its read buffer, so this leaves
    // `target` = masked scene + its bloom.
    this.bloom.render(renderer, write, this.target, 0, false);

    this.mix.uniforms.tAdd.value = this.target.texture;
    this.mix.renderToScreen = this.renderToScreen;
    this.mix.render(renderer, write, read, 0, false);
  }

  dispose(): void {
    this.target.dispose();
    this.bloom.dispose();
    this.mix.dispose();
    this.dark.dispose();
  }
}

/** Expand part roots to the set of drawable descendants (backdrop excluded). */
function selectionOf(roots: THREE.Object3D[]): Set<THREE.Object3D> {
  const out = new Set<THREE.Object3D>();
  for (const r of roots) {
    r.traverse((o) => {
      if (o.userData.backdrop) return;
      out.add(o);
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stack
// ---------------------------------------------------------------------------

export function createPostStack(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderPass: Pass,
  draw: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void,
  baselineBloom: boolean,
): PostStack {
  // Own target WITH a stencil buffer: three's default composer target has none,
  // which would silently break `clipped-solids` caps whenever a pass is on.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, stencilBuffer: true });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(renderPass);
  const output = new OutputPass();
  composer.addPass(output);

  const size = new THREE.Vector2(1, 1);
  const slots = new Map<PostId, Slot>();
  let asciiOn = false;
  let asciiParams: FxParams = {};
  let asciiEl: HTMLPreElement | null = null;
  let lastLook: PostLook | null = null;

  /** Insert a slot's passes before OutputPass, keeping `POST_ORDER`. */
  function mount(slot: Slot): void {
    const rank = (id: string) => POST_ORDER.indexOf(id as (typeof POST_ORDER)[number]);
    let at = 1;
    for (let i = 1; i < composer.passes.length - 1; i++) {
      const owner = [...slots.values()].find((s) => s.passes.includes(composer.passes[i]));
      if (owner && rank(owner.id) < rank(slot.id)) at = i + 1;
    }
    for (const p of slot.passes) {
      p.setSize(size.x, size.y);
      composer.insertPass(p, at++);
    }
  }

  function shader<T extends Record<string, THREE.IUniform>>(def: { uniforms: T; vertexShader: string; fragmentShader: string }): ShaderPass {
    const p = new ShaderPass({ uniforms: THREE.UniformsUtils.clone(def.uniforms), vertexShader: def.vertexShader, fragmentShader: def.fragmentShader });
    return p;
  }

  const make: Record<Exclude<PostId, "ascii">, () => Slot> = {
    bloom: () => {
      const pass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.5, 0.9);
      return {
        id: "bloom",
        names: ["UnrealBloomPass"],
        passes: [pass],
        enabled: false,
        params: {},
        apply: (p, look) => {
          pass.threshold = look.mode === "dark" ? 0.95 : 1.1;
          pass.strength = (look.mode === "dark" ? 0.35 : 0.12) * num(p, "intensity", 1);
        },
        dispose: () => pass.dispose(),
      };
    },
    "selective-bloom": () => {
      const pass = new SelectiveBloomPass(scene, camera, draw);
      return {
        id: "selective-bloom",
        names: ["SelectiveBloomPass"],
        passes: [pass],
        enabled: false,
        params: {},
        apply: (p, look) => {
          // Additive over the frame: the selected parts' own colour rides along with
          // their bloom, so keep the mix modest or the nodes wash out to white.
          pass.strength = 0.3 * num(p, "intensity", 1);
          pass.selected = selectionOf(look.parts(str(p, "parts", "diagram") as PartName));
        },
        dispose: () => pass.dispose(),
      };
    },
    film: () => {
      const pass = new DeterministicFilmPass(0.5, false);
      return {
        id: "film",
        names: ["FilmPass"],
        passes: [pass],
        enabled: false,
        params: {},
        apply: (p) => {
          (pass.uniforms as { intensity: { value: number } }).intensity.value = num(p, "intensity", 0.5);
        },
        tick: (t) => {
          pass.time = t;
        },
        dispose: () => pass.dispose(),
      };
    },
    vignette: () => {
      const pass = shader(VignetteShader);
      return {
        id: "vignette",
        names: ["VignettePass"],
        passes: [pass],
        enabled: false,
        params: {},
        apply: (p) => {
          pass.uniforms.offset.value = num(p, "offset", 1.0);
          pass.uniforms.darkness.value = num(p, "darkness", 1.0);
        },
        dispose: () => pass.dispose(),
      };
    },
    smaa: () => {
      const pass = new SMAAPass(size.x, size.y);
      return { id: "smaa", names: ["SMAAPass"], passes: [pass], enabled: false, params: {}, apply: () => {}, dispose: () => pass.dispose() };
    },
    sao: () => {
      const pass = new SAOPass(scene, camera, size.clone());
      return {
        id: "sao",
        names: ["SAOPass"],
        passes: [pass],
        enabled: false,
        params: {},
        apply: (p) => {
          pass.params.saoIntensity = 0.06 * num(p, "intensity", 1);
          pass.params.saoScale = 10;
          pass.params.saoKernelRadius = 40 * num(p, "radius", 1);
          pass.params.saoBlur = true;
        },
        dispose: () => pass.dispose(),
      };
    },
    "depth-of-field": () => {
      const pass = new BokehPass(scene, camera, { focus: 12, aperture: 0.00015, maxblur: 0.01 });
      const u = pass.uniforms as unknown as { focus: { value: number }; aperture: { value: number }; maxblur: { value: number } };
      return {
        id: "depth-of-field",
        names: ["BokehPass"],
        passes: [pass],
        enabled: false,
        params: {},
        apply: (p, look) => {
          // 0 = focus on the slide (camera → anchor distance); anything else is a world distance.
          const focus = num(p, "focus", 0);
          u.focus.value = focus > 0 ? focus : look.focusDistance();
          u.aperture.value = 0.0002 * num(p, "aperture", 1);
          u.maxblur.value = 0.012 * num(p, "blur", 1);
        },
        dispose: () => pass.dispose(),
      };
    },
    "god-rays": () => {
      const pass = shader(GodRaysShader);
      const v = new THREE.Vector3();
      return {
        id: "god-rays",
        names: ["GodRaysPass"],
        passes: [pass],
        enabled: false,
        params: {},
        apply: (p) => {
          pass.uniforms.intensity.value = 0.6 * num(p, "intensity", 1);
          pass.uniforms.density.value = num(p, "density", 0.6);
          pass.uniforms.threshold.value = num(p, "threshold", 0.55);
        },
        tick: (_t, cam) => {
          if (!lastLook) return;
          v.copy(lastLook.sun()).project(cam);
          pass.uniforms.sun.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
        },
        dispose: () => pass.dispose(),
      };
    },
    "chromatic-aberration": () => {
      const pass = shader(RGBShiftShader);
      return {
        id: "chromatic-aberration",
        names: ["RGBShiftPass"],
        passes: [pass],
        enabled: false,
        params: {},
        apply: (p) => {
          pass.uniforms.amount.value = num(p, "offset", 0.003);
          pass.uniforms.angle.value = num(p, "angle", 0);
        },
        dispose: () => pass.dispose(),
      };
    },
    "dot-screen": () => {
      const pass = shader(DotScreenClampedShader);
      return {
        id: "dot-screen",
        names: ["DotScreenPass"],
        passes: [pass],
        enabled: false,
        params: {},
        apply: (p) => {
          pass.uniforms.scale.value = num(p, "scale", 1.2);
          pass.uniforms.angle.value = num(p, "angle", 1.57);
          pass.uniforms.tSize.value.copy(size);
        },
        dispose: () => pass.dispose(),
      };
    },
    sobel: () => {
      const lum = shader(LuminosityShader);
      const sobel = shader(SobelOperatorShader);
      return {
        id: "sobel",
        names: ["LuminosityPass", "SobelPass"],
        passes: [lum, sobel],
        enabled: false,
        params: {},
        apply: () => {
          sobel.uniforms.resolution.value.copy(size);
        },
        dispose: () => {
          lum.dispose();
          sobel.dispose();
        },
      };
    },
    pixelate: () => {
      const pass = shader(PixelateShader);
      return {
        id: "pixelate",
        names: ["PixelatePass"],
        passes: [pass],
        enabled: false,
        params: {},
        apply: (p) => {
          pass.uniforms.size.value = Math.max(1, num(p, "size", 6));
          pass.uniforms.resolution.value.copy(size);
        },
        dispose: () => pass.dispose(),
      };
    },
    outline: () => {
      const pass = new OutlinePass(size.clone(), scene, camera, []);
      pass.edgeStrength = 4;
      pass.edgeGlow = 0.4;
      pass.edgeThickness = 1.5;
      return {
        id: "outline",
        names: ["OutlinePass"],
        passes: [pass],
        enabled: false,
        params: {},
        apply: (p, look) => {
          pass.edgeStrength = 4 * num(p, "strength", 1);
          pass.edgeThickness = num(p, "thickness", 1.5);
          pass.visibleEdgeColor.set(look.palette.accent);
          pass.hiddenEdgeColor.set(look.palette.accent).multiplyScalar(0.3);
          pass.selectedObjects = look.parts(str(p, "parts", "diagram") as PartName);
        },
        dispose: () => pass.dispose(),
      };
    },
  };

  function slot(id: Exclude<PostId, "ascii">): Slot {
    let s = slots.get(id);
    if (!s) {
      s = make[id]();
      slots.set(id, s);
      mount(s);
    }
    return s;
  }

  function setEnabled(s: Slot, on: boolean): void {
    s.enabled = on;
    for (const p of s.passes) p.enabled = on;
  }

  function setActive(refs: PostRef[], look: PostLook): void {
    lastLook = look;
    const wanted = new Map<string, FxParams>();
    for (const r of refs) wanted.set(r.id, r.params);
    // Baseline bloom is quality-driven and pre-dates cards; the `bloom` card
    // only adds params on top of it. Everything else is opt-in per slide.
    if (baselineBloom && !wanted.has("bloom")) wanted.set("bloom", {});

    for (const id of POST_ORDER) {
      const params = wanted.get(id);
      const existing = slots.get(id);
      if (!params) {
        if (existing) setEnabled(existing, false);
        continue;
      }
      const s = slot(id);
      s.params = params;
      s.apply(params, look);
      setEnabled(s, true);
    }
    asciiOn = wanted.has("ascii");
    asciiParams = wanted.get("ascii") ?? {};
    if (asciiEl) asciiEl.style.display = asciiOn ? "block" : "none";
    renderer.domElement.style.visibility = asciiOn ? "hidden" : "";
    if (asciiOn && lastLook) {
      const el = ensureAscii();
      el.style.color = lastLook.palette.text;
      el.style.background = lastLook.palette.bg;
      el.style.display = "block";
    }
  }

  function ensureAscii(): HTMLPreElement {
    if (asciiEl) return asciiEl;
    asciiEl = document.createElement("pre");
    asciiEl.className = "deck3d-ascii";
    asciiEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(asciiEl);
    return asciiEl;
  }

  const CHARS = " .:-=+*#%@";
  const asciiCanvas = document.createElement("canvas");
  function drawAscii(canvas: HTMLCanvasElement): void {
    if (!asciiOn) return;
    const el = ensureAscii();
    const cell = Math.max(4, num(asciiParams, "size", 9));
    const invert = asciiParams.invert === true;
    const cols = Math.max(1, Math.floor(canvas.clientWidth / (cell * 0.6)));
    const rows = Math.max(1, Math.floor(canvas.clientHeight / cell));
    asciiCanvas.width = cols;
    asciiCanvas.height = rows;
    const x = asciiCanvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    x.drawImage(canvas, 0, 0, cols, rows);
    const d = x.getImageData(0, 0, cols, rows).data;
    const lines: string[] = [];
    for (let r = 0; r < rows; r++) {
      let line = "";
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 4;
        let l = ((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255) ** 1.5;
        if (invert) l = 1 - l;
        line += CHARS[Math.min(CHARS.length - 1, Math.floor(l * CHARS.length))];
      }
      lines.push(line);
    }
    el.style.fontSize = `${cell}px`;
    el.style.lineHeight = `${cell}px`;
    el.textContent = lines.join("\n");
  }

  return {
    composer,
    setActive,
    passNames: () => {
      const names = ["RenderPass"];
      for (const id of POST_ORDER) {
        const s = slots.get(id);
        if (s?.enabled) names.push(...s.names);
      }
      names.push("OutputPass");
      return names;
    },
    probe: () =>
      POST_IDS.map((id) =>
        id === "ascii"
          ? { id, enabled: asciiOn, params: asciiParams }
          : { id, enabled: slots.get(id)?.enabled ?? false, params: slots.get(id)?.params ?? {} },
      ),
    any: () => [...slots.values()].some((s) => s.enabled),
    ascii: () => asciiOn,
    tick: (t, cam) => {
      for (const s of slots.values()) if (s.enabled) s.tick?.(t, cam);
    },
    drawAscii,
    resize: (w, h) => {
      size.set(w, h);
      composer.setSize(w, h);
      for (const s of slots.values()) if (s.enabled && lastLook) s.apply(s.params, lastLook);
    },
  };
}
