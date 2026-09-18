/**
 * Runtime props (design D7): decode GLBs embedded by `render`, normalise to
 * `size` (longest `Box3` side), ground, face the camera (yaw only), restyle to
 * the deck PBR palette, place by role and animate on the shared deterministic
 * clock.
 *
 * Roles: `hero` (right of the title block), `illustration` (opposite the
 * bullets), `ambient` (`count` instances drifting in the background), and
 * `node:<id>` (replaces a flowchart primitive while the node's label and edge
 * endpoints keep the node's bbox — the primitive is hidden, not removed).
 */
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { PropOverride } from "../ir/types.js";
import { propKey } from "../props/key.js";
import type { DiagramBuild } from "./builders.js";
import type { PaletteColors } from "./palette.js";
import { makeRng } from "./rng.js";
import type { RuntimeDeck, SlideConfig } from "./types.js";

/** Camera sits ahead of every slide at `+(0.6, 0.6, 9)` in slide-local space. */
const CAM_AHEAD = new THREE.Vector3(0.6, 0, 9).normalize();
const CAM_YAW = Math.atan2(CAM_AHEAD.x, CAM_AHEAD.z);
const DEFAULT_SIZE: Record<string, number> = { hero: 1.6, illustration: 1.25, ambient: 0.4 };
const DEFAULT_AMBIENT_COUNT = 12;
const HERO_AT = new THREE.Vector3(2.9, -0.4, 0.6);
const ILLUSTRATION_AT = new THREE.Vector3(2.7, -1.1, 0.7);

export interface PropMaterials {
  metal: THREE.Material;
  matte: THREE.Material;
}

/** One shared material family per deck (metal for hard-edged, matte otherwise). */
export function createPropMaterials(P: PaletteColors, cfg: SlideConfig): PropMaterials {
  const env = cfg.envReflections !== false;
  return {
    metal: new THREE.MeshStandardMaterial({ color: P.accent, metalness: 1, roughness: 0.25, envMapIntensity: env ? 1.6 : 0 }),
    matte: new THREE.MeshStandardMaterial({ color: P.second, metalness: 0.1, roughness: 0.75 }),
  };
}

export interface PropLayer {
  group: THREE.Group;
  tick: (t: number) => void;
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function decodeBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Decode every embedded prop once, keyed `<source>-<id>` (async, meshopt-aware). */
export async function loadPropModels(deck: RuntimeDeck): Promise<Map<string, THREE.Object3D>> {
  const out = new Map<string, THREE.Object3D>();
  const embedded = window.__DECK_PROPS ?? {};
  const seen = new Set<string>();
  for (const prop of deck.props ?? []) {
    const key = propKey(prop);
    if (seen.has(key)) continue;
    seen.add(key);
    const data = embedded[key];
    if (!data) continue;
    try {
      const gltf = await loader.parseAsync(decodeBase64(data), "");
      out.set(key, gltf.scene);
    } catch {
      // A prop that fails to decode is skipped; the rest of the deck renders.
    }
  }
  return out;
}

function firstMesh(object: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  object.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
  });
  return found;
}

function firstMaterial(mesh: THREE.Mesh): THREE.Material | null {
  return Array.isArray(mesh.material) ? (mesh.material[0] ?? null) : mesh.material;
}

/** `palette` restyle: hard-edged (metalness ≥ 0.5) → metal, everything else → matte. */
function paletteMaterialFor(mesh: THREE.Mesh, mats: PropMaterials): THREE.Material {
  const source = firstMaterial(mesh);
  const metalness = (source as THREE.MeshStandardMaterial | null)?.metalness;
  return typeof metalness === "number" && metalness >= 0.5 ? mats.metal : mats.matte;
}

function restyle(object: THREE.Object3D, mats: PropMaterials): void {
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(() => mats.matte) : paletteMaterialFor(mesh, mats);
  });
}

/** Clone, scale longest side to `size`, centre on x/z, ground (or centre) y. */
function normaliseModel(source: THREE.Object3D, size: number, ground: boolean): THREE.Group {
  const model = source.clone(true);
  const group = new THREE.Group();
  group.add(model);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) return group;
  const dims = box.getSize(new THREE.Vector3());
  const longest = Math.max(dims.x, dims.y, dims.z);
  if (longest > 0) model.scale.multiplyScalar(size / longest);
  const scaled = new THREE.Box3().setFromObject(model);
  const center = scaled.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= ground ? scaled.min.y : center.y;
  group.rotation.y = CAM_YAW;
  return group;
}

function seedOf(value: string): number {
  let seed = 7;
  for (let i = 0; i < value.length; i++) seed = (seed * 31 + value.charCodeAt(i)) % 233280;
  return seed || 7;
}

