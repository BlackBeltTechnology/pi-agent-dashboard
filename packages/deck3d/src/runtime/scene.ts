/**
 * Renderer + scene rig (ported from the lab): ONE global floor (mirror + veil)
 * following the camera target, mode-aware bloom/fog/lights, shadow bias that
 * kills the z-buffer acne the lab hit.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { makeNoise3 } from "../fx/util.js";
import { makeRng } from "./rng.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import type { PaletteColors } from "./palette.js";
import { createPostStack, type PostLook, type PostRef, type PostStack } from "./post.js";
import type { QualityProfile } from "./quality.js";
import type { SlideConfig } from "./types.js";

export interface SceneRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: THREE.Group;
  passNames: () => string[];
  /** Enable exactly the listed post cards for the current slide (plus baseline bloom). */
  setPost: (refs: PostRef[], look: PostLook) => void;
  /** Post stack probe for `debug.post()`. */
  postProbe: PostStack["probe"];
  /** World position of the rim light — what `god-rays` streams from. */
  sunPosition: () => THREE.Vector3;
  applyLook: (P: PaletteColors, cfg: SlideConfig, profile: QualityProfile) => void;
  /** Live rim-light colour, for the configurator's debug surface. */
  rimColor: () => THREE.Color;
  /** Which floor surface is showing, for `debug.look()`. */
  floorMode: () => "mirror" | "water" | "none";
  resize: (w: number, h: number) => void;
  /** Draw one frame; `t` is the deck clock for time-dependent post passes. */
  render: (t?: number) => void;
  updateFloor: (target: THREE.Vector3) => void;
}

const veilAlphaCache: Record<number, THREE.CanvasTexture> = {};

function veilAlpha(base: number): THREE.CanvasTexture {
  const cached = veilAlphaCache[base];
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d") as CanvasRenderingContext2D;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  const b = Math.round(base * 255);
  g.addColorStop(0, `rgb(${b},${b},${b})`);
  g.addColorStop(0.12, `rgb(${b},${b},${b})`);
  g.addColorStop(0.3, "#fff");
  g.addColorStop(1, "#fff");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  veilAlphaCache[base] = tex;
  return tex;
}

interface RigParts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  post: PostStack;
  key: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  rimLight: THREE.SpotLight;
  floor: THREE.Group;
  veil: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  mirror: Reflector | null;
  /** Created on first use: most decks never ask for it and it owns a render target. */
  water: Water | null;
  envMap: THREE.Texture;
}

/**
 * Backdrop objects (scene backgrounds + every `local:` effect) live on
 * `BACKDROP_LAYER`; content lives on the default layer. Drawing them as two
 * passes with the depth buffer cleared in between makes a background
 * structurally incapable of occluding a title, card or diagram, however deep
 * its geometry reaches — the failure "geo-fragments plates slice the card".
 */
export const BACKDROP_LAYER = 1;
const CONTENT_LAYER = 0;

/** Put `object` and everything under it on the backdrop layer. */
export function markBackdrop(object: THREE.Object3D): void {
  object.traverse((n) => {
    n.layers.set(BACKDROP_LAYER);
    n.userData.backdrop = true;
  });
}

function renderLayered(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  camera.layers.set(BACKDROP_LAYER);
  renderer.render(scene, camera);
  renderer.clearDepth();

  // The content pass must not wipe the backdrop just drawn. Suppress it with
  // `autoClear` (the single flag) and a null background, NOT the three
  // `autoClearColor/Depth/Stencil` flags: `Reflector` clears its own render
  // target only when `renderer.autoClear === false`, so zeroing the sub-flags
  // instead leaves the mirror target uncleared and the reflection accumulates
  // every past frame. A Color background would also force-clear regardless.
  const autoClear = renderer.autoClear;
  const background = scene.background;
  renderer.autoClear = false;
  scene.background = null;
  camera.layers.set(CONTENT_LAYER);
  renderer.render(scene, camera);
  renderer.autoClear = autoClear;
  scene.background = background;
  camera.layers.enableAll();
}

/**
 * Drop-in for `RenderPass` that renders backdrop and content depth-isolated.
 * Reports as `RenderPass` in `effects().active` so the pass names stay stable.
 */
