/**
 * On-deck configurator (design D4).
 *
 * A DOM overlay, hidden by default, that drives the live scene and exports an
 * `overrides.json` in the D1 grammar. It NEVER mutates `window.__DECK`: the
 * embedded IR stays the record of what was rendered, and the panel's state
 * lives in memory plus `localStorage["deck3d:" + derivedHash]`.
 */
import type { Defaults, EffectRef, Mode, Palette, Quality } from "../ir/types.js";

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
  transition?: string;
  durationSec?: number;
  backgroundIntensity?: number;
  camera?: { distance?: number };
  labels?: { size?: number };
}

type Scope = "deck" | "slide";

/** Panel state, mirrored to local storage. Only what the user actually changed. */
export interface HudState {
  deck: Record<string, unknown>;
  slides: Record<string, Record<string, unknown>>;
  autoplaySec: number;
}

const DECK_CONTROLS = ["mode", "palette", "quality", "transition", "durationSec", "backgroundIntensity"] as const;
const SLIDE_CONTROLS = ["mode", "palette", "quality", "camera.distance", "labels.size", "backgroundIntensity"] as const;

const PALETTES: Palette[] = ["blackbelt", "zenit", "dapp", "midnight", "ember", "arctic", "forest", "mono", "neon", "custom"];
const MODES: Mode[] = ["dark", "light"];
const QUALITIES: Quality[] = ["low", "medium", "high"];
const TRANSITIONS = ["dolly", "fade", "iris", "flythrough", "cut"];

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

function loadState(hash: string): HudState {
  const empty: HudState = { deck: {}, slides: {}, autoplaySec: 0 };
  try {
    const raw = localStorage.getItem(storageKey(hash));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<HudState>;
    return { deck: parsed.deck ?? {}, slides: parsed.slides ?? {}, autoplaySec: parsed.autoplaySec ?? 0 };
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
    return { toggle: noop, close: noop, isOpen: () => false, hasFocus: () => false, contains: () => false, refresh: noop, state: () => ({ deck: {}, slides: {}, autoplaySec: 0 }) };
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

  function addRow(label: string, control: HTMLElement, marked: boolean): void {
    const row = el("label", { class: "deck3d-hud-row" });
    const name = el("span");
    name.textContent = marked ? `● ${label}` : label;
    row.append(name, control);
    body.appendChild(row);
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

    const controls = scope === "deck" ? DECK_CONTROLS : SLIDE_CONTROLS;
    for (const path of controls) {
      const marked = isOverridden(path, slideId);
      if (path === "mode") addRow(path, select(path, MODES, slideId), marked);
      else if (path === "palette") addRow(path, select(path, PALETTES, slideId), marked);
      else if (path === "quality") addRow(path, select(path, QUALITIES, slideId), marked);
      else if (path === "transition") addRow(path, select(path, TRANSITIONS, slideId), marked);
      else addRow(path, number(path, slideId), marked);
    }

    if (scope === "deck") addRow("autoplay (s)", autoplayField(), false);
    body.appendChild(effectsChecklist(slideId));

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
