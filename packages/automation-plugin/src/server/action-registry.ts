/**
 * Extensible automation action registry.
 *
 * An action is "what an automation does when it fires". The engine spawns a
 * headless run session and delivers a seed prompt; an action's `buildPrompt`
 * produces that seed from the automation's `action.payload`. Plugins register
 * actions through this registry (published via the cross-plugin service seam
 * `ctx.provide("automation.action-registry", registry)`); the built-ins
 * `core.prompt` and `core.skill` are always present.
 *
 * Ids are namespaced `<source>.<verb>` (e.g. `flows.run`) so multiple plugins
 * never collide. Each source may register at most `MAX_PER_SOURCE` actions.
 *
 * See change: register-plugin-automation-events.
 */
import fs from "node:fs";
import path from "node:path";
import type {
  ActionDescriptor,
  ActionPayloadField,
  DiscoveredAutomation,
} from "../shared/automation-types.js";
import { BUILTIN_ACTION_ALIASES } from "../shared/automation-types.js";

/** Max actions a single source may register (clutter guard). */
export const MAX_PER_SOURCE = 12;

/** Server-side payload field — `enum` options resolve per cwd. */
export interface ActionFieldSpec {
  key: string;
  label: string;
  type: "string" | "multiline" | "text" | "enum";
  help?: string;
  /** Required for `enum`: resolve the selectable options for a cwd. */
  options?: (cwd: string) => string[];
}

/**
 * How an event-dispatched run finishes. Declared BY THE ACTION (not the
 * automation engine), so the automation plugin stays generic and knows no
 * action-specific event names. See change: finalize-event-dispatched-automation-runs.
 */
export interface ActionCompletion {
  /** Forwarded event type that signals a run of this action has finished. */
  eventType: string;
  /** Derive the run result text from the completion event's payload. */
  summarize?: (data: Record<string, unknown> | undefined) => string;
}

/** Event an action emits into the run session (via emitEventToSession). */
export interface ActionEvent {
  eventType: string;
  data?: Record<string, unknown>;
  /**
   * Optional completion declaration. Event-dispatched runs produce no
   * `agent_end`; when set, the engine finalizes the run on this declared
   * event. Absent → the run finalizes on `agent_end` (prompt-dispatch default).
   */
  completion?: ActionCompletion;
}

/**
 * A registered action (server-side, carries functions). An action dispatches
 * either by seeding a prompt (`buildPrompt`) OR by emitting a configured event
 * (`buildEvent`) into the spawned run session — exactly one. Prompt runs
 * finalize on `agent_end`; an event run finalizes on its declared
 * `ActionEvent.completion` event when present, else on `agent_end`.
 * See change: automation-emit-configured-event.
 * See change: finalize-event-dispatched-automation-runs.
 */
export interface ActionRegistration {
  /** Namespaced id `<source>.<verb>`. */
  id: string;
  /** Owning source/plugin id. */
  source: string;
  label: string;
  description?: string;
  /** Usable in this cwd? Defaults to always-available. */
  available?: (cwd: string) => boolean;
  /** Why it is unavailable (shown disabled in the picker). */
  unavailableReason?: string;
  payloadSchema?: ActionFieldSpec[];
  /** Produce the run session's seed prompt from the action payload. */
  buildPrompt?: (args: {
    payload: Record<string, unknown>;
    automation: DiscoveredAutomation;
  }) => string;
  /**
   * Event types `buildEvent` may emit (REQUIRED, non-empty, for `buildEvent`
   * actions). The engine refuses any other type; reserved host namespaces are
   * refused regardless. See change: harden-trust-and-credential-boundaries (D3).
   */
  emits?: string[];
  /** Produce the event emitted into the run session. `null` emits nothing. */
  buildEvent?: (args: {
    payload: Record<string, unknown>;
    automation: DiscoveredAutomation;
  }) => ActionEvent | null;
}

/** Manifest `emits` of a provider plugin (`undefined` = unknown / not loaded). */
export type ProviderEmitsLookup = (providerId: string) => readonly string[] | undefined;

