/**
 * Renderer + scene rig (ported from the lab): ONE global floor (mirror + veil)
 * following the camera target, mode-aware bloom/fog/lights, shadow bias that
 * kills the z-buffer acne the lab hit.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { PaletteColors } from "./palette.js";
import type { QualityProfile } from "./quality.js";
import type { SlideConfig } from "./types.js";

export interface SceneRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  world: THREE.Group;
  composer: EffectComposer;
  bloom: UnrealBloomPass | null;
  passNames: () => string[];
  applyLook: (P: PaletteColors, cfg: SlideConfig, profile: QualityProfile) => void;
  resize: (w: number, h: number) => void;
  render: () => void;
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
  composer: EffectComposer;
  bloom: UnrealBloomPass | null;
  key: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  rimLight: THREE.SpotLight;
  floor: THREE.Group;
  veil: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  mirror: Reflector | null;
  envMap: THREE.Texture;
}

export function createSceneRig(profile: QualityProfile): SceneRig {
  const r = createParts(profile);
  const world = new THREE.Group();
  r.scene.add(world);
  const veilOp = (cfg: SlideConfig, q: QualityProfile): number => (cfg.mirrorFloor !== false && q.mirror ? (cfg.mode === "dark" ? 0.55 : 0.35) : 1);

  function applySurface(P: PaletteColors, cfg: SlideConfig, q: QualityProfile): void {
    const mirrored = cfg.mirrorFloor !== false && q.mirror;
    if (!r.scene.background) {
      r.scene.background = new THREE.Color(P.bg);
      r.veil.material.color.set(P.bg);
    }
    r.veil.material.alphaMap = mirrored ? veilAlpha(veilOp(cfg, q)) : null;
    r.veil.material.opacity = 1;
    r.veil.material.needsUpdate = true;
    r.scene.environment = cfg.envReflections !== false ? r.envMap : null;
    if (r.mirror) {
      r.mirror.visible = mirrored;
      (r.mirror.material as unknown as { uniforms: { color: { value: THREE.Color } } }).uniforms.color.value.set(
        cfg.mode === "dark" ? 0x777777 : 0xbbbbbb,
      );
    }
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

  function applyPost(cfg: SlideConfig): void {
    if (r.bloom) {
      r.bloom.threshold = cfg.mode === "dark" ? 0.95 : 1.1;
      r.bloom.strength = cfg.mode === "dark" ? 0.35 : 0.12;
    }
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
    composer: r.composer,
    bloom: r.bloom,
    passNames: () => {
      const names = ["RenderPass"];
      if (r.bloom) names.push("UnrealBloomPass");
      names.push("OutputPass");
      return names;
    },
    applyLook,
    resize: (w, h) => {
      r.renderer.setSize(w, h);
      r.composer.setSize(w, h);
      r.camera.aspect = w / h;
      r.camera.updateProjectionMatrix();
    },
    render: () => {
      if (r.bloom) r.composer.render();
      else r.renderer.render(r.scene, r.camera);
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = profile.bloom || profile.mirror;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 300);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = profile.bloom ? new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.5, 0.9) : null;
  if (bloom) composer.addPass(bloom);
  composer.addPass(new OutputPass());

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
  scene.add(key, key.target, fill, rimLight, rimLight.target);

  const { floor, veil, mirror } = createFloor(profile);
  scene.add(floor);

  return { renderer, scene, camera, composer, bloom, key, fill, rimLight, floor, veil, mirror, envMap };
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
