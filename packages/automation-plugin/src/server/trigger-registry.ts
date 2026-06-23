/**
 * Extensible trigger registry — the phase-1 seam for future event/plugin
 * trigger kinds.
 *
 * A `TriggerType` knows how to `parse` its kind-specific `on:` block into a
 * typed config and to `arm` that config against a `fire` callback, returning
 * a `Disposable` so the scheduler can dispose+re-arm on config change.
 *
 * Phase 1 registers only `schedule`. Later kinds (e.g. `openspec.complete`,
 * `slack.message`) register through the SAME interface — the on-disk
 * `automation.yaml` format never churns.
 *
 * See change: add-automation-plugin.
 */

import type {
  TriggerCategoryDescriptor,
  TriggerEventDescriptor,
} from "../shared/automation-types.js";

export interface Disposable {
  dispose(): void;
}

/** Context handed to a trigger's `fire` callback when it fires. */
export interface FireContext {
  /** Epoch ms of the occurrence that fired. */
  firedAt: number;
}

export interface TriggerType<Cfg = unknown> {
  /** The `on.kind` value this type handles (e.g. "schedule"). */
  kind: string;
  /**
   * Validate + narrow the raw `on:` block into a typed config. Throws (or
   * returns via thrown Error) on invalid input; the scheduler treats a
   * throw as "automation invalid, isolate it".
   */
  parse(rawOn: unknown): Cfg;
  /**
   * Subscribe the trigger. Call `fire(ctx)` on each occurrence. Return a
   * Disposable; calling `dispose()` MUST stop all future fires.
   */
  arm(cfg: Cfg, fire: (ctx: FireContext) => void, deps: ArmDeps): Disposable;
}

/** Ambient dependencies an `arm` implementation may use (injectable for tests). */
export interface ArmDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => { clear: () => void };
}

export class TriggerRegistry {
  private types = new Map<string, TriggerType>();

  register(type: TriggerType): void {
    this.types.set(type.kind, type);
  }

  get(kind: string): TriggerType | undefined {
    return this.types.get(kind);
  }

  has(kind: string): boolean {
    return this.types.has(kind);
  }

  kinds(): Set<string> {
    return new Set(this.types.keys());
  }
}

/**
 * Map a UI category id to the on-disk `on.kind` value. The `scheduled`
 * category keeps the legacy `schedule` kind so existing `automation.yaml`
 * files need no migration; every other category id equals its `on.kind`.
 */
export function onKindForCategory(category: string): string {
  return category === "scheduled" ? "schedule" : category;
}

/** Inverse of `onKindForCategory`: on-disk `on.kind` → UI category id. */
export function categoryForOnKind(kind: string): string {
  return kind === "schedule" ? "scheduled" : kind;
}

/**
 * Static trigger taxonomy: the full level-1 (category) × level-2 (event type)
 * roadmap. A category is reported `enabled` only when its on-disk kind is
 * registered in the live registry (i.e. can actually arm); otherwise it is
 * `planned` ("coming soon"). Events keep their declared baseline status but are
 * forced to `planned` whenever their parent category is `planned` — an event
 * cannot be selectable under a category that cannot arm.
 *
 * Adding a real handler = registering the kind; its category lights up with no
 * client change. Wiring an event = flipping its `baseStatus` to `enabled`.
 */
export interface TaxonomyEvent {
  event: string;
  label: string;
  /** Baseline status when the parent category is enabled. Default `planned`. */
  baseStatus?: "enabled" | "planned";
}
export interface TaxonomyCategory {
  category: string;
  label: string;
  /** Multi-type categories require a non-empty `on.events[]`. */
  multiType: boolean;
  events: TaxonomyEvent[];
}

export const TRIGGER_TAXONOMY: readonly TaxonomyCategory[] = [
  { category: "scheduled", label: "Scheduled", multiType: false, events: [] },
  {
    category: "openspec",
    label: "OpenSpec",
    multiType: true,
    events: [
      { event: "change.created", label: "Change created" },
      { event: "change.archived", label: "Change archived" },
      { event: "change.validated", label: "Change validated" },
      { event: "tasks.completed", label: "Tasks completed" },
      { event: "spec.updated", label: "Spec updated" },
      { event: "proposal.added", label: "Proposal added" },
    ],
  },
  {
    category: "git",
    label: "Git",
    multiType: true,
    events: [
      { event: "commit", label: "Commit" },
      { event: "push", label: "Push" },
      { event: "branch.created", label: "Branch created" },
    ],
  },
  {
    category: "file",
    label: "File",
    multiType: true,
    events: [
      { event: "created", label: "File created" },
      { event: "changed", label: "File changed" },
      { event: "deleted", label: "File deleted" },
    ],
  },
  {
    category: "webhook",
    label: "Webhook",
    multiType: false,
    events: [],
  },
];

/**
 * Derive the read-only category+event descriptors the client renders as a
 * two-level picker. `enabled` iff the category's on-disk kind is registered.
 */
export function deriveTriggerTaxonomy(
  registry: TriggerRegistry,
  taxonomy: readonly TaxonomyCategory[] = TRIGGER_TAXONOMY,
): TriggerCategoryDescriptor[] {
  return taxonomy.map((cat) => {
    const enabled = registry.has(onKindForCategory(cat.category));
    const events: TriggerEventDescriptor[] = cat.events.map((ev) => ({
      event: ev.event,
      label: ev.label,
      // An event cannot be enabled under a planned category.
      status: enabled && ev.baseStatus === "enabled" ? "enabled" : "planned",
    }));
    return {
      category: cat.category,
      label: cat.label,
      status: enabled ? "enabled" : "planned",
      events,
    };
  });
}
