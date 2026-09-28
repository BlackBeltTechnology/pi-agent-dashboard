/**
 * Pure helpers for the settings section: backend usability, compatibility per
 * consumer, override seeding, chain edits. Egress classification comes from
 * the server (`BackendView.offMachine`) — the client never classifies itself
 * (spec: system-one-settings-ui; design D13).
 * See change: add-system-one-registry.
 */
import type { ConsumerDeclaration } from "@blackbelt-technology/pi-system-one";
import { incompatReasons } from "@blackbelt-technology/pi-system-one/capabilities";
import type { BackendView, Draft } from "./api.js";

export type Unusable = "off-machine" | "not-saved" | "runtime" | null;

/** Why `id` cannot be used right now, or null when usable. */
export function unusableReason(id: string, draft: Draft, views: Record<string, BackendView>): Unusable {
  const v = views[id];
  if (!v) return draft.allowOffMachine ? null : "not-saved";
  if (v.offMachine && !draft.allowOffMachine) return "off-machine";
  const st = v.managed?.state;
  if (st === "unavailable" || st === "unsupported-platform") return "runtime";
  return null;
}

export const isUsable = (id: string, draft: Draft, views: Record<string, BackendView>) => unusableReason(id, draft, views) === null;

export function incompatibleWith(consumer: ConsumerDeclaration, id: string, views: Record<string, BackendView>): string[] {
  const v = views[id];
  return v ? incompatReasons(v.capabilities, consumer.requires) : [];
}

/** A new override starts as the preset chain minus backends the consumer cannot use. */
export function seedOverride(presetChain: string[], consumer: ConsumerDeclaration, views: Record<string, BackendView>): string[] {
  return presetChain.filter((id) => incompatibleWith(consumer, id, views).length === 0);
}

export function presetChain(draft: Draft): string[] {
  return draft.presets[draft.activePreset]?.chain ?? [];
}

export function overrideChain(draft: Draft, consumerId: string): string[] | null {
  return draft.presets[draft.activePreset]?.consumers?.[consumerId]?.chain ?? null;
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Copy of `draft` with the active preset's default chain replaced. */
export function withPresetChain(draft: Draft, chain: string[]): Draft {
  const p = draft.presets[draft.activePreset] ?? { chain: [] };
  return { ...draft, presets: { ...draft.presets, [draft.activePreset]: { ...p, chain } } };
}

/** Copy of `draft` with a consumer override set (array) or removed (null). */
export function withOverride(draft: Draft, consumerId: string, chain: string[] | null): Draft {
  const p = draft.presets[draft.activePreset] ?? { chain: [] };
  const consumers = { ...(p.consumers ?? {}) };
  if (chain === null) delete consumers[consumerId];
  else consumers[consumerId] = { chain };
  return { ...draft, presets: { ...draft.presets, [draft.activePreset]: { ...p, consumers } } };
}

/** Copy of `draft` without preset `name`; the active preset is never removed (activePreset must not dangle). */
export function withoutPreset(draft: Draft, name: string): Draft {
  if (name === draft.activePreset || !Object.hasOwn(draft.presets, name)) return draft;
  const presets = { ...draft.presets };
  delete presets[name];
  return { ...draft, presets };
}

/** Stable comparison for the Save Bar dirty flag. */
export const sameDraft = (a: Draft | null, b: Draft | null): boolean => JSON.stringify(a) === JSON.stringify(b);
