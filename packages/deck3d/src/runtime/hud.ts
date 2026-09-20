/**
 * On-deck configurator (design D4).
 *
 * A DOM overlay, hidden by default, that drives the live scene and exports an
 * `overrides.json` in the D1 grammar. It NEVER mutates `window.__DECK`: the
 * embedded IR stays the record of what was rendered, and the panel's state
 * lives in memory plus `localStorage["deck3d:" + derivedHash]`.
 */
import type { BuiltDiagramKind, CardOffset, Defaults, EffectRef, Layout, Material, Mode, Palette, Quality, Rail } from "../ir/types.js";

export interface HudSlide {
  id: string;
  title: string;
  effects: EffectRef[];
}

export interface HudHost {
  slides: HudSlide[];
  /** Deck defaults as embedded (read-only). */
  defaults: Defaults;
  /** Keys already overridden, for the `●` markers. */
  overridden: { deck: Set<string>; slides: Record<string, Set<string>> };
  derivedHash: string;
  current: () => number;
  gotoSlide: (index1Based: number) => void;
  /** Re-apply look/camera/label knobs for the current slide. */
  applySlide: (patch: SlidePatch) => void;
  /** Recompose the current slide's effects from this list. */
  applyEffects: (ids: string[]) => void;
}

export interface SlidePatch {
  mode?: Mode;
  palette?: Palette;
  quality?: Quality;
  material?: Material;
  transition?: string;
  durationSec?: number;
  backgroundIntensity?: number;
  bloom?: boolean;
  rimLight?: boolean;
  fog?: boolean;
  mirrorFloor?: boolean;
  softShadows?: boolean;
  envReflections?: boolean;
  depthRelief?: number;
  extrudeDepth?: number;
  colors?: { card?: string; accent?: string; secondary?: string };
  layout?: Layout;
  /** Deck-level: moves EVERY anchor, so the runtime re-anchors the whole rail. */
  rail?: Rail;
  spacing?: number;
  cardOffset?: CardOffset;
  /** Slide-level lane: layered onto a COPY of the slide, never onto `__DECK`. */
  scene?: string;
  diagram?: { kind?: BuiltDiagramKind; scale?: number; offset?: { x?: number; y?: number } };
  camera?: { distance?: number };
  labels?: { size?: number };
}

type Scope = "deck" | "slide";

/** Panel state, mirrored to local storage. Only what the user actually changed. */
export interface HudState {
  deck: Record<string, unknown>;
  slides: Record<string, Record<string, unknown>>;
  autoplaySec: number;
  /** Block title → open. Persisted so the panel reopens where it was left. */
  open: Record<string, boolean>;
}

const PALETTES: Palette[] = ["blackbelt", "zenit", "dapp", "midnight", "ember", "arctic", "forest", "mono", "neon", "custom"];
const MODES: Mode[] = ["dark", "light"];
const QUALITIES: Quality[] = ["low", "medium", "high"];
const MATERIALS: Material[] = ["glass", "metal", "matte"];
const LAYOUTS: Layout[] = ["split", "split-reverse"];
const RAILS: Rail[] = ["line", "orbit", "tunnel", "helix", "grid"];
const DIAGRAM_KINDS: BuiltDiagramKind[] = ["none", "brain", "loop", "swarm", "bars", "funnel", "timeline-rail", "globe", "orbit-cluster", "stack"];
const TRANSITIONS = ["dolly", "fade", "iris", "flythrough", "cut"];

/** How one control is rendered. `enum` carries its own option list. */
type ControlSpec =
  | { path: string; kind: "enum"; options: readonly string[] }
  | { path: string; kind: "number"; step?: string }
  | { path: string; kind: "bool" }
  | { path: string; kind: "colour" }
  | { path: string; kind: "autoplay" }
  | { path: string; kind: "effects" };