class BackdropRenderPass extends Pass {
  constructor(
    private readonly rigScene: THREE.Scene,
    private readonly rigCamera: THREE.Camera,
  ) {
    super();
    this.clear = true;
    this.needsSwap = false;
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(this.renderToScreen ? null : read);
    renderer.clear();
    renderLayered(renderer, this.rigScene, this.rigCamera);
  }
}

export function createSceneRig(profile: QualityProfile): SceneRig {
  const r = createParts(profile);
  let lastT = 0;
  let floorNow: "mirror" | "water" | "none" = "mirror";
  const world = new THREE.Group();
  r.scene.add(world);
  const veilOp = (cfg: SlideConfig, q: QualityProfile): number => (cfg.mirrorFloor !== false && q.mirror ? (cfg.mode === "dark" ? 0.55 : 0.35) : 1);

  function applySurface(P: PaletteColors, cfg: SlideConfig, q: QualityProfile): void {
    const mirrored = cfg.mirrorFloor !== false && q.mirror;
    // Repaint on every call, not just the first: the configurator changes the
    // palette after boot, and a first-run-only guard here left the dominant
    // colour on screen frozen at whatever the deck booted with.
    if (r.scene.background instanceof THREE.Color) r.scene.background.set(P.bg);
    else r.scene.background = new THREE.Color(P.bg);
    r.veil.material.color.set(P.bg);
    r.veil.material.alphaMap = mirrored ? veilAlpha(veilOp(cfg, q)) : null;
    r.veil.material.opacity = 1;
    r.veil.material.needsUpdate = true;
    r.scene.environment = cfg.envReflections !== false ? r.envMap : null;
    const wantWater = mirrored && cfg.floor === "water";
    if (wantWater && !r.water) {
      r.water = createWater();
      r.floor.add(r.water);
      markBackdrop(r.water);
    }
    if (r.mirror) {
      r.mirror.visible = mirrored && !wantWater;
      (r.mirror.material as unknown as { uniforms: { color: { value: THREE.Color } } }).uniforms.color.value.set(
        cfg.mode === "dark" ? 0x777777 : 0xbbbbbb,
      );
    }
    if (r.water) {
      r.water.visible = wantWater;
      const u = r.water.material.uniforms;
      // Water reads as the palette's dark ground with the accent as its sun.
      u.waterColor.value.set(P.bg).lerp(new THREE.Color(P.second), cfg.mode === "dark" ? 0.18 : 0.45);
      u.sunColor.value.set(P.accent);
      u.distortionScale.value = 3.2;
      u.size.value = 6;
      // The veil is what fades the floor into the background; over water it
      // reads as fog on the surface, so keep it lighter than over the mirror.
      if (wantWater) r.veil.material.alphaMap = veilAlpha(cfg.mode === "dark" ? 0.75 : 0.55);
    }
    floorNow = !mirrored ? "none" : wantWater ? "water" : "mirror";
  }

  function applyLights(P: PaletteColors, cfg: SlideConfig, q: QualityProfile): void {
    r.rimLight.color.set(P.accent);
    r.rimLight.visible = cfg.rimLight !== false;
    r.rimLight.intensity = cfg.mode === "dark" ? 60 : 20;
    r.key.castShadow = cfg.softShadows !== false && q.mirror;
    r.renderer.shadowMap.enabled = r.key.castShadow;
    r.key.intensity = cfg.mode === "dark" ? 2.2 : 1.1;
    r.fill.intensity = cfg.mode === "dark" ? 0.6 : 0.35;
  }

  // Bloom threshold/strength now live in the post stack's `bloom` slot
  // (`post.ts`), applied with the slide's post list.
  function applyPost(cfg: SlideConfig): void {
    r.renderer.toneMappingExposure = cfg.mode === "dark" ? 1.0 : 0.85;
  }

  function applyLook(P: PaletteColors, cfg: SlideConfig, q: QualityProfile): void {
    applySurface(P, cfg, q);
    applyLights(P, cfg, q);
    applyPost(cfg);
    r.scene.fog = cfg.fog !== false ? new THREE.Fog(r.scene.background as THREE.Color, 14, 36) : null;
  }

  return {
    renderer: r.renderer,
    scene: r.scene,
    camera: r.camera,
    world,
    passNames: () => r.post.passNames(),
    setPost: (refs, look) => r.post.setActive(refs, look),
    postProbe: () => r.post.probe(),
    sunPosition: () => r.rimLight.getWorldPosition(new THREE.Vector3()),
    applyLook,
    rimColor: () => r.rimLight.color,
    floorMode: () => floorNow,
    resize: (w, h) => {
      r.renderer.setSize(w, h);
      r.post.resize(w, h);
      r.camera.aspect = w / h;
      r.camera.updateProjectionMatrix();
    },
    render: (t) => {
      if (t !== undefined) lastT = t;
      if (r.water?.visible) r.water.material.uniforms.time.value = lastT * 0.6;
      r.post.tick(lastT, r.camera);
      // The composer costs a full-screen copy per pass; with nothing enabled
      // the direct layered draw is byte-identical and cheaper.
      if (r.post.any()) r.post.composer.render();
      else renderLayered(r.renderer, r.scene, r.camera);
      if (r.post.ascii()) r.post.drawAscii(r.renderer.domElement);
    },
    updateFloor: (target) => {
      r.floor.position.x = target.x;
      r.floor.position.z = target.z;
    },
  };
}

