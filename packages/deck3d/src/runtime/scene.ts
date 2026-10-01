/**
 * Renderer + scene rig (ported from the lab): ONE global floor (mirror + veil)
 * following the camera target, mode-aware bloom/fog/lights, shadow bias that
 * kills the z-buffer acne the lab hit.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { Water } from "three/examples/jsm/objects/Water.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { makeNoise3 } from "../fx/util.js";
import type { PaletteColors } from "./palette.js";
import { createPostStack, type PostLook, type PostRef, type PostStack } from "./post.js";
import type { QualityProfile } from "./quality.js";
import { makeRng } from "./rng.js";
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
  /** Live key-light target and rim-spot position, for `debug.look()`. */
  lightRig: () => { keyTarget: [number, number, number]; rimPos: [number, number, number] };
  /** Key-light shadow frustum as the renderer sees it, for `debug.shadows()`. */
  shadowCamera: () => { left: number; right: number; top: number; bottom: number; near: number; far: number; pos: [number, number, number]; castShadow: boolean };
  /** Whether backdrop geometry is in the reflection, for `debug.look()`. */
  reflectsBackdrop: () => boolean;
  /** Live floor roughness (0 = mirror), read off the shader, for `debug.look()`. */
  floorMatte: () => number;
  /** Live reflection strength (1 = full mirror), read off the shader, for `debug.look()`. */
  floorReflectivity: () => number;
  resize: (w: number, h: number) => void;
  /** Draw one frame; `t` is the deck clock for time-dependent post passes. */
  render: (t?: number) => void;
  /**
   * Park the scenery that is ONE global instance shared by every slide / the
   * floor and the lights / over the slide now in frame.
   */
  followTarget: (target: THREE.Vector3) => void;
}

/**
 * Per-slide mirror state.
 *
 * `Reflector` reflects with its OWN camera (`virtualCamera = this.camera`),
 * created as a bare `PerspectiveCamera` — so its mask is the content layer
 * only, and every backdrop-layer object (scene backgrounds, local fx) is
 * absent from the reflection. The lab reflected them because it had no layers
 * at all. Set per slide rather than at construction, so the configurator
 * toggles it live.
 */
/**
 * Matte reflection.
 *
 * `Reflector` ships a one-tap mirror: `texture2DProj(tDiffuse, vUv)`. A real
 * floor scatters the reflected ray, so `matte` (a) jitters the sample with the
 * same seeded noise the water surface uses — a deterministic build cannot
 * call `Math.random` in a shader anyway — (b) spreads five taps along the
 * reflection, widening with distance from the reflector so the far floor
 * smears more than the near one, and (c) fades what is left toward the floor
 * colour. Five taps, not a separable blur: the reflection is already a
 * half-resolution target and this runs per floor pixel per frame.
 */