interface Block {
  title: string;
  /** Which scope(s) the control belongs to; a block with none is omitted. */
  deck: ControlSpec[];
  slide: ControlSpec[];
}

const enumC = (path: string, options: readonly string[]): ControlSpec => ({ path, kind: "enum", options });
const numC = (path: string, step?: string): ControlSpec => ({ path, kind: "number", step });
const boolC = (path: string): ControlSpec => ({ path, kind: "bool" });
const colourC = (path: string): ControlSpec => ({ path, kind: "colour" });

const LOOK: ControlSpec[] = [
  enumC("mode", MODES),
  enumC("palette", PALETTES),
  colourC("colors.card"),
  colourC("colors.accent"),
  colourC("colors.secondary"),
  enumC("material", MATERIALS),
];
const LIGHTING: ControlSpec[] = [
  boolC("bloom"),
  boolC("rimLight"),
  boolC("fog"),
  boolC("mirrorFloor"),
  boolC("softShadows"),
  boolC("envReflections"),
  numC("backgroundIntensity", "0.05"),
];
const CAMERA: ControlSpec[] = [numC("camera.distance"), numC("labels.size", "0.02"), numC("depthRelief"), numC("extrudeDepth", "0.02")];

/**
 * The panel's control plane. Order is the render order; a block whose list for
 * the active scope is empty is not rendered at all, so deck scope never shows a
 * `diagram.*` row and slide scope never shows `spacing`.
 */
const BLOCKS: Block[] = [
  { title: "Look", deck: LOOK, slide: LOOK },
  { title: "Lighting & FX", deck: LIGHTING, slide: LIGHTING },
  { title: "Camera & labels", deck: CAMERA, slide: CAMERA },
  {
    title: "Layout",
    // `rail`/`spacing` describe the rail the slides hang on — deck-wide by
    // definition. `diagram.*`/`cardOffset` tune one slide's composition.
    deck: [enumC("layout", LAYOUTS), enumC("rail", RAILS), numC("spacing", "5")],
    slide: [
      enumC("layout", LAYOUTS),
      enumC("diagram.kind", DIAGRAM_KINDS),
      numC("diagram.scale", "0.05"),
      numC("diagram.offset.x"),
      numC("diagram.offset.y"),
      numC("cardOffset.x"),
      numC("cardOffset.y"),
    ],
  },
  {
    title: "Motion",
    deck: [enumC("transition", TRANSITIONS), numC("durationSec"), { path: "autoplay", kind: "autoplay" }],
    slide: [enumC("transition", TRANSITIONS)],
  },
  { title: "Quality", deck: [enumC("quality", QUALITIES)], slide: [enumC("quality", QUALITIES)] },
  { title: "Effects", deck: [{ path: "effects", kind: "effects" }], slide: [{ path: "effects", kind: "effects" }] },
];

export const AUTOPLAY_MIN = 1;
export const AUTOPLAY_MAX = 600;

/** `1`–`600` integer seconds, or `0` for off. Anything else is rejected. */
export function parseAutoplay(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  if (!/^\d+$/.test(raw.trim())) return undefined;
  const n = Number(raw.trim());
  if (n === 0) return 0;
  return n >= AUTOPLAY_MIN && n <= AUTOPLAY_MAX ? n : undefined;
}

function storageKey(hash: string): string {
  return `deck3d:${hash}`;
}

/** Only the first block starts open; the rest are one click away. */
function defaultOpen(): Record<string, boolean> {
  return Object.fromEntries(BLOCKS.map((b, i) => [b.title, i === 0]));
}

function loadState(hash: string): HudState {
  const empty: HudState = { deck: {}, slides: {}, autoplaySec: 0, open: defaultOpen() };
  try {
    const raw = localStorage.getItem(storageKey(hash));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<HudState>;
    return {
      deck: parsed.deck ?? {},
      slides: parsed.slides ?? {},
      autoplaySec: parsed.autoplaySec ?? 0,
      open: { ...defaultOpen(), ...(parsed.open ?? {}) },
    };
  } catch {
    return empty;
  }
}

