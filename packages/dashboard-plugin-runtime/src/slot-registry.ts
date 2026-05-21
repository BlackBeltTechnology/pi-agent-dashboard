/**
 * Typed slot registry for the dashboard plugin system.
 *
 * The registry holds a Map<SlotId, ClaimEntry[]> pre-sorted by
 * (priority asc, pluginId asc) for deterministic render order.
 */
import type { SlotId, SlotPredicateInput } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** A folder descriptor for sidebar-folder-section filtering. */
export interface FolderDescriptor {
  cwd: string;
  label?: string;
}

/**
 * A resolved slot claim entry held in the registry.
 *
 * Generic over `S extends SlotId` with a default of `SlotId` so that callers
 * iterating mixed-slot arrays (`ClaimEntry[]`) keep working unchanged, while
 * the static-registry generator can emit each entry with its literal slot id
 * to get strong predicate/shouldRender input typing per slot.
 *
 * See change: slot-generic-claim-entry.
 */
export interface ClaimEntry<S extends SlotId = SlotId> {
  pluginId: string;
  priority: number;
  slot: S;
  componentName?: string;
  command?: string;
  trigger?: string;
  toolName?: string;
  /** Wouter path pattern for `shell-overlay-route` claims. */
  path?: string;
  /** Session-id URL parameter name for `shell-overlay-route` claims. */
  sessionParam?: string;
  tab?: string;
  /** Slot-specific extra config (escape hatch — prefer first-class fields). */
  config?: Record<string, unknown>;
  /**
   * Filters whether this claim *targets* the given props (session, folder, …).
   * Failing the predicate removes the claim from the slot's claim list entirely.
   * Use for structural targeting (e.g. "only sessions whose cwd is X").
   *
   * Input shape is determined by the slot id via `SlotPredicateInput<S>`:
   *   session-scoped slots → `DashboardSession | null | undefined`
   *   folder-scoped slots  → `FolderDescriptor`
   *   other slots          → `never` (registering a predicate is a type error)
   *
   * NOTE on syntax: this field uses TypeScript **method-shorthand** rather than
   * arrow-property syntax. Method-shorthand parameter types are bivariant under
   * `strictFunctionTypes`, which is required so that the static-registry
   * generator can emit each entry as `ClaimEntry<"literal-slot-id">` and still
   * pack the entries into a mixed-slot `ClaimEntry[]` array. Soundness is
   * preserved by the registry's slot-pre-filtering contract (filter helpers
   * receive only claims for one slot id). See change: slot-generic-claim-entry.
   */
  predicate?(input: SlotPredicateInput<S>): boolean;
  /**
   * Indicates whether this claim's `Component` will produce visible output
   * for the given props. Runs synchronously alongside `predicate` but at the
   * wrapper-gate layer. When it returns `false`, the claim is NOT mounted and
   * counts as absent for `useSlotHasClaimsForSession` (so the wrapper subcard
   * hides).
   *
   * Use when the component itself conditionally returns `null` based on dynamic
   * state (e.g. "extension not installed", "user not authenticated"). MUST be
   * synchronous — plugins requiring async state must maintain a sync-readable
   * cache and default to `false` (closed) while the cache is unpopulated.
   *
   * See change: auto-hide-empty-session-subcards. Syntax note (method-shorthand
   * for bivariance): see the matching note on `predicate` above and change:
   * slot-generic-claim-entry.
   */
  shouldRender?(input: SlotPredicateInput<S>): boolean;
  /** The resolved React component (set at registration time). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component?: React.ComponentType<any>;
}

export interface SlotRegistry {
  /**
   * All claims for the given slot, pre-sorted.
   *
   * After `setEnabledSet` has been called at least once, claims whose
   * `pluginId` is not in the enabled set are filtered out. Before any
   * `setEnabledSet` call, every claim is returned (preserves SSR/legacy
   * behaviour). See change: add-plugin-activation-ui.
   */
  getClaims(slotId: SlotId): ClaimEntry[];
  /** All claims across all slots (subject to the same enable filter as `getClaims`). */
  getAllClaims(): ClaimEntry[];
  /** Add a claim. Inserts in sorted order. */
  addClaim(claim: ClaimEntry): void;
  /** Remove all claims belonging to a plugin. */
  removeClaims(pluginId: string): void;
  /**
   * Replace the active enabled-plugins set. After the first call, every
   * `getClaims` / `getAllClaims` query SHALL omit claims whose `pluginId`
   * is not in the set.
   * See change: add-plugin-activation-ui.
   */
  setEnabledSet(ids: ReadonlySet<string>): void;
  /**
   * Activation-UI escape hatch: returns claims grouped by plugin id,
   * IGNORING the enabled-set filter. Used by the Plugins tab so disabled
   * plugins still appear in the activation list. Every other consumer
   * SHOULD use `getClaims` and get free filtering.
   * See change: add-plugin-activation-ui.
   */
  getAllPluginsForActivationUi(): Map<string, ClaimEntry[]>;
}