export class ActionRegistry {
  private byId = new Map<string, ActionRegistration>();
  private countBySource = new Map<string, number>();
  private warn: (msg: string) => void;
  private providerEmits: ProviderEmitsLookup;

  constructor(opts?: { warn?: (msg: string) => void; providerEmits?: ProviderEmitsLookup }) {
    this.warn = opts?.warn ?? ((m) => console.warn(m));
    this.providerEmits = opts?.providerEmits ?? (() => undefined);
  }

  /**
   * Register an action. Rejected (with a logged warning, no throw) when the
   * source is already at the per-source cap, when the id is malformed, or on
   * a duplicate id. When `provider` (the plugin the host recorded as having
   * published it) is given, a `buildEvent` action's `emits` must be a subset
   * of that provider's manifest `emits`; the whole action is rejected
   * otherwise. See change: harden-git-terminal-plugin-boundaries (D16).
   */
  register(reg: ActionRegistration, provider?: string): boolean {
    if (!/^[a-z0-9-]+\.[a-z0-9-]+$/i.test(reg.id)) {
      this.warn(`[action-registry] rejected malformed action id "${reg.id}" (expected <source>.<verb>)`);
      return false;
    }
    if (!reg.buildPrompt === !reg.buildEvent) {
      this.warn(`[action-registry] rejected "${reg.id}": exactly one of buildPrompt/buildEvent required`);
      return false;
    }
    if (reg.buildEvent && !(Array.isArray(reg.emits) && reg.emits.length > 0)) {
      this.warn(`[action-registry] rejected "${reg.id}": buildEvent actions must declare a non-empty \`emits\` list`);
      return false;
    }
    if (reg.buildEvent && provider !== undefined) {
      const declared = new Set(this.providerEmits(provider) ?? []);
      const undeclared = (reg.emits as string[]).filter((t) => !declared.has(t));
      if (undeclared.length > 0) {
        this.warn(
          `[action-registry] rejected "${reg.id}": provider plugin "${provider}" does not declare ` +
            `${undeclared.map((t) => `"${t}"`).join(", ")} in its manifest \`emits\``,
        );
        return false;
      }
    }
    if (this.byId.has(reg.id)) {
      this.warn(`[action-registry] rejected duplicate action id "${reg.id}"`);
      return false;
    }
    const count = this.countBySource.get(reg.source) ?? 0;
    if (count >= MAX_PER_SOURCE) {
      this.warn(`[action-registry] source "${reg.source}" at cap (${MAX_PER_SOURCE}); rejected "${reg.id}"`);
      return false;
    }
    this.byId.set(reg.id, reg);
    this.countBySource.set(reg.source, count + 1);
    return true;
  }

  get(id: string): ActionRegistration | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** All registered action ids (for schema validation). */
  ids(): Set<string> {
    return new Set(this.byId.keys());
  }

  /**
   * Serializable descriptors for the dialog, resolved for one cwd: each
   * action's `available(cwd)` is evaluated and `enum` option lists are
   * populated. Sorted by source then id for stable grouping.
   */
  descriptorsForCwd(cwd: string): ActionDescriptor[] {
    const out: ActionDescriptor[] = [];
    for (const reg of this.byId.values()) {
      const available = reg.available ? safeBool(reg.available, cwd) : true;
      const payloadSchema: ActionPayloadField[] = (reg.payloadSchema ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        ...(f.help ? { help: f.help } : {}),
        ...(f.type === "enum" ? { options: f.options ? safeOptions(f.options, cwd) : [] } : {}),
      }));
      out.push({
        id: reg.id,
        source: reg.source,
        label: reg.label,
        ...(reg.description ? { description: reg.description } : {}),
        available,
        ...(!available && reg.unavailableReason ? { unavailableReason: reg.unavailableReason } : {}),
        payloadSchema,
      });
    }
    out.sort((a, b) => (a.source === b.source ? a.id.localeCompare(b.id) : a.source.localeCompare(b.source)));
    return out;
  }
}

function safeBool(fn: (cwd: string) => boolean, cwd: string): boolean {
  try {
    return fn(cwd);
  } catch {
    return false;
  }
}
function safeOptions(fn: (cwd: string) => string[], cwd: string): string[] {
  try {
    return fn(cwd);
  } catch {
    return [];
  }
}