const MATTE_REFLECTOR_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform sampler2D tDiffuse;
  uniform sampler2D tNoise;
  uniform float matte;
  uniform float reflectivity;
  uniform vec3 floorColor;
  uniform vec3 fadeColor;
  uniform float fadeStart;
  uniform float fadeEnd;
  varying vec4 vUv;
  varying float vFloorDist;

  #include <logdepthbuf_pars_fragment>

  float blendOverlay( float base, float blend ) {
    return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );
  }

  vec3 blendOverlay( vec3 base, vec3 blend ) {
    return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );
  }

  void main() {
    #include <logdepthbuf_fragment>

    vec2 uv = vUv.xy / vUv.w;
    vec3 reflected;

    if ( matte <= 0.001 ) {
      reflected = texture2D( tDiffuse, uv ).rgb;
    } else {
      vec2 jitter = ( texture2D( tNoise, uv * 7.0 ).xy - 0.5 ) * matte * 0.05;
      float spread = matte * 0.012;
      vec3 acc = vec3( 0.0 );
      for ( int i = 0; i < 5; i ++ ) {
        float f = float( i ) - 2.0;
        vec2 offset = jitter + vec2( f * spread, f * spread * 0.45 );
        acc += texture2D( tDiffuse, uv + offset ).rgb;
      }
      reflected = acc / 5.0;
    }

    // Fade toward the floor's own colour, not toward black: at low
    // reflectivity a light-mode floor has to stay light.
    vec3 tinted = mix( floorColor, blendOverlay( reflected, color ), clamp( reflectivity, 0.0, 1.0 ) );
    tinted = mix( tinted, fadeColor, smoothstep( fadeStart, fadeEnd, vFloorDist ) );
    gl_FragColor = vec4( tinted, 1.0 );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

interface MirrorUniforms {
  color: { value: THREE.Color };
  tNoise: { value: THREE.Texture };
  matte: { value: number };
  reflectivity: { value: number };
  floorColor: { value: THREE.Color };
}

function mirrorUniforms(mirror: Reflector): MirrorUniforms {
  return (mirror.material as THREE.ShaderMaterial).uniforms as unknown as MirrorUniforms;
}

function applyMirror(mirror: Reflector, P: PaletteColors, cfg: SlideConfig, visible: boolean): void {
  mirror.visible = visible;
  if (cfg.reflectBackdrop !== false) mirror.camera.layers.enable(BACKDROP_LAYER);
  else mirror.camera.layers.disable(BACKDROP_LAYER);
  const u = mirrorUniforms(mirror);
  u.color.value.set(cfg.mode === "dark" ? 0x777777 : 0xbbbbbb);
  u.matte.value = Math.min(Math.max(cfg.floorMatte ?? 0, 0), 1);
  u.reflectivity.value = Math.min(Math.max(cfg.floorReflectivity ?? 1, 0), 1);
  u.floorColor.value.set(P.bg);
}

/**
 * Distance fade that hides the floor's far edge WITHOUT depending on fog.
 *
 * The floor is one 400x400 plane; `Reflector` ignores fog outright and the
 * veil is a LIT material (it receives the slide's shadows), so its "opaque
 * background colour" is brighter than the unlit background. With `fog: false`
 * those two greys met at the plane's horizon as a hard seam. Both surfaces now
 * blend to the background between `start` and `end` view-space units, which
 * the fog switch cannot turn off. Shared by the mirror shader and the veil so
 * they fade in lockstep.
 */
const floorFade = {
  fadeColor: { value: new THREE.Color(0x000000) },
  fadeStart: { value: 26 },
  fadeEnd: { value: 85 },
};

/** Key-light offset from the slide it lights (lab value, as a world position). */
const KEY_OFFSET = new THREE.Vector3(6, 10, 8);
/** Rim spot offset from the slide it lights (lab value). */
const RIM_OFFSET = new THREE.Vector3(-6, 3, -4);

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
  // Ramp reaches opaque background at r ~ 170 of the 200-unit plane, not 60.
  // A tight ramp ended the reflection long before the horizon, so the floor
  // between them was flat background: a black bar under a bright backdrop.
  g.addColorStop(0.35, `rgb(${b},${b},${b})`);
  g.addColorStop(0.85, "#fff");
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

/** Draw order of the floor veil (see `createFloor`). */
export const VEIL_RENDER_ORDER = 1;

/**
 * Make an effect's transparent geometry sort ABOVE the floor veil.
 *
 * Effects that blend (points, lines, translucent plates) set
 * `depthWrite: false` so overlapping pieces mix instead of depth-fighting.
 * Nothing then writes depth where they cover the distance, so the veil — drawn
 * later, opaque background colour past its ramp — passes its own depth test
 * against the FLOOR BEHIND them and overpaints them, punching a background
 * band across the frame at the horizon (slide 15 was the loud case, slide 5
 * the quiet one). The depth TEST is untouched, so the floor still hides
 * geometry that dips below it.
 *
 * Applied centrally rather than per effect so `local:` modules and effects
 * added later inherit it.
 */
export function sortAboveVeil(object: THREE.Object3D): void {
  object.traverse((n) => {
    const material = (n as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    const skipsDepth = Array.isArray(material) ? material.some((m) => m.depthWrite === false) : material.depthWrite === false;
    if (skipsDepth && n.renderOrder <= VEIL_RENDER_ORDER) n.renderOrder = VEIL_RENDER_ORDER + 1;
  });
}

/** The shadow map is primed once, on the first frame (see `renderLayered`). */
let shadowsPrimed = false;

/** Reset for a fresh rig; a second deck in the same page starts cold again. */
export function resetShadowPriming(): void {
  shadowsPrimed = false;
}

function renderLayered(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  // Shadow casters are slide content (content layer); the floor that receives
  // them is backdrop. three filters casters by the VIEW camera's layers
  // (`WebGLShadowMap.renderObject`), so the backdrop pass cannot see a single
  // caster / letting three refresh the map there wrote an EMPTY map over it,
  // and the floor — drawn in that very pass — received nothing. Refresh only
  // in the content pass, where the casters are visible; the backdrop pass
  // reads the map the content pass left behind.
  renderer.shadowMap.autoUpdate = false;
  if (!shadowsPrimed) {
    // Cold start: nothing has filled the map yet, so the first floor would be
    // unlit-by-shadow. Fill it from a content-layer draw first; the backdrop
    // pass below clears the frame anyway, so nothing of it reaches the screen.
    camera.layers.set(CONTENT_LAYER);
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    shadowsPrimed = true;
  }

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
  // The casters are visible to THIS camera: refresh the map here, for the
  // content-on-content shadows in this pass and the floor in the next frame.
  renderer.shadowMap.needsUpdate = true;
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
  resetShadowPriming();
  const r = createParts(profile);
  let lastT = 0;
  let floorNow: "mirror" | "water" | "none" = "mirror";
  let backdropReflected = true;
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
    // The fade target is the background the floor has to disappear into.
    floorFade.fadeColor.value.set(P.bg);
    r.scene.environment = cfg.envReflections !== false ? r.envMap : null;
    const wantWater = mirrored && cfg.floor === "water";
    if (wantWater && !r.water) {
      r.water = createWater();
      r.floor.add(r.water);
      markBackdrop(r.water);
    }
    if (r.mirror) applyMirror(r.mirror, P, cfg, mirrored && !wantWater);
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
    backdropReflected = cfg.reflectBackdrop !== false;
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
    reflectsBackdrop: () => backdropReflected,
    // Read from the uniform, not from the config that was meant to set it: a
    // knob that stages a value without reaching the frame must still fail.
    floorMatte: () => (r.mirror ? mirrorUniforms(r.mirror).matte.value : 0),
    floorReflectivity: () => (r.mirror ? mirrorUniforms(r.mirror).reflectivity.value : 0),
    lightRig: () => ({
      keyTarget: r.key.target.position.toArray() as [number, number, number],
      rimPos: r.rimLight.position.toArray() as [number, number, number],
    }),
    shadowCamera: () => {
      const c = r.key.shadow.camera;
      return {
        left: c.left,
        right: c.right,
        top: c.top,
        bottom: c.bottom,
        near: c.near,
        far: c.far,
        pos: r.key.position.toArray() as [number, number, number],
        castShadow: r.key.castShadow,
      };
    },
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
    followTarget: (target) => {
      r.floor.position.x = target.x;
      r.floor.position.z = target.z;
      // The lights are global too, and the rail puts slide i at x = i*40. A
      // DirectionalLight's shadow frustum is ortho ±14 / ±10 AROUND ITS
      // TARGET, so leaving the target at the origin left every slide but the
      // first outside it, casting nothing; the rim spot (distance 40) never
      // reached them either. Same follow the lab did, one line after the floor.
      // The light POSITION travels too, which the lab did not do: it only
      // moved the target, so on a far slide the key swung to a grazing angle
      // and the slide sat past `shadow.camera.far` (74 > 60) / the frustum
      // clipped it and nothing cast. Moving both keeps the light direction and
      // the shadow depth range identical on every slide.
      r.key.position.copy(target).add(KEY_OFFSET);
      r.key.target.position.copy(target);
      r.key.target.updateMatrixWorld();
      r.rimLight.position.copy(target).add(RIM_OFFSET);
      r.rimLight.target.position.copy(target);
      r.rimLight.target.updateMatrixWorld();
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
  // `LightShadow.updateMatrices` re-derives the frustum from the EXISTING
  // projection matrix and never rebuilds it, so ortho bounds written after
  // construction do nothing until this call / the shadow camera kept three's
  // default ±5 box and clipped most of the slide out of the map.
  key.shadow.camera.updateProjectionMatrix();
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
    const material = mirror.material as THREE.ShaderMaterial;
    material.uniforms.tNoise = { value: noiseTexture() };
    material.uniforms.matte = { value: 0 };
    material.uniforms.reflectivity = { value: 1 };
    material.uniforms.floorColor = { value: new THREE.Color(0x000000) };
    material.uniforms.fadeColor = floorFade.fadeColor;
    material.uniforms.fadeStart = floorFade.fadeStart;
    material.uniforms.fadeEnd = floorFade.fadeEnd;
    material.fragmentShader = MATTE_REFLECTOR_FRAGMENT;
    // The stock reflector vertex shader carries no view-space depth; the fade
    // needs one, so pass it through as a varying.
    material.vertexShader = material.vertexShader
      .replace("varying vec4 vUv;", "varying vec4 vUv;\n  varying float vFloorDist;")
      .replace("gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );", "vec4 mvPos = modelViewMatrix * vec4( position, 1.0 );\n  vFloorDist = -mvPos.z;\n  gl_Position = projectionMatrix * mvPos;");
    material.needsUpdate = true;
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
  // Same fade on the veil. It is a lit standard material, so this rides on top
  // of the finished lit colour (after `dithering_fragment`) rather than
  // replacing it — shadows on the near floor stay intact.
  veil.material.onBeforeCompile = (shader) => {
    shader.uniforms.fadeColor = floorFade.fadeColor;
    shader.uniforms.fadeStart = floorFade.fadeStart;
    shader.uniforms.fadeEnd = floorFade.fadeEnd;
    shader.vertexShader = `varying float vFloorDist;\n${shader.vertexShader}`.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\n  vFloorDist = -mvPosition.z;",
    );
    shader.fragmentShader = `uniform vec3 fadeColor;\nuniform float fadeStart;\nuniform float fadeEnd;\nvarying float vFloorDist;\n${shader.fragmentShader}`.replace(
      "#include <dithering_fragment>",
      "#include <dithering_fragment>\n  gl_FragColor.rgb = mix( gl_FragColor.rgb, fadeColor, smoothstep( fadeStart, fadeEnd, vFloorDist ) );",
    );
  };
  // Fog (14-36) flattened the far floor far sooner than the 26-85 distance
  // fade above, which re-created the same bar. The fade owns the blend now.
  veil.material.fog = false;
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = 0.01;
  veil.receiveShadow = true;
  veil.renderOrder = VEIL_RENDER_ORDER;
  floor.add(veil);
  return { floor, veil, mirror };
}

/**
 * Procedural water normal map (three's example loads a JPG; the deck is
 * offline and deterministic). Two octaves of seeded noise, gradients packed as
 * a tangent-space normal.
 */
let noiseTex: THREE.DataTexture | null = null;

/** The seeded noise texture, shared by the matte mirror and the water surface. */
function noiseTexture(): THREE.DataTexture {
  noiseTex ??= waterNormals();
  return noiseTex;
}

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
    waterNormals: noiseTexture(),
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