/** `count` instances drifting behind the slide (InstancedMesh; deterministic). */
function buildAmbient(
  model: THREE.Object3D,
  prop: PropOverride,
  group: THREE.Group,
  mats: PropMaterials,
  restyled: boolean,
): ((t: number) => void) | null {
  const mesh = firstMesh(model);
  if (!mesh) return null;
  const material = restyled ? paletteMaterialFor(mesh, mats) : firstMaterial(mesh);
  if (!material) return null;
  const count = Math.max(1, prop.count ?? DEFAULT_AMBIENT_COUNT);
  const size = prop.size ?? DEFAULT_SIZE.ambient;
  const geometry = mesh.geometry.clone();
  const dims = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const longest = Math.max(dims.x, dims.y, dims.z);
  if (longest > 0) geometry.scale(size / longest, size / longest, size / longest);
  const instanced = new THREE.InstancedMesh(geometry, material, count);
  const rnd = makeRng(seedOf(propKey(prop)));
  const items = Array.from({ length: count }, () => ({
    x: (rnd() - 0.5) * 9,
    y: rnd() * 3 - 0.5,
    z: -2 - rnd() * 3,
    scale: 0.5 + rnd() * 0.9,
    phase: rnd() * Math.PI * 2,
    speed: 0.15 + rnd() * 0.4,
  }));
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  function write(t: number): void {
    items.forEach((it, i) => {
      position.set(it.x + Math.sin(t * it.speed + it.phase) * 0.4, it.y + Math.cos(t * it.speed * 0.8 + it.phase) * 0.25, it.z);
      euler.set(it.phase, t * it.speed + it.phase, it.phase * 0.5);
      quaternion.setFromEuler(euler);
      scale.setScalar(it.scale);
      matrix.compose(position, quaternion, scale);
      instanced.setMatrixAt(i, matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
  }
  write(0);
  group.add(instanced);
  return write;
}

/** Animation presets, all pure functions of the shared clock `t`. */
function animator(holder: THREE.Group, base: THREE.Vector3, anim: PropOverride["anim"]): (t: number) => void {
  switch (anim) {
    case "float":
      return (t) => {
        holder.position.y = base.y + Math.sin(t * 1.5) * 0.09;
        holder.rotation.z = Math.sin(t * 0.9) * 0.05;
      };
    case "orbit":
      return (t) => {
        holder.position.x = base.x + Math.cos(t * 0.8) * 0.3;
        holder.position.z = base.z + Math.sin(t * 0.8) * 0.3;
      };
    case "spin":
      return (t) => {
        holder.rotation.y = t * 0.7;
      };
    default:
      return () => {};
  }
}

/** `node:<id>` — hide the primitive, show the model at its transform (bbox kept). */
function placeNodeProp(
  model: THREE.Object3D,
  prop: PropOverride,
  diagram: DiagramBuild | null,
  mats: PropMaterials,
  restyled: boolean,
  fallback: THREE.Group,
): { holder: THREE.Group; base: THREE.Vector3 } | null {
  const node = diagram?.nodes?.[prop.role.slice("node:".length)];
  if (!node) return null;
  const dims = new THREE.Box3().setFromObject(node).getSize(new THREE.Vector3());
  const normalised = normaliseModel(model, prop.size ?? Math.max(dims.x, dims.y, 0.3), false);
  if (restyled) restyle(normalised, mats);
  const holder = new THREE.Group();
  holder.position.copy(node.position);
  normalised.quaternion.copy(node.quaternion);
  holder.add(normalised);
  if (node.parent) node.parent.add(holder);
  else fallback.add(holder);
  node.visible = false;
  return { holder, base: holder.position.clone() };
}

/** `hero` (right of the title block) / `illustration` (opposite the bullets). */
function placeSlideProp(
  model: THREE.Object3D,
  prop: PropOverride,
  group: THREE.Group,
  mats: PropMaterials,
  restyled: boolean,
): { holder: THREE.Group; base: THREE.Vector3 } {
  const base = (prop.role === "hero" ? HERO_AT : ILLUSTRATION_AT).clone();
  const size = prop.size ?? DEFAULT_SIZE[prop.role] ?? DEFAULT_SIZE.illustration;
  const normalised = normaliseModel(model, size, true);
  if (restyled) restyle(normalised, mats);
  const holder = new THREE.Group();
  holder.position.copy(base);
  holder.add(normalised);
  group.add(holder);
  return { holder, base };
}

/** One prop → its tick, or `null` when its role does not resolve. */
function placeProp(
  model: THREE.Object3D,
  prop: PropOverride,
  diagram: DiagramBuild | null,
  group: THREE.Group,
  mats: PropMaterials,
): ((t: number) => void) | null {
  const restyled = (prop.restyle ?? "original") === "palette";
  if (prop.role === "ambient") return buildAmbient(model, prop, group, mats, restyled);
  const placed =
    prop.role.startsWith("node:")
      ? placeNodeProp(model, prop, diagram, mats, restyled, group)
      : placeSlideProp(model, prop, group, mats, restyled);
  return placed ? animator(placed.holder, placed.base, prop.anim) : null;
}

/**
 * Place this slide's props. `group` receives hero/illustration/ambient; a
 * `node:<id>` prop is added at the node's transform inside the diagram group
 * and the node primitive is hidden so its label and edges keep their bbox.
 */
export function applyProps(
  deck: RuntimeDeck,
  slideId: string,
  slideGroup: THREE.Group,
  diagram: DiagramBuild | null,
  models: Map<string, THREE.Object3D>,
  mats: PropMaterials,
): PropLayer | null {
  const props = (deck.props ?? []).filter((p) => p.slide === slideId);
  if (!props.length) return null;
  const group = new THREE.Group();
  slideGroup.add(group);
  const ticks: Array<(t: number) => void> = [];
  for (const prop of props) {
    const model = models.get(propKey(prop));
    if (!model) continue;
    const tick = placeProp(model, prop, diagram, group, mats);
    if (tick) ticks.push(tick);
  }
  if (!ticks.length) {
    slideGroup.remove(group);
    return null;
  }
  return { group, tick: (t) => ticks.forEach((fn) => fn(t)) };
}