function compareClaims(a: ClaimEntry, b: ClaimEntry): number {
  const pa = a.priority ?? 1000;
  const pb = b.priority ?? 1000;
  if (pa !== pb) return pa - pb;
  return a.pluginId.localeCompare(b.pluginId);
}

export function createSlotRegistry(): SlotRegistry {
  const store = new Map<SlotId, ClaimEntry[]>();
  // `null` = filter inactive (default state, returns all claims).
  // `Set<string>` = filter active, only listed pluginIds are kept.
  let enabledSet: ReadonlySet<string> | null = null;

  function getBucket(slotId: SlotId): ClaimEntry[] {
    if (!store.has(slotId)) store.set(slotId, []);
    return store.get(slotId)!;
  }

  function applyFilter(claims: ClaimEntry[]): ClaimEntry[] {
    if (enabledSet === null) return claims;
    const set = enabledSet;
    return claims.filter((c) => set.has(c.pluginId));
  }

  return {
    getClaims(slotId: SlotId): ClaimEntry[] {
      return applyFilter(store.get(slotId) ?? []);
    },

    getAllClaims(): ClaimEntry[] {
      const all: ClaimEntry[] = [];
      for (const claims of store.values()) all.push(...claims);
      return applyFilter(all);
    },

    addClaim(claim: ClaimEntry): void {
      const bucket = getBucket(claim.slot);
      bucket.push(claim);
      bucket.sort(compareClaims);
    },

    removeClaims(pluginId: string): void {
      for (const [slotId, claims] of store.entries()) {
        const filtered = claims.filter(c => c.pluginId !== pluginId);
        store.set(slotId, filtered);
      }
    },

    setEnabledSet(ids: ReadonlySet<string>): void {
      enabledSet = ids;
    },

    getAllPluginsForActivationUi(): Map<string, ClaimEntry[]> {
      const grouped = new Map<string, ClaimEntry[]>();
      for (const bucket of store.values()) {
        for (const claim of bucket) {
          let arr = grouped.get(claim.pluginId);
          if (!arr) {
            arr = [];
            grouped.set(claim.pluginId, arr);
          }
          arr.push(claim);
        }
      }
      return grouped;
    },
  };
}

// ── Filter helpers ───────────────────────────────────────────────────────────

/** Filter session-scoped claims using the claim's optional predicate. */
export function forSession(claims: ClaimEntry[], session: DashboardSession): ClaimEntry[] {
  return claims.filter(c => !c.predicate || c.predicate(session));
}

/**
 * Filter session-scoped claims by BOTH `predicate` AND `shouldRender`.
 *
 * Use this variant at the wrapper-gate layer (e.g. `useSlotHasClaimsForSession`,
 * slot consumers) when an empty render path should cause the parent container
 * to hide. The plain `forSession` should still be used when you only care about
 * structural targeting (e.g. counting registered claims).
 *
 * See change: auto-hide-empty-session-subcards.
 */
export function forSessionRendered(
  claims: ClaimEntry[],
  session: DashboardSession,
): ClaimEntry[] {
  return claims.filter(
    c =>
      (!c.predicate || c.predicate(session)) &&
      (!c.shouldRender || c.shouldRender(session)),
  );
}

/** Filter folder-scoped claims using the claim's optional predicate. */
export function forFolder(claims: ClaimEntry[], folder: FolderDescriptor): ClaimEntry[] {
  return claims.filter(c => !c.predicate || c.predicate(folder));
}

/** Filter command-route claims by command string. */
export function forCommand(claims: ClaimEntry[], command: string): ClaimEntry[] {
  return claims.filter(c => c.command === command);
}

/** Filter settings-section claims by tab. */
export function forTab(claims: ClaimEntry[], tab: string): ClaimEntry[] {
  return claims.filter(c => (c.tab ?? "general") === tab);
}

/** Filter tool-renderer claims by tool name. */
export function forToolName(claims: ClaimEntry[], toolName: string): ClaimEntry[] {
  return claims.filter(c => c.toolName === toolName);
}
