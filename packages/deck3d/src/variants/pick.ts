/**
 * `variants pick | note | replay` (spec deck3d-variant-loop "Pick, ownership
 * and replay"). A pick deep-merges a variant's fragment into `deck.json`
 * overrides under the rules of `overrides apply`, behind two guards:
 *
 *  - VALIDATION: the merged deck must validate and every effect param must be
 *    in range — otherwise neither file changes.
 *  - OWNERSHIP: arrays replace on merge, so a fragment that restates an
 *    `effects` / `props` list can silently drop entries other writers put
 *    there. Every id present in the live deck on a scope the fragment
 *    replaces must still be present, unless `--drop <id>` names it or
 *    `--replace-step <step>` names the earlier step that introduced it.
 *
 * Writes are three atomic renames: style.json `pending: true` → deck.json →
 * style.json final. A crash in between leaves `pending: true`, which every
 * variants command reports.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { validateEffectParams } from "../fx/compose.js";
import { deepMerge } from "../ir/merge.js";
import type { DeckIR } from "../ir/types.js";
import { formatIssue, validate } from "../ir/validate.js";
import { interruptedMessage, LockError, pendingStep, readStyle, type Step, type Style, serialize, stylePath, withStyleLock, writeAtomic } from "./style.js";

export class PickError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PickError";
  }
}

type Json = Record<string, unknown>;

/** `scope path → ids` of every effect/prop list an overrides object carries. */
export function listScopes(overrides: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const o = (overrides ?? {}) as Json;
  const ids = (list: unknown, key: string): string[] | undefined =>
    Array.isArray(list) ? list.map((e) => String((e as Json)[key] ?? "")).filter(Boolean) : undefined;
  const eff = ids(o.effects, "id");
  if (eff) out.set("overrides.effects", eff);
  const props = ids(o.props, "id");
  if (props) out.set("overrides.props", props);
  for (const [slide, ov] of Object.entries((o.slides ?? {}) as Record<string, Json>)) {
    const e = ids(ov?.effects, "id");
    if (e) out.set(`overrides.slides["${slide}"].effects`, e);
  }
  return out;
}

/** True when a picked step AFTER `index` lists `id` on `scope` in its fragment. */
function laterPicksList(style: Style, index: number, scope: string, id: string): boolean {
  return style.steps.slice(index + 1).some((s) => {
    const picked = s.variants.find((v) => v.name === s.picked);
    return !!picked && listScopes(picked.overrides).get(scope)?.includes(id) === true;
  });
}

/** Who put `id` on `scope`: the earliest picked step (before `current`) whose fragment lists it. */
function introducedBy(style: Style, current: number, scope: string, id: string): string | undefined {
  for (let i = 0; i < current; i++) {
    const step = style.steps[i];
    const picked = step.variants.find((v) => v.name === step.picked);
    if (picked && listScopes(picked.overrides).get(scope)?.includes(id)) return step.id;
  }
  return undefined;
}

export interface GuardOptions {
  drop: string[];
  replaceStep?: string;
  /**
   * Replay only: true when a LATER picked step lists `id` on `scope`. Replay
   * starts from the live deck, which already holds that later step's effect;
   * an earlier fragment that omits it is not dropping it — the later step
   * re-adds it when its turn comes.
   */
  restoredLater?: (scope: string, id: string) => boolean;
}

/** Ownership conflicts of merging `fragment` into `overrides` as step `index` of `style`. */
export function ownershipConflicts(style: Style, index: number, overrides: unknown, fragment: unknown, opts: GuardOptions): string[] {
  const live = listScopes(overrides);
  const conflicts: string[] = [];
  const self = style.steps[index]?.id;
  for (const [scope, next] of listScopes(fragment)) {
    for (const id of live.get(scope) ?? []) {
      if (next.includes(id)) continue;
      if (opts.drop.includes(id)) continue;
      if (opts.restoredLater?.(scope, id)) continue;
      const owner = introducedBy(style, index, scope, id);
      // Re-picking the SAME step replaces its own earlier effects; `--replace-step` names another.
      if (owner !== undefined && (owner === opts.replaceStep || owner === self)) continue;
      const from = owner ? `step ${owner}` : "the configurator or a hand edit";
      conflicts.push(`${scope}: would remove '${id}' (added by ${from}); carry it forward in the fragment, or pass --drop ${id}${owner ? ` / --replace-step ${owner}` : ""}`);
    }
  }
  return conflicts;
}

