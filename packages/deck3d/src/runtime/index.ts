/**
 * Runtime entry — bundled by esbuild into `dist/runtime.js` and inlined into
 * `deck.html`. Reads `window.__DECK` (merged IR) + `window.__DECK_FONT`
 * (base64 subset TTF), builds one 3D group per slide, and exposes the
 * `window.__deck3d` measurement/debug surface (design D8).
 */
import type { Font } from "opentype.js";
import * as THREE from "three";
import { composeEffects, QUALITY_BUDGET } from "../fx/compose.js";
import { REGISTRY } from "../fx/index.js";
import type { Layout } from "../ir/types.js";
import type { FxContext, FxParams } from "../fx/types.js";
import { type Animator, backgroundFor } from "./backgrounds.js";
import { buildDiagram, type DiagramBuild } from "./builders.js";
import { anchorFor, cullRadius } from "./camera.js";
import { diagramMaterial, titleMaterial } from "./materials.js";
import { projectRect } from "./measure.js";
import { mixPalette, type PaletteColors, resolvePalette } from "./palette.js";
import { applyProps, createPropMaterials, loadPropModels, type PropLayer, type PropMaterials } from "./props.js";
import { createHud, type SlidePatch } from "./hud.js";
import { createLocalEffect, localCards, type LocalFxError, type LocalHandle, localFxRegistry } from "./local-fx.js";
import { type QualityProfile, qualityProfile } from "./quality.js";
import { makeRng } from "./rng.js";
import type { PartName } from "./post.js";
import { createSceneRig, markBackdrop } from "./scene.js";
import { buildTitle, bulletTexture, loadFont } from "./text.js";
import "./types.js";
import type { Deck3dApi, Measurement, RuntimeDeck, SlideConfig } from "./types.js";

type DeckSlide = RuntimeDeck["slides"][number];

interface LabelRef {
  kind: "title" | "label";
  id: string;
  text: string;
  object: THREE.Object3D;
  height: number;
  color?: string;
}

interface SlideBuild {
  group: THREE.Group;
  anchor: ReturnType<typeof anchorFor>;
  diagram: DiagramBuild | null;
  background: Animator | null;
  props: PropLayer | null;
  labels: LabelRef[];
  nodes: Array<{ id: string; object: THREE.Object3D }>;
  localFx: LocalHandle[];
  cfg: SlideConfig;
  palette: PaletteColors;
  skipped: string[];
  budget: { sum: number; limit: number; warning?: string };
}

function effective(defaults: SlideConfig, slide: DeckSlide): SlideConfig {
  return { ...defaults, ...slide } as SlideConfig;
}

/**
 * Where the composition puts each element. `split` reproduces the v1 numbers
 * exactly, so an untouched deck renders byte-identically. A vertical `stacked`
 * preset was tried and dropped: floor y=-2.6 to frame top ~4.0 is 6.6 units and
 * title+disc+card need 7.7, so it needs a lower-third card variant first.
 */
interface LayoutSpec {
  /** Title left edge; `centre` centres the text box instead. */
  titleX: number | "centre";
  titleY: number;
  cardX: number;
  cardY: number;
  barX: number;
  barY: number;
  diagram: [number, number, number];
}

const LAYOUTS: Record<Layout, LayoutSpec> = {
  split: { titleX: -5.2, titleY: 2.2, cardX: -2.4, cardY: -0.35, barX: -4.4, barY: 1.55, diagram: [2.9, 0.1, 0.9] },
  // Mirrored: the title is right-ALIGNED, so its left edge depends on its width.
  "split-reverse": { titleX: 5.2, titleY: 2.2, cardX: 2.4, cardY: -0.35, barX: 4.4, barY: 1.55, diagram: [-2.9, 0.1, 0.9] },
};

function layoutFor(cfg: SlideConfig): LayoutSpec {
  return LAYOUTS[(cfg.layout as Layout) ?? "split"] ?? LAYOUTS.split;
}

function addTitle(g: THREE.Group, slide: DeckSlide, isTitle: boolean, font: Font, P: PaletteColors, cfg: SlideConfig, labels: LabelRef[]): void {
  const title = buildTitle(font, slide.title, isTitle ? 0.62 : 0.5, cfg.extrudeDepth ?? 0.18, titleMaterial(P, cfg));
  const bb = new THREE.Box3().setFromObject(title.group);
  const L = layoutFor(cfg);
  const width = bb.max.x - bb.min.x;
  // `split-reverse` pins the title's RIGHT edge; every other preset its left.
  const x = L.titleX === "centre" ? -width / 2 : L.titleX > 0 ? L.titleX - width : L.titleX;
  title.group.position.set(
    isTitle ? -width / 2 : x,
    isTitle ? 1.5 + (title.lines - 1) * 0.85 : L.titleY + (title.lines - 1) * 0.68,
    0.2,
  );
  g.add(title.group);
  title.group.userData.ownerId = `${slide.id}/title`;
  title.group.userData.part = "title";
  labels.push({ kind: "title", id: `${slide.id}/title`, text: slide.title, object: title.group, height: (isTitle ? 0.62 : 0.5) * 1.4 });
}

function slabBack(P: PaletteColors, cfg: SlideConfig, slabH: number): THREE.Mesh {
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(5.6, slabH, 0.08),
    new THREE.MeshPhysicalMaterial({
      color: P.card,
      metalness: 0,
      roughness: 0.35,
      transmission: cfg.material === "glass" ? (cfg.mode === "dark" ? 0.55 : 0.25) : 0,
      thickness: 0.4,
      envMapIntensity: cfg.envReflections !== false ? 0.8 : 0,
      transparent: true,
      opacity: cfg.material === "glass" ? 0.85 : 1,
    }),
  );
  back.receiveShadow = true;
  back.castShadow = true;
  return back;
}