/**
 * The automation plugin's built-in action contributions (`core.prompt` +
 * `core.skill`). Published under `automation.action.core` and collected like
 * any plugin's contribution — built-ins are peers, not privileged.
 * See change: decouple-automation-action-registry.
 */
export function coreActionContributions(): ActionRegistration[] {
  return [
    {
      id: "core.prompt",
      source: "core",
      label: "Prompt",
      description: "Seed a fresh session with a prompt file.",
      buildPrompt: ({ automation }) => {
        const action = automation.config?.action;
        const p = action?.prompt;
        if (!p) return "";
        const promptPath = path.isAbsolute(p) ? p : path.join(automation.dir, p);
        try {
          return fs.readFileSync(promptPath, "utf-8").trim();
        } catch {
          return "";
        }
      },
    },
    {
      id: "core.skill",
      source: "core",
      label: "Skill",
      description: "Invoke a $skill in a fresh session.",
      buildPrompt: ({ automation }) => {
        const skill = automation.config?.action?.skill;
        if (!skill) return "";
        return skill.startsWith("$") ? skill : `$${skill}`;
      },
    },
  ];
}

/**
 * Build a registry seeded with the built-in `core.*` actions. Used as the
 * engine's standalone fallback + in tests; the automation plugin instead
 * publishes `coreActionContributions()` and collects (publish/collect).
 */
export function createActionRegistryWithBuiltins(opts?: { warn?: (msg: string) => void }): ActionRegistry {
  const reg = new ActionRegistry(opts);
  for (const c of coreActionContributions()) reg.register(c);
  return reg;
}

/** Prefix under which action contributions are published for collection. */
export const ACTION_CONTRIBUTION_PREFIX = "automation.action.";

/** `consumeAll` provider recorded for host-set entries (exempt from the source check). */
const HOST_PROVIDER = "host";

/**
 * Collect all published action contributions into a fresh registry. Each
 * publisher provides an `ActionRegistration` or array under
 * `automation.action.<source>`. Registration guards (id shape, duplicate,
 * exactly-one dispatch, per-source cap) apply during collection, plus:
 * an entry whose host-recorded `provider` is neither the key's `<source>`
 * nor the host is ignored with a warning (spoof), an empty source is
 * malformed, and a `buildEvent` action's `emits` must be within its
 * PROVIDER's manifest `emits` (`providerEmits`; absent = fail closed).
 * See change: decouple-automation-action-registry;
 * harden-git-terminal-plugin-boundaries (D16).
 */
export function collectActionRegistry(
  entries: Array<{ key: string; value: unknown; provider?: string }>,
  opts?: { warn?: (msg: string) => void; providerEmits?: ProviderEmitsLookup },
): ActionRegistry {
  const reg = new ActionRegistry(opts);
  const warn = opts?.warn ?? ((m: string) => console.warn(m));
  for (const { key, value, provider } of entries) {
    const refusal = entryRefusal(key, provider);
    if (refusal) {
      warn(`[action-registry] ${refusal}`);
      continue;
    }
    for (const c of Array.isArray(value) ? value : [value]) {
      if (c && typeof c === "object") reg.register(c as ActionRegistration, provider);
    }
  }
  return reg;
}

/** Why a published entry must be ignored (spoofed/malformed), or `null` when it may be collected. */
function entryRefusal(key: string, provider: string | undefined): string | null {
  const source = key.startsWith(ACTION_CONTRIBUTION_PREFIX)
    ? key.slice(ACTION_CONTRIBUTION_PREFIX.length).split(".", 1)[0]
    : "";
  if (!source) return `ignored malformed contribution key "${key}" (empty source segment)`;
  if (provider === HOST_PROVIDER || provider === source) return null;
  return `ignored "${key}": provider "${String(provider)}" is not the key source "${source}"`;
}

/** Normalize a bare `prompt`/`skill` action kind to its `core.*` id. */
export function normalizeActionKind(kind: string): string {
  return (BUILTIN_ACTION_ALIASES as Record<string, string>)[kind] ?? kind;
}