function saveState(hash: string, state: HudState): void {
  try {
    localStorage.setItem(storageKey(hash), JSON.stringify(state));
  } catch {
    // Storage may be unavailable (private mode, file:// with strict settings).
    // The panel still works for the session; persistence is a convenience.
  }
}

/** Dotted path get on a plain object (`camera.distance`). */
function at(obj: Record<string, unknown> | undefined, path: string): unknown {
  let node: unknown = obj;
  for (const part of path.split(".")) {
    if (node === undefined || node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Dotted path set, creating intermediate objects (`camera.distance`). */
function setAt(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = obj;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts.at(-1) as string] = value;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** The control's current effective value: panel state, else the embedded IR. */
function effectiveValue(state: HudState, scope: Scope, slideId: string, path: string, defaults: Defaults): unknown {
  const staged = scope === "deck" ? at(state.deck, path) : at(state.slides[slideId], path);
  return staged ?? at(defaults as unknown as Record<string, unknown>, path);
}

export interface Hud {
  toggle: () => void;
  close: () => void;
  isOpen: () => boolean;
  /** True while a panel input holds focus (navigation must stand down). */
  hasFocus: () => boolean;
  /** True when the event happened inside the panel (no slide advance). */
  contains: (target: EventTarget | null) => boolean;
  /** Re-render the panel for the current slide. */
  refresh: () => void;
  state: () => HudState;
}

/**
 * Build the panel. Returns handles the runtime uses to keep navigation and the
 * panel from fighting each other.
 */
export function createHud(host: HudHost): Hud {
  const rootEl = document.getElementById("deck3d-hud");
  const gearEl = document.getElementById("deck3d-hud-toggle");
  if (!rootEl || !gearEl) {
    const noop = (): void => {};
    return { toggle: noop, close: noop, isOpen: () => false, hasFocus: () => false, contains: () => false, refresh: noop, state: () => ({ deck: {}, slides: {}, autoplaySec: 0, open: {} }) };
  }
  const root = rootEl;
  const gear = gearEl;

  const state = loadState(host.derivedHash);
  let scope: Scope = "deck";
  let open = false;
  let autoplayTimer: number | undefined;

  const body = el("div", { id: "deck3d-hud-body" });
  root.appendChild(body);

  function persist(): void {
    saveState(host.derivedHash, state);
  }

  function stage(path: string, value: unknown): void {
    const slideId = host.slides[host.current() - 1]?.id ?? "";
    if (scope === "deck") setAt(state.deck, path, value);
    else {
      state.slides[slideId] = state.slides[slideId] ?? {};
      setAt(state.slides[slideId], path, value);
    }
    persist();
    host.applySlide(patchForCurrent());
  }

  /** Deck-scope staged values with the current slide's staged values on top. */
  function patchForCurrent(): SlidePatch {
    const slideId = host.slides[host.current() - 1]?.id ?? "";
    return { ...(state.deck as SlidePatch), ...(state.slides[slideId] as SlidePatch | undefined) };
  }

  function isOverridden(path: string, slideId: string): boolean {
    return scope === "deck" ? host.overridden.deck.has(path) : (host.overridden.slides[slideId]?.has(path) ?? false);
  }

  function addRow(parent: HTMLElement, label: string, control: HTMLElement, marked: boolean): void {
    const row = el("label", { class: "deck3d-hud-row" });
    const name = el("span");
    name.textContent = marked ? `● ${label}` : label;
    row.append(name, control);
    parent.appendChild(row);
  }

  function checkbox(path: string, slideId: string): HTMLInputElement {
    const node = el("input", { type: "checkbox", "data-path": path });
    // Every boolean knob in the IR defaults to ON when absent.
    node.checked = (effectiveValue(state, scope, slideId, path, host.defaults) ?? true) !== false;
    node.addEventListener("change", () => stage(path, node.checked));
    return node;
  }

  function colour(path: string, slideId: string): HTMLInputElement {
    const current = effectiveValue(state, scope, slideId, path, host.defaults);
    const node = el("input", { type: "color", "data-path": path });
    node.value = typeof current === "string" && /^#[0-9a-f]{6}$/i.test(current) ? current : "#000000";
    // `colors` only takes effect under `palette: custom`; staging the colour
    // without the palette would look like a dead control.
    node.addEventListener("change", () => {
      stage("palette", "custom");
      stage(path, node.value);
    });
    return node;
  }

  /** One collapsible block; returns null when it has nothing for this scope. */
  function renderBlock(block: Block, slideId: string): HTMLElement | null {
    const controls = scope === "deck" ? block.deck : block.slide;
    if (!controls.length) return null;
    const details = el("details", { class: "deck3d-hud-block", "data-block": block.title });
    if (state.open[block.title]) details.setAttribute("open", "");
    const summary = el("summary");
    summary.textContent = block.title;
    details.appendChild(summary);
    details.addEventListener("toggle", () => {
      state.open[block.title] = details.hasAttribute("open");
      persist();
    });

    for (const spec of controls) {
      const marked = isOverridden(spec.path, slideId);
      if (spec.kind === "enum") addRow(details, spec.path, select(spec.path, spec.options, slideId), marked);
      else if (spec.kind === "number") addRow(details, spec.path, number(spec.path, slideId, spec.step ?? "0.1"), marked);
      else if (spec.kind === "bool") addRow(details, spec.path, checkbox(spec.path, slideId), marked);
      else if (spec.kind === "colour") addRow(details, spec.path, colour(spec.path, slideId), marked);
      else if (spec.kind === "autoplay") addRow(details, "autoplay (s)", autoplayField(), false);
      else details.appendChild(effectsChecklist(slideId));
    }
    return details;
  }

  function select(path: string, options: readonly string[], slideId: string): HTMLSelectElement {
    const node = el("select", { "data-path": path });
    for (const option of options) {
      const opt = el("option", { value: option });
      opt.textContent = option;
      node.appendChild(opt);
    }
    node.value = String(effectiveValue(state, scope, slideId, path, host.defaults) ?? options[0]);
    node.addEventListener("change", () => stage(path, node.value));
    return node;
  }

  function number(path: string, slideId: string, step = "0.1"): HTMLInputElement {
    const node = el("input", { type: "number", step, "data-path": path });
    const value = effectiveValue(state, scope, slideId, path, host.defaults);
    node.value = value === undefined ? "" : String(value);
    node.addEventListener("change", () => {
      const n = Number(node.value);
      if (Number.isFinite(n)) stage(path, n);
    });
    return node;
  }

  function effectsChecklist(slideId: string): HTMLElement {
    const list = el("div", { class: "deck3d-hud-effects" });
    const composed = host.slides[host.current() - 1]?.effects ?? [];
    const staged = (scope === "deck" ? state.deck.effects : state.slides[slideId]?.effects) as string[] | undefined;
    const enabled = new Set(staged ?? composed.map((e) => e.id));
    for (const ref of composed) {
      const row = el("label", { class: "deck3d-hud-effect" });
      const box = el("input", { type: "checkbox", "data-effect": ref.id });
      box.checked = enabled.has(ref.id);
      box.addEventListener("change", () => {
        // Order is preserved: the export pins the whole list for this scope.
        const next = composed.map((e) => e.id).filter((id) => (id === ref.id ? box.checked : enabled.has(id)));
        if (box.checked) enabled.add(ref.id);
        else enabled.delete(ref.id);
        if (scope === "deck") state.deck.effects = next;
        else {
          state.slides[slideId] = state.slides[slideId] ?? {};
          state.slides[slideId].effects = next;
        }
        persist();
        host.applyEffects(next);
      });
      const name = el("span");
      name.textContent = ref.id;
      row.append(box, name);
      list.appendChild(row);
    }
    return list;
  }

  function autoplayField(): HTMLInputElement {
    const node = el("input", { type: "text", id: "deck3d-hud-autoplay" });
    node.value = String(state.autoplaySec);
    node.addEventListener("change", () => {
      const parsed = parseAutoplay(node.value);
      if (parsed === undefined) {
        // Reject: restore the last accepted value rather than half-applying.
        node.value = String(state.autoplaySec);
        return;
      }
      state.autoplaySec = parsed;
      persist();
      restartAutoplay();
    });
    return node;
  }

  function restartAutoplay(): void {
    if (autoplayTimer !== undefined) window.clearInterval(autoplayTimer);
    autoplayTimer = undefined;
    if (state.autoplaySec <= 0) return;
    autoplayTimer = window.setInterval(() => {
      const next = host.current() + 1;
      host.gotoSlide(next > host.slides.length ? 1 : next);
    }, state.autoplaySec * 1000);
  }

  function exportOverrides(): void {
    const payload: Record<string, unknown> = {};
    const deck = { ...state.deck };
    const deckEffects = deck.effects as string[] | undefined;
    delete deck.effects;
    if (Object.keys(deck).length) payload.deck = deck;
    if (deckEffects) payload.effects = deckEffects.map((id) => ({ id }));

    const slides: Record<string, unknown> = {};
    for (const [id, staged] of Object.entries(state.slides)) {
      const entry = { ...staged };
      const effects = entry.effects as string[] | undefined;
      delete entry.effects;
      if (effects) entry.effects = effects.map((eid) => ({ id: eid }));
      if (Object.keys(entry).length) slides[id] = entry;
    }
    if (Object.keys(slides).length) payload.slides = slides;

    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "overrides.json" });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function render(): void {
    body.replaceChildren();
    const index = host.current();
    const slideId = host.slides[index - 1]?.id ?? "";

    const counter = el("div", { id: "deck3d-hud-counter" });
    counter.textContent = `${index} / ${host.slides.length}`;
    body.appendChild(counter);

    const scopes = el("div", { class: "deck3d-hud-scopes" });
    for (const s of ["deck", "slide"] as const) {
      const button = el("button", { type: "button", "data-scope": s });
      button.textContent = s === "deck" ? "Deck" : "This slide";
      button.className = scope === s ? "active" : "";
      button.addEventListener("click", () => {
        scope = s;
        render();
      });
      scopes.appendChild(button);
    }
    body.appendChild(scopes);

    for (const block of BLOCKS) {
      const node = renderBlock(block, slideId);
      if (node) body.appendChild(node);
    }

    const notice = el("div", { class: "deck3d-hud-note" });
    notice.textContent =
      "Export writes overrides.json. Markdown inline overrides win over this file, and an exported effects list pins that scope's effects.";
    body.appendChild(notice);

    const exportButton = el("button", { type: "button", id: "deck3d-hud-export" });
    exportButton.textContent = "Export overrides.json";
    exportButton.addEventListener("click", exportOverrides);
    body.appendChild(exportButton);
  }

  function setOpen(next: boolean): void {
    open = next;
    root.style.display = open ? "block" : "none";
    if (open) render();
  }

  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!open);
  });
  root.addEventListener("click", (e) => e.stopPropagation());
  root.addEventListener("pointerup", (e) => e.stopPropagation());

  setOpen(false);
  restartAutoplay();

  return {
    toggle: () => setOpen(!open),
    close: () => setOpen(false),
    isOpen: () => open,
    hasFocus: () => root.contains(document.activeElement),
    contains: (target) => target instanceof Node && (root.contains(target) || gear.contains(target)),
    refresh: () => {
      if (open) render();
    },
    state: () => state,
  };
}