function addBody(g: THREE.Group, slide: DeckSlide, isTitle: boolean, P: PaletteColors, cfg: SlideConfig): void {
  if (!slide.bullets.length && !slide.subtitle) return;
  const slabH = isTitle && !slide.bullets.length ? 1.0 : 2.9;
  const slab = new THREE.Group();
  slab.add(slabBack(P, cfg, slabH));
  const txt = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 2.6),
    new THREE.MeshBasicMaterial({ map: bulletTexture(slide, P), transparent: true, toneMapped: false, depthWrite: false }),
  );
  txt.position.set(0, -(2.9 - slabH) / 2, 0.06);
  txt.renderOrder = 2;
  slab.add(txt);
  const L = layoutFor(cfg);
  const nudge = cfg.cardOffset ?? {};
  slab.position.set(
    (isTitle ? 0 : L.cardX) + (nudge.x ?? 0),
    (isTitle ? (slabH < 2 ? -0.3 : -1.1) : L.cardY) + (nudge.y ?? 0),
    0,
  );
  g.add(slab);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(isTitle ? 3 : 1.6, 0.06, 0.06), diagramMaterial(P, "accent", cfg));
  bar.position.set(isTitle ? 0 : L.barX, isTitle ? 0.55 : L.barY, 0.25);
  g.add(bar);
}

function addDiagram(g: THREE.Group, slide: DeckSlide, font: Font, P: PaletteColors, cfg: SlideConfig, labels: LabelRef[]): DiagramBuild | null {
  if (slide.diagram.kind === "none") return null;
  const holder = new THREE.Group();
  holder.userData.part = "diagram";
  holder.position.set(...layoutFor(cfg).diagram);
  const diagram = buildDiagram(slide, P, cfg, font);
  holder.add(diagram.g);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.75, 0.08, 64),
    // Polished, not matte: low roughness + full metalness is what makes the
    // key and rim lights read as highlights sliding across the plate.
    new THREE.MeshStandardMaterial({
      color: P.card,
      metalness: 0.95,
      roughness: 0.12,
      envMapIntensity: cfg.envReflections !== false ? 1.6 : 0,
    }),
  );
  disc.position.y = -1.7;
  disc.receiveShadow = true;
  holder.add(disc);
  g.add(holder);
  for (const l of diagram.labels ?? []) labels.push({ kind: "label", id: l.id, text: l.text, object: l.object, height: l.height, color: P.text });
  return diagram;
}

