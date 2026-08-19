/**
 * Pure child-resolution for automation fan-out.
 *
 * One trigger fire expands into N child sessions. `resolveChildren` turns an
 * automation's `action:` | `actions:[]` (× per-entry `count`) into an ordered
 * list of `ChildSpec`s and truncates at the effective bound, returning how many
 * were dropped. Pure + unit-testable without spawn I/O; the bound warning is
 * data, not a log side effect.
 *
 * See change: add-automation-concurrent-spawn.
 */
import type { AutomationAction, DiscoveredAutomation } from "../shared/automation-types.js";

/** Default cap on concurrent child spawns per fire when neither the automation
 *  nor the caller supplies one. Mirrors the plugin settings default. */
export const DEFAULT_MAX_CONCURRENT_SPAWNS = 4;

/** One resolved child of a fire: the action to dispatch + a human label. */
export interface ChildSpec {
  /** The concrete action this child dispatches (one entry of `actions:` or the
   *  single `action:`), with `count`/`payload` carried through. */
  action: AutomationAction;
  /** Human label surfaced on the child run row (e.g. `flows.run:nightly`). */
  actionLabel: string;
}

/** Derive a readable label for a child's action row. */
export function actionLabelFor(action: AutomationAction): string {
  if (action.skill) return action.skill;
  const flow = action.payload?.flow;
  if (typeof flow === "string" && flow.length > 0) return `${action.kind}:${flow}`;
  return action.kind;
}

/** The list of action entries for an automation, single `action:` normalized. */
function actionEntries(automation: DiscoveredAutomation): AutomationAction[] {
  const cfg = automation.config;
  if (!cfg) return [];
  if (cfg.actions && cfg.actions.length > 0) return cfg.actions;
  if (cfg.action) return [cfg.action];
  return [];
}

/**
 * Effective per-fire spawn bound: the automation's `maxConcurrentSpawns` when
 * declared, else the settings default.
 */
export function effectiveBound(
  automation: DiscoveredAutomation,
  settingsDefault: number = DEFAULT_MAX_CONCURRENT_SPAWNS,
): number {
  const declared = automation.config?.maxConcurrentSpawns;
  return typeof declared === "number" && declared >= 1 ? declared : settingsDefault;
}

/**
 * Expand `action:` | `actions:[]` × `count` into an ordered child list and
 * truncate at `bound`. Truncation keeps the FIRST children in resolution order
 * (action entries in declaration order, and within an entry by ascending
 * `count` index), so the surviving set is deterministic.
 */
export function resolveChildren(
  automation: DiscoveredAutomation,
  bound: number,
): { specs: ChildSpec[]; truncated: number } {
  const all: ChildSpec[] = [];
  for (const action of actionEntries(automation)) {
    const count = typeof action.count === "number" && action.count >= 1 ? action.count : 1;
    const label = actionLabelFor(action);
    for (let i = 0; i < count; i++) {
      all.push({ action, actionLabel: label });
    }
  }
  const cap = Math.max(1, Math.floor(bound));
  if (all.length <= cap) return { specs: all, truncated: 0 };
  return { specs: all.slice(0, cap), truncated: all.length - cap };
}