function loadDeck(jsonPath: string): DeckIR {
  return JSON.parse(readFileSync(jsonPath, "utf8")) as DeckIR;
}

/** Validation errors of a merged deck, one line each (empty when it is fine). */
export function mergedErrors(merged: DeckIR, deckDir: string): string[] {
  const result = validate(merged, { deckDir });
  const errors = result.errors.map((e) => formatIssue("error", e));
  if (!errors.length) for (const v of validateEffectParams(merged)) errors.push(`error ${v.path}: ${v.message}`);
  return errors;
}

export interface PickHooks {
  /** Called after the pending marker and after deck.json are written (tests throw to simulate a crash). */
  afterWrite?: (phase: "pending" | "deck") => void;
  now?: () => Date;
}

export interface PickOptions {
  deckJson: string;
  step: string;
  name: string;
  note?: string;
  drop?: string[];
  replaceStep?: string;
  hooks?: PickHooks;
}

function stepIndex(style: Style, id: string): number {
  const i = style.steps.findIndex((s) => s.id === id);
  if (i < 0) throw new PickError(`unknown step '${id}' (steps: ${style.steps.map((s) => s.id).join(", ") || "none"})`);
  return i;
}

export function requireStyle(deckJson: string): { style: Style; path: string } {
  const path = stylePath(dirname(deckJson));
  const style = readStyle(path);
  if (!style) throw new PickError(`no style.json beside ${deckJson}`);
  const pending = pendingStep(style);
  if (pending) throw new PickError(interruptedMessage(pending));
  return { style, path };
}

export function pickVariant(opts: PickOptions): void {
  withStyleLock(dirname(opts.deckJson), () => pick(opts));
}

function pick(opts: PickOptions): void {
  const deckDir = dirname(opts.deckJson);
  const path = stylePath(deckDir);
  const style = readStyle(path);
  if (!style) throw new PickError(`no style.json beside ${opts.deckJson}`);
  const idx = stepIndex(style, opts.step);
  const step = style.steps[idx];
  // A pending marker on THIS step is the re-run the message asks for; any other step's is not.
  const other = style.steps.find((s) => s.pending && s.id !== step.id);
  if (other) throw new PickError(interruptedMessage(other));
  const variant = step.variants.find((v) => v.name === opts.name);
  if (!variant) throw new PickError(`step '${step.id}' has no variant '${opts.name}' (one of ${step.variants.map((v) => v.name).join(", ")})`);

  const deck = loadDeck(opts.deckJson);
  const drop = opts.drop ?? [];
  const conflicts = ownershipConflicts(style, idx, deck.overrides, variant.overrides, { drop, replaceStep: opts.replaceStep });
  if (conflicts.length) throw new PickError(conflicts.join("\n"));
  const merged: DeckIR = { ...deck, overrides: deepMerge(deck.overrides ?? {}, variant.overrides) as DeckIR["overrides"] };
  const errors = mergedErrors(merged, deckDir);
  if (errors.length) throw new PickError(errors.join("\n"));

  const hooks = opts.hooks ?? {};
  step.pending = true;
  writeAtomic(path, serialize(style));
  hooks.afterWrite?.("pending");
  writeAtomic(opts.deckJson, serialize(merged));
  hooks.afterWrite?.("deck");
  step.picked = variant.name;
  step.pickedAt = (hooks.now?.() ?? new Date()).toISOString();
  step.pending = false;
  if (opts.note !== undefined) step.note = opts.note;
  if (drop.length) step.drop = drop;
  else delete step.drop;
  if (opts.replaceStep) step.replaceStep = opts.replaceStep;
  else delete step.replaceStep;
  writeAtomic(path, serialize(style));
}