/** Per-slide seed: same slide id ⇒ same stream, so effects stay deterministic. */
export function fxSeedFor(slideId: string): number {
  let h = 2166136261;
  for (let i = 0; i < slideId.length; i++) {
    h ^= slideId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 233280;
}

/** The context every effect (corpus or local) is constructed with. */
function fxContextFor(slide: DeckSlide, P: PaletteColors, profile: QualityProfile, mode: "dark" | "light"): FxContext {
  return {
    THREE,
    palette: P,
    mode,
    quality: profile,
    rng: makeRng(fxSeedFor(slide.id)),
    slide: { id: slide.id, title: slide.title, kind: slide.kind ?? "content" },
  };
}

/**
 * Live per-effect parameter edits from the configurator, keyed
 * `<slideId>|<effectId>`. The authored `ref.params` stay untouched so an
 * export still diffs against the deck as written.
 */
const fxParamEdits: Record<string, FxParams> = {};

function paramsFor(slideId: string, ref: { id: string; params?: unknown }): FxParams {
  return { ...((ref.params ?? {}) as FxParams), ...(fxParamEdits[`${slideId}|${ref.id}`] ?? {}) };
}

function backgroundFromEffects(slide: DeckSlide, P: PaletteColors, profile: QualityProfile, mode: "dark" | "light"): Animator | null {
  for (const ref of slide.effects ?? []) {
    const entry = REGISTRY[ref.id];
    if (entry?.card.kind !== "background") continue;
    const handle = entry.create(fxContextFor(slide, P, profile, mode), paramsFor(slide.id, ref));
    if (!handle.object) continue;
    return { g: handle.object as THREE.Group, tick: handle.tick ?? (() => {}) };
  }
  return null;
}

/**
 * Instantiate the slide's `local:` effects. A module that throws is dropped
 * (recorded in `localFxErrors`); the slide and its other effects survive.
 */
function localEffectsFor(
  slide: DeckSlide,
  P: PaletteColors,
  profile: QualityProfile,
  mode: "dark" | "light",
  g: THREE.Group,
  index: number,
  skip?: (id: string) => boolean,
): LocalHandle[] {
  const registry = localFxRegistry();
  const out: LocalHandle[] = [];
  const ids: string[] = [];
  for (const ref of slide.effects ?? []) {
    if (!ref.id.startsWith("local:")) continue;
    if (skip?.(ref.id)) continue;
    const module = registry[ref.id.slice("local:".length)];
    const handle = createLocalEffect(
      ref.id,
      module,
      fxContextFor(slide, P, profile, mode),
      paramsFor(slide.id, ref),
      localFxErrors,
    );
    if (!handle) continue;
    ids.push(ref.id);
    if (handle.object) {
      // Both `background` and `motion` local effects are backdrop: nothing an
      // effect draws may ever cover the text.
      markBackdrop(handle.object as THREE.Object3D);
      g.add(handle.object as THREE.Object3D);
    }
    out.push(handle);
  }
  localFxIds[index] = ids;
  return out;
}

/** Per-slide `local:` ids, index-aligned with `SlideBuild.localFx` (for leak reporting). */
const localFxIds: string[][] = [];

/** Deck-wide local-effect failures, surfaced through `effects().errors`. */
const localFxErrors: LocalFxError[] = [];

function buildSlideGroup(
  deck: RuntimeDeck,
  slide: DeckSlide,
  index: number,
  font: Font,
  models: Map<string, THREE.Object3D>,
  propMaterials: PropMaterials,
  /** Configurator patch, layered over the slide's own config (not persisted). */
  patch?: SlideConfig,
): SlideBuild {
  const cfg = patch ? { ...effective(deck.defaults, slide), ...patch } : effective(deck.defaults, slide);
  const P = resolvePalette(cfg);
  const g = new THREE.Group();
  const anchor = anchorFor(index, cfg.camera?.distance, cfg.spacing, cfg.rail, deck.slides.length);
  g.position.copy(anchor.pos);
  g.rotation.y = anchor.rotY;
  const labels: LabelRef[] = [];
  const isTitle = slide.kind === "title";
  addTitle(g, slide, isTitle, font, P, cfg, labels);
  addBody(g, slide, isTitle, P, cfg);
  const diagram = addDiagram(g, slide, font, P, cfg, labels);
  const props = applyProps(deck, slide.id, g, diagram, models, propMaterials);
  if (props) props.group.userData.part = "props";
  const nodes = diagram?.nodes ? Object.entries(diagram.nodes).map(([id, object]) => ({ id, object })) : [];
  const profile = qualityProfile(cfg.quality ?? deck.defaults.quality);
  const mode = (cfg.mode ?? "dark") as "dark" | "light";
  const background = backgroundFromEffects(slide, P, profile, mode) ?? backgroundFor(slide.scene, P, profile) ?? null;
  if (background) {
    background.g.position.z = -2;
    markBackdrop(background.g);
    g.add(background.g);
  }
  const localFx = localEffectsFor(slide, P, profile, mode, g, index);
  const quality = cfg.quality ?? deck.defaults.quality ?? "high";
  const comp = composeEffects(slide.effects, mode, quality, slide.id, localCards());
  const skipped = comp.skipped.map((s) => `${s.id}: ${s.reason}`);
  // The budget warning text is `composeEffects`' own, so the runtime and the
  // render CLI agree byte-for-byte (`warn budget slide <id> <sum> > <limit>`).
  const warning = comp.warnings.find((w) => w.startsWith("warn budget"));
  const budget = {
    sum: comp.active.reduce((total, e) => total + (REGISTRY[e.id]?.card.cost ?? 0), 0),
    limit: QUALITY_BUDGET[quality],
    ...(warning ? { warning } : {}),
  };
  return { group: g, anchor, diagram, background, props, labels, nodes, cfg, palette: P, skipped, budget, localFx };
}

async function boot(): Promise<void> {
  const deck = window.__DECK;
  const font = loadFont(window.__DECK_FONT ?? "");
  try {
    await document.fonts.load("700 16px Poppins");
  } catch {
    // Canvas labels fall back to a system font; titles still use the TTF.
  }

  // Baseline bloom follows the quality tier; a slide listing the `bloom` card
  // (even at `quality: low`) is honoured per slide by the post stack.
  const rig = createSceneRig(qualityProfile(deck.defaults.quality));
  document.body.appendChild(rig.renderer.domElement);

  const propModels = await loadPropModels(deck);
  const propMaterials = createPropMaterials(resolvePalette(deck.defaults), deck.defaults);
  const builds = deck.slides.map((slide, i) => buildSlideGroup(deck, slide, i, font, propModels, propMaterials));
  for (const b of builds) rig.world.add(b.group);
  rig.world.children.forEach((g, i) => {
    g.userData.index = i;
  });

  const camState = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  let cur = 0;
  let frozen: number | null = null;
  const clock = new THREE.Clock();
  type Anim = {
    from: { pos: THREE.Vector3; target: THREE.Vector3 };
    to: ReturnType<typeof anchorFor>;
    t: number;
    mode: string;
    dur: number;
    mid: THREE.Vector3;
    /** Set only when the two slides differ in palette; drives the look morph. */
    look?: { from: PaletteColors; to: PaletteColors; cfg: SlideConfig };
  };
  let anim: Anim | null = null;
  /** Slide whose local fx are reclaimed once the in-flight transition lands. */
  let pendingDispose: number | null = null;

  /** Root objects of a named part on slide `i` (selective post passes). */
  function partsOf(i: number, name: PartName): THREE.Object3D[] {
    const g = builds[i].group;
    if (name === "all") return g.children.filter((c) => !c.userData.backdrop);
    const out: THREE.Object3D[] = [];
    g.traverse((o) => {
      if (o.userData.part === name) out.push(o);
    });
    return out;
  }

  /**
   * Hand the current slide's `post` cards to the rig. Called wherever the
   * slide or its params change; idempotent, so landing after a fly may call
   * it again without cost.
   */
  function syncPost(): void {
    const slide = deck.slides[cur];
    const build = builds[cur];
    const refs = (slide.effects ?? [])
      .filter((e) => REGISTRY[e.id]?.card.kind === "post")
      .map((e) => ({ id: e.id, params: paramsFor(slide.id, e) }));
    rig.setPost(refs, {
      mode: (build.cfg.mode ?? "dark") as "dark" | "light",
      palette: build.palette,
      parts: (name) => partsOf(cur, name),
      sun: () => rig.sunPosition(),
      focusDistance: () => build.anchor.cam.distanceTo(build.anchor.target),
    });
  }

  function snapTo(i: number): void {
    cur = i;
    const a = builds[i].anchor;
    camState.pos.copy(a.cam);
    camState.target.copy(a.target);
    anim = null;
    rig.camera.position.copy(camState.pos);
    rig.camera.lookAt(camState.target);
    rig.applyLook(builds[i].palette, builds[i].cfg, qualityProfile(builds[i].cfg.quality));
    syncPost();
  }

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  function stepAnim(dt: number): void {
    if (!anim) return;
    anim.t = Math.min(1, anim.t + dt / anim.dur);
    const k = ease(anim.t);
    if (anim.mode === "fade") {
      if (anim.t >= 0.5) {
        camState.pos.copy(anim.to.cam);
        camState.target.copy(anim.to.target);
      }
    } else {
      camState.pos.lerpVectors(anim.from.pos, anim.to.cam, k);
      camState.target.lerpVectors(anim.from.target, anim.to.target, k);
      if (anim.mode === "swing") {
        const out = camState.pos.clone().sub(anim.mid).normalize();
        camState.pos.addScaledVector(out, Math.sin(anim.t * Math.PI) * 6);
      }
    }
    if (anim.look) {
      const l = anim.look;
      rig.applyLook(anim.t >= 1 ? l.to : mixPalette(l.from, l.to, k), l.cfg, qualityProfile(l.cfg.quality));
    }
    if (anim.t >= 1) {
      anim = null;
      if (pendingDispose !== null && pendingDispose !== cur) disposeLocalFx(pendingDispose);
      pendingDispose = null;
    }
  }

  /**
   * Local effects own real GPU resources, so leaving a slide disposes them.
   * A throwing `dispose` is recorded and swallowed — navigation must complete.
   */
  function disposeLocalFx(index: number): void {
    for (const handle of builds[index]?.localFx ?? []) {
      handle.dispose();
      // `dispose` frees GPU buffers but leaves the node attached. Detach it
      // too, or reviving the slide stacks a second, frozen copy of the effect
      // on top of the live one (the background renders doubled).
      const object = handle.object as THREE.Object3D | undefined;
      object?.parent?.remove(object);
    }
    if (builds[index]) builds[index].localFx = [];
  }

  /**
   * Free a discarded slide build's GPU resources. The configurator rebuilds
   * the same slide once per edit, so dropping the reference is not enough —
   * three.js never frees buffers on GC.
   *
   * The props subtree is skipped on purpose: `applyProps` places
   * `Object3D.clone()`s of shared model templates, and clones share their
   * geometry and material BY REFERENCE. Disposing them here would blank the
   * same prop on every other slide using it.
   */
  /** Free every mesh under a discarded subtree (three.js never frees on GC). */
  function disposeTree(root: THREE.Object3D): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      for (const m of Array.isArray(mat) ? mat : [mat]) m?.dispose();
    });
  }

  function disposeBuild(build: SlideBuild): void {
    const propsRoot = build.props?.group;
    build.group.traverse((o) => {
      if (propsRoot && (o === propsRoot || propsRoot.getObjectById(o.id))) return;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      for (const m of Array.isArray(mat) ? mat : [mat]) m?.dispose();
    });
  }

  /**
   * Re-create the local effects of a slide whose handles were disposed on the
   * way out. Without this a `local:` effect animates on the FIRST visit only —
   * every later visit shows a slide frozen at whatever pose it was disposed in.
   */
  function reviveLocalFx(index: number): void {
    const build = builds[index];
    if (!build || build.localFx.length > 0) return;
    const slide = deck.slides[index];
    if (!(slide.effects ?? []).some((ref) => ref.id.startsWith("local:"))) return;
    const profile = qualityProfile(build.cfg.quality ?? deck.defaults.quality);
    const mode = (build.cfg.mode ?? "dark") as "dark" | "light";
    // A module that threw on create throws again: re-running it would only
    // duplicate its entry in `effects().errors`.
    const failed = new Set(localFxErrors.filter((e) => e.slide === slide.id).map((e) => e.effectId));
    build.localFx = localEffectsFor(slide, build.palette, profile, mode, build.group, index, (id) => failed.has(id));
  }

  function goTo(i: number): void {
    const target = ((i % builds.length) + builds.length) % builds.length;
    reviveLocalFx(target);
    const mode = builds[target].cfg.transition ?? "dolly";
    // A cut leaves the old slide instantly, so its fx can go now. A fly does
    // NOT: the outgoing slide stays in frame for the whole move, and disposing
    // here stripped its backdrop the moment the camera started rolling while
    // its content remained. Deferred to `stepAnim` completion instead.
    if (target === cur || mode === "cut") {
      if (target !== cur) disposeLocalFx(cur);
      return snapTo(target);
    }
    if (pendingDispose !== null && pendingDispose !== target) disposeLocalFx(pendingDispose);
    pendingDispose = cur;
    const from = { pos: camState.pos.clone(), target: camState.target.clone() };
    const fromPalette = builds[cur].palette;
    const toPalette = builds[target].palette;
    // Same palette ⇒ nothing to morph, so the look is applied once as before.
    const morph = JSON.stringify(fromPalette) !== JSON.stringify(toPalette);
    anim = {
      from,
      to: builds[target].anchor,
      t: 0,
      mode,
      dur: builds[target].cfg.durationSec ?? 1.4,
      mid: from.target.clone().add(builds[target].anchor.target).multiplyScalar(0.5),
      look: morph ? { from: fromPalette, to: toPalette, cfg: builds[target].cfg } : undefined,
    };
    cur = target;
    if (!morph) rig.applyLook(toPalette, builds[target].cfg, qualityProfile(builds[target].cfg.quality));
    syncPost();
  }

  // Live rail state: the configurator may move every anchor, and `window.__DECK`
  // must stay the record of what was RENDERED, so the state lives here.
  const railState = { spacing: deck.defaults.spacing, rail: deck.defaults.rail };

  /** Re-place every slide group when the rail topology or spacing changes. */
  function reanchorAll(): void {
    builds.forEach((build, i) => {
      const anchor = anchorFor(i, build.cfg.camera?.distance, railState.spacing, railState.rail, deck.slides.length);
      build.anchor = anchor;
      build.group.position.copy(anchor.pos);
      build.group.rotation.y = anchor.rotY;
    });
    snapTo(cur);
  }

  function cullNeighbours(): void {
    const cp = rig.camera.position;
    rig.world.children.forEach((g) => {
      g.visible = g.position.distanceTo(cp) < cullRadius(railState.spacing, railState.rail);
    });
  }

  const pq = new THREE.Quaternion();
  /**
   * Point every diagram label at the camera. `loop`, `globe`, `swarm` and
   * `orbit-cluster` spin a group that CONTAINS its labels, so once the clock
   * runs the captions turn edge-on and then away — invisible in every deck,
   * and invisible to `check`, which measures frozen at t=0 where they happen
   * to face front. Enforced here rather than per builder so a new topology
   * cannot reintroduce it. Deterministic: the camera pose at a given `t` is.
   */
  function billboardLabels(): void {
    for (const label of builds[cur].diagram?.labels ?? []) {
      const o = label.object as THREE.Object3D;
      if (!o.parent) continue;
      o.parent.getWorldQuaternion(pq);
      o.quaternion.copy(pq.invert()).multiply(rig.camera.quaternion);
    }
  }

  function renderAt(t: number): void {
    const slide = builds[cur];
    slide.diagram?.tick(t);
    slide.background?.tick(t * 0.7);
    slide.props?.tick(t);
    for (const handle of slide.localFx) handle.tick(t);
    rig.updateFloor(camState.target);
    cullNeighbours();
    billboardLabels();
    rig.render(t);
  }

  /**
   * Pose the deck at `t` and draw one frame: camera snapped to the anchor, every
   * animator ticked. Does NOT touch the clock, so boot can prime a deterministic
   * first frame without pinning the deck (that was the "camera drifts but
   * nothing animates" bug — `boot()` called the freezing variant).
   */
  function poseAt(t: number): void {
    anim = null; // a deterministic time cancels any in-flight transition
    const a = builds[cur].anchor;
    camState.pos.copy(a.cam);
    camState.target.copy(a.target);
    rig.camera.position.copy(a.cam);
    rig.camera.lookAt(a.target);
    renderAt(t);
  }

  /** `setTime`: pose at `t` AND pin the clock there — `check` renders deterministically. */
  function applyTime(t: number): void {
    frozen = t;
    poseAt(t);
  }

  const tmp = new THREE.Vector3();
  function frame(): void {
    const dt = frozen === null ? clock.getDelta() : 1 / 60;
    const t = frozen === null ? clock.elapsedTime : frozen;
    stepAnim(dt);
    tmp.copy(camState.pos);
    if (frozen === null) tmp.add(new THREE.Vector3(Math.sin(t * 0.35) * 0.25, Math.cos(t * 0.27) * 0.12, Math.sin(t * 0.2) * 0.15));
    // The 0.2 smoothing exists for the idle drift ONLY. Applying it while a
    // transition flies made the camera trail `camState` by seconds: `anim`
    // cleared while the view still sat over the previous slide, so its
    // backdrop stayed on screen well after the move was "done".
    rig.camera.position.lerp(tmp, frozen === null && anim === null ? 0.2 : 1);
    rig.camera.lookAt(camState.target);
    cullNeighbours();
    rig.updateFloor(camState.target);
    builds[cur].diagram?.tick(t);
    builds[cur].background?.tick(t * 0.7);
    builds[cur].props?.tick(t);
    for (const handle of builds[cur].localFx) handle.tick(t);
    // The outgoing slide is still in frame during a fly: tick it too, or its
    // backdrop freezes into a still the moment the camera moves.
    if (pendingDispose !== null && pendingDispose !== cur) {
      for (const handle of builds[pendingDispose]?.localFx ?? []) handle.tick(t);
      builds[pendingDispose]?.background?.tick(t * 0.7);
    }
    billboardLabels();
    rig.render(t);
    if (document.hidden) setTimeout(frame, 66);
    else requestAnimationFrame(frame);
  }

  const raycaster = new THREE.Raycaster();
  function ownerOf(object: THREE.Object3D): string | null {
    let o: THREE.Object3D | null = object;
    while (o) {
      if (typeof o.userData.ownerId === "string") return o.userData.ownerId;
      o = o.parent;
    }
    return null;
  }

  function raycastOwner(rect: { x: number; y: number; w: number; h: number }, width: number, height: number, target: THREE.Object3D): string | null {
    const ndc = new THREE.Vector2(((rect.x + rect.w / 2) / width) * 2 - 1, -(((rect.y + rect.h / 2) / height) * 2 - 1));
    raycaster.setFromCamera(ndc, rig.camera);
    for (const h of raycaster.intersectObject(target, true)) {
      const owner = ownerOf(h.object);
      if (owner) return owner;
    }
    return null;
  }

  function labelMeasurement(ref: LabelRef, width: number, height: number, target: THREE.Object3D): Measurement | null {
    const rect = projectRect(ref.object, rig.camera, width, height);
    if (!rect) return null;
    const box = new THREE.Box3().setFromObject(ref.object);
    const worldH = Math.max(0.0001, box.max.y - box.min.y);
    return {
      kind: ref.kind,
      id: ref.id,
      text: ref.text,
      rect,
      capHeight: (ref.height / worldH) * rect.h,
      hit: raycastOwner(rect, width, height, target),
      color: ref.color ?? null,
    };
  }

  function measure(): Measurement[] {
    const width = rig.renderer.domElement.clientWidth || window.innerWidth;
    const height = rig.renderer.domElement.clientHeight || window.innerHeight;
    const target = builds[cur].group;
    const out: Measurement[] = [];
    for (const ref of builds[cur].labels) {
      const m = labelMeasurement(ref, width, height, target);
      if (m) out.push(m);
    }
    for (const node of builds[cur].nodes) {
      const rect = projectRect(node.object, rig.camera, width, height);
      if (rect) out.push({ kind: "node", id: node.id, text: "", rect, capHeight: 0, hit: null });
    }
    return out;
  }

  function peaks(): number[] {
    const diagram = deck.slides[cur]?.diagram;
    if (diagram?.kind === "sequence" && diagram.messages) return diagram.messages.map((_, k) => k * 1.1);
    return [0];
  }

  function hashIndex(): number | null {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    if (n < 1 || n > builds.length) return 0;
    return n - 1;
  }

  /** Step to a 0-based slide, clamped at both ends, mirroring the index into the `#<n>` hash. */
  function navTo(index: number, syncHash = true): void {
    const target = Math.max(0, Math.min(builds.length - 1, index));
    if (target === cur) return;
    goTo(target);
    hud?.refresh();
    // Setting the hash re-enters via `hashchange`, where `target === cur` returns early.
    if (syncHash) window.location.hash = `#${target + 1}`;
  }

  /**
   * Rebuild one slide from a patched config. Colours, label sizes, the camera
   * anchor and the background FX are BAKED by `buildSlideGroup`, so re-running
   * `applyLook` alone reaches only the lights. `follow` moves the camera and
   * the lights, which is right for the slide the viewer is on and wrong for
   * the rest of the deck.
   */
  function rebuildSlide(i: number, patch: SlidePatch, follow: boolean): void {
    // Colours, label sizes, the camera anchor and the background FX are all
    // BAKED by `buildSlideGroup`. Re-running `applyLook` alone reaches only
    // the lights, so the slide is rebuilt from the patched config — measured
    // at ~10-21 ms for the heaviest real slide, i.e. about one frame.
    const { scene, diagram: diagramPatch, ...cfgPatch } = patch;
    // `scene` and `diagram.*` are properties of the SLIDE, not of the config,
    // so they are layered onto a copy — `window.__DECK` is never touched.
    const base = deck.slides[i];
    const slide = (scene !== undefined || diagramPatch
      ? { ...base, ...(scene === undefined ? {} : { scene }), ...(diagramPatch ? { diagram: { ...base.diagram, ...diagramPatch } } : {}) }
      : base) as DeckSlide;
    const previous = builds[i];
    const cfg = { ...previous.cfg, ...cfgPatch } as SlideConfig;

    // The rail moves EVERY anchor, so it is applied deck-wide before the
    // current slide is rebuilt at its new place.
    if (cfgPatch.rail !== undefined || cfgPatch.spacing !== undefined) {
      railState.rail = cfgPatch.rail ?? railState.rail;
      railState.spacing = cfgPatch.spacing ?? railState.spacing;
      reanchorAll();
    }
    cfg.rail = railState.rail;
    cfg.spacing = railState.spacing;

    disposeLocalFx(i);
    rig.world.remove(previous.group);

    // Props are tinted from the palette too, so they get materials derived
    // from the patched config rather than the deck defaults.
    const mats = createPropMaterials(resolvePalette(cfg), cfg);
    const rebuilt = buildSlideGroup(deck, slide, i, font, propModels, mats, cfg);
    builds[i] = rebuilt;
    rig.world.add(rebuilt.group);
    rebuilt.group.userData.index = i;
    disposeBuild(previous);

    if (follow) {
      // A new anchor means the camera must follow, or `camera.distance` stages
      // a value the view never honours.
      camState.pos.copy(rebuilt.anchor.cam);
      camState.target.copy(rebuilt.anchor.target);
      anim = null;
      rig.camera.position.copy(camState.pos);
      rig.camera.lookAt(camState.target);
    }

    if (follow) rig.applyLook(rebuilt.palette, cfg, qualityProfile(cfg.quality));
    rebuilt.diagram?.tick(0);
    if (i === cur) syncPost();
    rig.render();
  }

  /**
   * Configurator. Built after the slides so it can read the composed effect
   * list, and given callbacks that re-apply the look WITHOUT touching `__DECK`.
   */
  const hud = createHud({
    slides: deck.slides.map((s) => ({ id: s.id, title: s.title, effects: [...(s.effects ?? [])] })),
    defaults: deck.defaults,
    overridden: overriddenKeys(),
    derivedHash: (window.__DECK as unknown as { derivedHash?: string }).derivedHash ?? "",
    current: () => cur + 1,
    gotoSlide: (index1Based) => navTo(index1Based - 1),
    applySlide: (patch) => rebuildSlide(cur, patch, true),
    applyDeck: (patchFor) => {
      // A deck-scope value belongs to every slide, and neighbours stay in
      // frame on the shared rail — rebuilding only the current slide leaves
      // the rest of the deck visibly stale.
      for (let i = 0; i < builds.length; i++) rebuildSlide(i, patchFor(deck.slides[i].id), i === cur);
    },
    /**
     * Declared knobs of the current slide's effects, with the value in force.
     * The panel renders itself from this, so a new effect (corpus OR local)
     * gets controls by declaring params in its card — no panel code.
     */
    effectParams: () => {
      const slide = deck.slides[cur];
      const local = localCards();
      const out: Array<{ id: string; schema: Record<string, unknown>; values: FxParams }> = [];
      for (const ref of slide.effects ?? []) {
        const card = ref.id.startsWith("local:") ? local[ref.id.slice("local:".length)] : REGISTRY[ref.id]?.card;
        const schema = (card?.params ?? {}) as Record<string, unknown>;
        if (Object.keys(schema).length === 0) continue;
        out.push({ id: ref.id, schema, values: paramsFor(slide.id, ref) });
      }
      return out;
    },
    /** Re-instantiate ONE effect of the current slide under edited params. */
    // Restore path: stage params for ANY slide without rebuilding. `paramsFor`
    // reads `fxParamEdits` at build time, so seeding then rebuilding restores
    // every slide's tuning, not just the one on screen.
    seedEffectParams: (slideId, id, patch) => {
      const key = `${slideId}|${id}`;
      fxParamEdits[key] = { ...(fxParamEdits[key] ?? {}), ...(patch as FxParams) };
    },
    applyEffectParams: (id, patch) => {
      const slide = deck.slides[cur];
      const key = `${slide.id}|${id}`;
      fxParamEdits[key] = { ...(fxParamEdits[key] ?? {}), ...(patch as FxParams) };
      const build = builds[cur];
      const profile = qualityProfile(build.cfg.quality ?? deck.defaults.quality);
      const mode = (build.cfg.mode ?? "dark") as "dark" | "light";
      if (id.startsWith("local:")) {
        // Dispose and rebuild every local handle: they share one array and the
        // factory is the only place params are read.
        disposeLocalFx(cur);
        build.localFx = localEffectsFor(slide, build.palette, profile, mode, build.group, cur);
      } else {
        if (build.background) {
          build.group.remove(build.background.g);
          disposeTree(build.background.g);
        }
        const next = backgroundFromEffects(slide, build.palette, profile, mode);
        build.background = next;
        if (next) {
          next.g.position.z = -2;
          markBackdrop(next.g);
          build.group.add(next.g);
        }
      }
      syncPost();
      rig.render();
    },
    applyEffects: (ids) => {
      const slide = deck.slides[cur];
      const keep = new Set(ids);
      const build = builds[cur];
      if (build.background) build.background.g.visible = (slide.effects ?? []).some((e) => keep.has(e.id));
      rig.render();
    },
  });

  /** Override key paths, precomputed by `render` (the merged IR cannot tell). */
  function overriddenKeys(): { deck: Set<string>; slides: Record<string, Set<string>> } {
    const raw = (window.__DECK as unknown as { overriddenKeys?: { deck: string[]; slides: Record<string, string[]> } })
      .overriddenKeys ?? { deck: [], slides: {} };
    const slides: Record<string, Set<string>> = {};
    for (const [id, keys] of Object.entries(raw.slides)) slides[id] = new Set(keys);
    return { deck: new Set(raw.deck), slides };
  }

  rig.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", () => rig.resize(window.innerWidth, window.innerHeight));
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // A panel input owns the keyboard while it has focus — including `C`, or
    // typing a palette name would toggle the panel away mid-edit.
    if (hud.hasFocus()) {
      if (e.key === "Escape") (document.activeElement as HTMLElement | null)?.blur();
      return;
    }
    if (e.key === "c" || e.key === "C") {
      hud.toggle();
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      hud.close();
      return;
    }
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case " ":
        navTo(cur + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
        navTo(cur - 1);
        break;
      case "Home":
        navTo(0);
        break;
      case "End":
        navTo(builds.length - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
  });
  window.addEventListener("pointerup", (e) => {
    if (e.button !== 0) return;
    // Clicks on the gear or inside the panel are panel interactions.
    if (hud.contains(e.target)) return;
    navTo(cur + 1);
  });
  window.addEventListener("hashchange", () => {
    const i = hashIndex();
    if (i !== null) navTo(i, false);
  });
  snapTo(hashIndex() ?? 0);

  const api: Deck3dApi = {
    gotoSlide: (index1Based: number) => {
      goTo(Math.max(1, Math.min(builds.length, index1Based)) - 1);
      hud?.refresh();
      builds[cur].diagram?.tick(0);
      rig.render();
    },
    setTime: (seconds: number) => applyTime(seconds),
    ready: () => Promise.resolve(),
    measure,
    peaks,
    effects: () => ({
      active: rig.passNames(),
      skipped: builds[cur].skipped,
      budget: builds[cur].budget,
      errors: localFxErrors.map((e) => ({ ...e })),
    }),
    debug: {
      titleGlyphs: () => {
        const title = builds[cur].labels.find((l) => l.kind === "title");
        if (!title) return 0;
        let count = 0;
        title.object.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) count++;
        });
        return count;
      },
      liftedMessage: () => builds[cur].diagram?.lifted?.() ?? null,
      /**
       * How squarely each diagram label faces the camera: 1 = head-on,
       * 0 = edge-on, negative = facing away. `measure()` cannot answer this —
       * its projection is rotation-invariant by design (rails rotate slides),
       * so a caption spun edge-on still measures full width. That blindness is
       * why spinning topologies shipped with unreadable captions.
       */
      labelFacing: () => {
        // Billboards are screen-aligned (parallel to the view plane), so the
        // metric is the label normal against the camera's own forward axis —
        // NOT against the direction to the label, which undershoots off-axis.
        const camForward = new THREE.Vector3();
        rig.camera.getWorldDirection(camForward);
        const q = new THREE.Quaternion();
        const labelDir = new THREE.Vector3();
        return (builds[cur].diagram?.labels ?? []).map((label) => {
          const o = label.object as THREE.Object3D;
          labelDir.set(0, 0, 1).applyQuaternion(o.getWorldQuaternion(q));
          return -labelDir.dot(camForward);
        });
      },
      /**
       * Backdrop objects whose subtree escaped onto the content layer. An
       * effect that `add()`s children during `tick` gets the default layer, and
       * those children CAN cover the text — the one hole the two-pass render
       * cannot close by construction. `check` turns this into a finding.
       */
      backdropLeaks: () => {
        const leaked: string[] = [];
        const scan = (root: THREE.Object3D | undefined, owner: string): void => {
          if (!root) return;
          root.traverse((n) => {
            if (!n.userData.backdrop && !leaked.includes(owner)) leaked.push(owner);
          });
        };
        scan(builds[cur].background?.g, "scene-background");
        for (const [i, h] of builds[cur].localFx.entries()) scan(h.object as THREE.Object3D | undefined, localFxIds[cur]?.[i] ?? `local[${i}]`);
        return leaked;
      },
      /** Fingerprint of the current slide's animated transforms, for motion probes. */
      motion: () => {
        const parts: number[] = [];
        const walk = (o: THREE.Object3D | undefined): void => {
          if (!o) return;
          o.traverse((n) => {
            parts.push(n.position.x, n.position.y, n.position.z, n.rotation.y);
            // Most fx animate by rewriting instance matrices, not node
            // transforms; without this the probe reports a busy InstancedMesh
            // background as motionless.
            const inst = (n as THREE.InstancedMesh).instanceMatrix;
            if (inst) parts.push(inst.version, inst.array[12] ?? 0, inst.array[13] ?? 0, inst.array[14] ?? 0);
          });
        };
        walk(builds[cur].diagram?.g);
        walk(builds[cur].background?.g);
        for (const h of builds[cur].localFx) walk(h.object as THREE.Object3D | undefined);
        return parts.map((n) => Math.round(n * 1e4) / 1e4).join(",");
      },
      /**
       * Local-effect liveness, scoped: `motion()` mixes in the diagram and the
       * corpus background, so a dead local handle hides behind them. Reports
       * one entry per live handle with a transform digest.
       */
      localFx: () =>
        builds[cur].localFx.map((h, i) => {
          const parts: number[] = [];
          (h.object as THREE.Object3D | undefined)?.traverse((n) => {
            parts.push(n.position.x, n.position.y, n.position.z, n.rotation.x, n.rotation.y, n.rotation.z);
            const inst = (n as THREE.InstancedMesh).instanceMatrix;
            if (inst) parts.push(inst.version, inst.array[12] ?? 0, inst.array[13] ?? 0, inst.array[14] ?? 0);
          });
          return { id: localFxIds[cur]?.[i] ?? `local[${i}]`, digest: parts.map((n) => Math.round(n * 1e4) / 1e4).join(",") };
        }),
      /**
       * Descendant count of the current slide group. Catches orphans that
       * `motion()`/`localFx()` structurally cannot see: both walk LIVE
       * handles, while a leaked node is one nothing references any more.
       */
      /** Live local-fx handle count per slide index — `localFx()` only sees `cur`. */
      localFxAt: (index: number) => builds[index]?.localFx.length ?? 0,
      sceneNodes: () => {
        let n = 0;
        builds[cur].group.traverse(() => n++);
        return n;
      },
      post: () => rig.postProbe(),
      anchors: () =>
        builds.map((b) => ({ pos: [b.group.position.x, b.group.position.y, b.group.position.z] as [number, number, number], rotY: b.group.rotation.y })),
      /**
       * Scene-side look, read from the live objects rather than from the
       * config that was *meant* to produce them. Configurator tests assert
       * on this so a control that stages a value without reaching the frame
       * still fails.
       */
      look: () => {
        const hex = (c: THREE.Color | undefined): string => (c ? `#${c.getHexString()}` : "");
        const title = builds[cur].labels.find((l) => l.kind === "title");
        let titleColor: THREE.Color | undefined;
        title?.object.traverse((o) => {
          const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
          if (!titleColor && mat?.color) titleColor = mat.color;
        });
        return {
          bg: hex(rig.scene.background as THREE.Color | undefined),
          fog: hex(rig.scene.fog instanceof THREE.Fog ? rig.scene.fog.color : undefined),
          rim: hex(rig.rimColor()),
          title: hex(titleColor),
          camZ: rig.camera.position.z,
          // Full camera + its target: the rail runs on X, so `camZ` alone
          // cannot tell a settled camera from one still travelling.
          cam: rig.camera.position.toArray() as [number, number, number],
          camTarget: camState.target.toArray() as [number, number, number],
          anim: anim === null ? null : { mode: anim.mode, t: anim.t, dur: anim.dur },
          floor: rig.floorMode(),
        };
      },
    },
    current: () => cur + 1,
  };
  poseAt(0);
  window.__deck3d = api;
  frame();
}

void boot();