function createParts(profile: QualityProfile): RigParts {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  // Clip planes are per-material (`clipped-solids`); enabling costs nothing elsewhere.
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = profile.bloom || profile.mirror;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 300);

  const post = createPostStack(renderer, scene, camera, new BackdropRenderPass(scene, camera), renderLayered, profile.bloom);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(6, 10, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 60;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.03;
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 10, bottom: -10 });
  const fill = new THREE.HemisphereLight(0xffffff, 0x222233, 0.6);
  const rimLight = new THREE.SpotLight(0xffffff, 60, 40, 0.6, 0.5, 1.2);
  // A light only lights objects sharing its layer; the backdrop lives on its own.
  for (const l of [key, fill, rimLight]) l.layers.enable(BACKDROP_LAYER);
  scene.add(key, key.target, fill, rimLight, rimLight.target);

  const { floor, veil, mirror } = createFloor(profile);
  // The floor is scenery, not content: on the content layer it would paint over
  // every backdrop pixel below its horizon (the depth buffer is cleared between
  // passes), clipping backgrounds along a hard horizontal line. In the backdrop
  // pass it depth-tests against them normally. Slide content sits above it, so
  // the content pass still draws on top.
  markBackdrop(floor);
  scene.add(floor);

  return { renderer, scene, camera, post, key, fill, rimLight, floor, veil, mirror, water: null, envMap };
}

function createFloor(profile: QualityProfile): { floor: THREE.Group; veil: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>; mirror: Reflector | null } {
  const floor = new THREE.Group();
  floor.position.y = -2.6;
  let mirror: Reflector | null = null;
  if (profile.mirror) {
    mirror = new Reflector(new THREE.PlaneGeometry(400, 400), {
      clipBias: 0.003,
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x777777,
    });
    mirror.rotation.x = -Math.PI / 2;
    floor.add(mirror);
  }
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({
      transparent: true,
      roughness: 1,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = 0.01;
  veil.receiveShadow = true;
  veil.renderOrder = 1;
  floor.add(veil);
  return { floor, veil, mirror };
}

/**
 * Procedural water normal map (three's example loads a JPG; the deck is
 * offline and deterministic). Two octaves of seeded noise, gradients packed as
 * a tangent-space normal.
 */
function waterNormals(): THREE.DataTexture {
  const size = 256;
  const noise = makeNoise3(makeRng(41)); // fixed seed: identical on every build
  const h = (x: number, y: number) => noise(x * 0.05, y * 0.05, 0.7) + 0.5 * noise(x * 0.11, y * 0.11, 3.1);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const n = new THREE.Vector3(-dx * 3, -dy * 3, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = Math.round((n.x * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Three `shaders_ocean` surface in the floor group; `time` is fed from the deck clock in `render(t)`. */
function createWater(): Water {
  const water = new Water(new THREE.PlaneGeometry(400, 400), {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: waterNormals(),
    sunDirection: new THREE.Vector3(0.4, 0.8, 0.45).normalize(),
    sunColor: 0xffffff,
    waterColor: 0x1a2a33,
    distortionScale: 3.2,
    fog: false,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.005;
  return water;
}