/** Record a free-text answer: `picked: null`, the note, and a new round. */
export function noteStep(deckJson: string, stepId: string, note: string): Step {
  return withStyleLock(dirname(deckJson), () => note_(deckJson, stepId, note));
}

function note_(deckJson: string, stepId: string, note: string): Step {
  const { style, path } = requireStyle(deckJson);
  const step = style.steps[stepIndex(style, stepId)];
  step.picked = null;
  step.note = note;
  step.round += 1;
  delete step.pickedAt;
  delete step.drop;
  delete step.replaceStep;
  writeAtomic(path, serialize(style));
  return step;
}

export interface ReplayResult {
  applied: string[];
  /** Fragment keys that reference a slide or layout item no longer present. */
  orphans: string[];
  changed: boolean;
}

const ITEM_ID = /^s\d+-i\d+$/;

function layoutItemIds(deckDir: string): Set<string> | undefined {
  const file = join(deckDir, "pptx", "layout.json");
  if (!existsSync(file)) return undefined;
  const layout = JSON.parse(readFileSync(file, "utf8")) as { slides?: Array<{ items?: Array<{ id: string }> }> };
  return new Set((layout.slides ?? []).flatMap((s) => (s.items ?? []).map((i) => i.id)));
}

function collectItemRefs(v: unknown, out: Set<string>): void {
  if (typeof v === "string") {
    if (ITEM_ID.test(v)) out.add(v);
  } else if (Array.isArray(v)) for (const x of v) collectItemRefs(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (ITEM_ID.test(k)) out.add(k);
      collectItemRefs(x, out);
    }
  }
}

/** Re-apply every picked fragment in step order; idempotent, writes only on change. */
export function replayPicks(deckJson: string): ReplayResult {
  return withStyleLock(dirname(deckJson), () => replay(deckJson));
}

function replay(deckJson: string): ReplayResult {
  const { style } = requireStyle(deckJson);
  const deckDir = dirname(deckJson);
  const before = readFileSync(deckJson, "utf8");
  const deck = JSON.parse(before) as DeckIR;
  const slideIds = new Set(deck.slides.map((s) => s.id));
  const items = layoutItemIds(deckDir);
  const orphans: string[] = [];
  const applied: string[] = [];
  let overrides: unknown = deck.overrides ?? {};
  style.steps.forEach((step, idx) => {
    if (typeof step.picked !== "string") return;
    const variant = step.variants.find((v) => v.name === step.picked);
    if (!variant) return;
    const conflicts = ownershipConflicts(style, idx, overrides, variant.overrides, {
      drop: step.drop ?? [],
      replaceStep: step.replaceStep,
      restoredLater: (scope, id) => laterPicksList(style, idx, scope, id),
    });
    if (conflicts.length) throw new PickError(`replay of step '${step.id}': ${conflicts.join("\n")}`);
    overrides = deepMerge(overrides as Json, variant.overrides);
    applied.push(step.id);
    for (const sid of Object.keys(((variant.overrides as Json).slides ?? {}) as Json)) {
      if (!slideIds.has(sid)) orphans.push(`step ${step.id}: overrides.slides["${sid}"] references a slide missing from the deck`);
    }
    if (items) {
      const refs = new Set<string>();
      collectItemRefs(variant.overrides, refs);
      for (const id of [...refs].sort()) if (!items.has(id)) orphans.push(`step ${step.id}: item '${id}' is missing from the current layout`);
    }
  });
  const merged: DeckIR = { ...deck, overrides: overrides as DeckIR["overrides"] };
  const errors = mergedErrors(merged, deckDir);
  if (errors.length) throw new PickError(errors.join("\n"));
  const next = serialize(merged);
  const changed = next !== before;
  if (changed) writeAtomic(deckJson, next);
  return { applied, orphans, changed };
}
