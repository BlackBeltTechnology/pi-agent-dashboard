/**
 * Server-side registry of plugin-owned event-type ownership plus the store and
 * delivery policies owners register through `ctx.registerStorePolicy` /
 * `ctx.registerDeliveryPolicy`. Core consults it generically: by event type
 * (manifest `eventTypes`) and, for a store policy, by claimed tool name
 * (`tool_execution_update|end`). No plugin identifier is named here.
 *
 * Process-wide singleton (like the plugin WS-route registry) so the event store
 * and the browser gateway need no extra constructor arguments; tests build an
 * isolated one with {@link createPluginPolicyRegistry}.
 *
 * See change: move-subagents-to-plugin (D3, D4, D10).
 */
import type {
  PluginDeliveryPolicy,
  PluginStorePolicy,
  ReplayCarryContext,
  ReplayCarryEvent,
  ReplayCarryHandler,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  type EventTypeOwner,
  matchEventTypeOwner,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/event-type-owners.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** What a plugin owns: manifest `eventTypes` patterns and claimed tool names. */
export interface PluginOwnership {
  eventTypes: readonly string[];
  tools: readonly string[];
}

/** Max bytes of one identity string leaf (placeholder + heal end). */
export const IDENTITY_FIELD_MAX_BYTES = 256;
const IDENTITY_MAX_DEPTH = 3;

function cutUtf8Bytes(text: string, max: number): string {
  if (Buffer.byteLength(text) <= max) return text;
  let out = Buffer.from(text).subarray(0, max).toString("utf8");
  while (Buffer.byteLength(out) > max) out = out.slice(0, -1);
  return out;
}

function sanitizeNode(node: unknown, depth: number): unknown {
  if (typeof node === "string") return cutUtf8Bytes(node, IDENTITY_FIELD_MAX_BYTES);
  if (typeof node === "number") return Number.isFinite(node) ? node : undefined;
  if (typeof node === "boolean") return node;
  if (node && typeof node === "object" && !Array.isArray(node) && depth < IDENTITY_MAX_DEPTH) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const clean = sanitizeNode(v, depth + 1);
      if (clean !== undefined && !(typeof clean === "object" && Object.keys(clean as object).length === 0)) {
        out[k] = clean;
      }
    }
    return out;
  }
  return undefined;
}

/**
 * Reduce a policy's `identity` result to scalar leaves: strings cut to
 * `IDENTITY_FIELD_MAX_BYTES`, finite numbers, booleans, nested plain objects
 * (depth ≤ 3). Arrays, nulls and everything else are dropped. Returns
 * `undefined` when nothing survives.
 */
export function sanitizeIdentityFields(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const clean = sanitizeNode(raw, 0) as Record<string, unknown>;
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/** Per-plugin bounds of one `plugin_event_carry` frame. */
export const CARRY_MAX_EVENTS = 2000;
export const CARRY_MAX_BYTES = 2 * 1024 * 1024;
/** A carry handler result later than this is discarded. */
export const CARRY_DEADLINE_MS = 200;

/** One plugin's bounded, ownership-filtered carry for a windowed subscribe. */
export interface ReplayCarryFrame {
  pluginId: string;
  events: ReplayCarryEvent[];
}

/** Cumulative carry counters, exposed in `/api/health`. */
export interface ReplayCarryStats {
  /** Events dropped because the plugin does not own their type. */
  refused: number;
  /** Owned events dropped by the 2000-event / 2 MiB bound. */
  dropped: number;
  /** Handler results discarded (threw, or arrived after the deadline). */
  discarded: number;
}

export interface PluginPolicyRegistry {
  /** Record what `pluginId` owns. Replaces a previous record. */
  setOwnership(pluginId: string, ownership: PluginOwnership): void;
  /** Does `pluginId` own `eventType` (manifest `eventTypes`, longest match wins)? */
  ownsEventType(pluginId: string, eventType: string): boolean;
  registerStorePolicy(pluginId: string, policy: PluginStorePolicy): () => void;
  registerDeliveryPolicy(pluginId: string, policy: PluginDeliveryPolicy): () => void;
  /** Store policy governing `event` (owned type or claimed tool update/end), else undefined. */
  resolveStorePolicy(event: DashboardEvent): PluginStorePolicy | undefined;
  /** Store policy of the plugin claiming `toolName`, else undefined. */
  resolveToolStorePolicy(toolName: string): PluginStorePolicy | undefined;
  /** Defer key from the owning plugin's delivery policy; a throw is no key. */
  deferKeyOf(event: DashboardEvent, sessionId: string): string | undefined;
  /** Bounded deferred copy from the owner's delivery policy; a throw returns `event`. */
  projectDeferred(event: DashboardEvent): DashboardEvent;
  registerReplayCarry(pluginId: string, handler: ReplayCarryHandler): () => void;
  /** True when at least one replay-carry handler is registered. */
  hasReplayCarry(): boolean;
  /**
   * Call every replay-carry handler for a windowed subscribe and return each
   * plugin's owned events, bounded in handler order. A handler that throws or
   * answers after {@link CARRY_DEADLINE_MS} contributes nothing (logged).
   */
  collectReplayCarries(ctx: ReplayCarryContext): Promise<ReplayCarryFrame[]>;
  /** Count one refused `ctx.appendEvent`. */
  noteRefusedAppend(): void;
  stats(): { refusedAppends: number; replayCarry: ReplayCarryStats };
}

export function createPluginPolicyRegistry(): PluginPolicyRegistry {
  const ownership = new Map<string, PluginOwnership>();
  const storePolicies = new Map<string, PluginStorePolicy>();
  const deliveryPolicies = new Map<string, PluginDeliveryPolicy>();
  const carryHandlers = new Map<string, ReplayCarryHandler>();
  const carryStats: ReplayCarryStats = { refused: 0, dropped: 0, discarded: 0 };
  let refusedAppends = 0;

  // Event types are few and the lookup runs per resident event on some store
  // paths, so the owner match is memoized per event type and reset whenever
  // ownership changes.
  let ownerMemo = new Map<string, string | undefined>();
  const owners = (): EventTypeOwner[] => {
    const out: EventTypeOwner[] = [];
    for (const [ownerId, o] of ownership) out.push({ ownerId, displayName: ownerId, eventTypes: o.eventTypes });
    return out;
  };
  const ownerOf = (eventType: string): string | undefined => {
    if (ownerMemo.has(eventType)) return ownerMemo.get(eventType);
    const owner = matchEventTypeOwner(owners(), eventType)?.ownerId;
    ownerMemo.set(eventType, owner);
    return owner;
  };
  const toolClaimant = (toolName: string): string | undefined => {
    for (const [id, o] of ownership) if (o.tools.includes(toolName)) return id;
    return undefined;
  };

  const resolveStorePolicy = (event: DashboardEvent): PluginStorePolicy | undefined => {
    if (storePolicies.size === 0) return undefined;
    const owner = ownerOf(event.eventType);
    if (owner !== undefined) return storePolicies.get(owner);
    if (event.eventType === "tool_execution_update" || event.eventType === "tool_execution_end") {
      const toolName = (event.data as Record<string, unknown> | undefined)?.toolName;
      if (typeof toolName === "string") {
        const claimant = toolClaimant(toolName);
        if (claimant !== undefined) return storePolicies.get(claimant);
      }
    }
    return undefined;
  };

  const carryOne = async (pluginId: string, handler: ReplayCarryHandler, ctx: ReplayCarryContext): Promise<ReplayCarryFrame | undefined> => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = Promise.resolve(handler(ctx));
      const result = await Promise.race([
        pending,
        new Promise<"late">((resolve) => {
          timer = setTimeout(() => resolve("late"), CARRY_DEADLINE_MS);
          timer.unref?.();
        }),
      ]);
      // A synchronous handler cannot be pre-empted: judge it by elapsed time.
      if (result === "late" || Date.now() - started > CARRY_DEADLINE_MS) {
        carryStats.discarded++;
        console.warn(`[plugin-carry] ${pluginId} replay carry exceeded ${CARRY_DEADLINE_MS}ms; discarded (session ${ctx.sessionId})`);
        return undefined;
      }
      const events: ReplayCarryEvent[] = [];
      let bytes = 0;
      let full = false;
      for (const e of Array.isArray(result) ? result : []) {
        if (!e?.event || !ownsType(pluginId, e.event.eventType)) {
          carryStats.refused++;
          continue;
        }
        if (full) {
          carryStats.dropped++;
          continue;
        }
        const wire: ReplayCarryEvent = { seq: e.seq, event: e.event };
        const size = Buffer.byteLength(JSON.stringify(wire));
        if (events.length >= CARRY_MAX_EVENTS || bytes + size > CARRY_MAX_BYTES) {
          full = true;
          carryStats.dropped++;
          continue;
        }
        events.push(wire);
        bytes += size;
      }
      return events.length > 0 ? { pluginId, events } : undefined;
    } catch (err) {
      carryStats.discarded++;
      console.warn(`[plugin-carry] ${pluginId} replay carry failed (session ${ctx.sessionId}): ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const ownsType = (pluginId: string, eventType: string): boolean => ownerOf(eventType) === pluginId;

  return {
    registerReplayCarry(pluginId, handler) {
      carryHandlers.set(pluginId, handler);
      return () => {
        if (carryHandlers.get(pluginId) === handler) carryHandlers.delete(pluginId);
      };
    },
    hasReplayCarry() {
      return carryHandlers.size > 0;
    },
    async collectReplayCarries(ctx) {
      const frames = await Promise.all([...carryHandlers].map(([id, h]) => carryOne(id, h, ctx)));
      return frames.filter((f): f is ReplayCarryFrame => f !== undefined);
    },
    setOwnership(pluginId, o) {
      ownership.set(pluginId, { eventTypes: [...o.eventTypes], tools: [...o.tools] });
      ownerMemo = new Map();
    },
    ownsEventType(pluginId, eventType) {
      return ownerOf(eventType) === pluginId;
    },
    registerStorePolicy(pluginId, policy) {
      storePolicies.set(pluginId, policy);
      return () => {
        if (storePolicies.get(pluginId) === policy) storePolicies.delete(pluginId);
      };
    },
    registerDeliveryPolicy(pluginId, policy) {
      deliveryPolicies.set(pluginId, policy);
      return () => {
        if (deliveryPolicies.get(pluginId) === policy) deliveryPolicies.delete(pluginId);
      };
    },
    resolveStorePolicy,
    resolveToolStorePolicy(toolName) {
      const claimant = toolClaimant(toolName);
      return claimant === undefined ? undefined : storePolicies.get(claimant);
    },
    deferKeyOf(event, sessionId) {
      if (deliveryPolicies.size === 0) return undefined;
      const owner = ownerOf(event.eventType);
      const policy = owner === undefined ? undefined : deliveryPolicies.get(owner);
      if (!policy?.deferKey) return undefined;
      try {
        const key = policy.deferKey(event, sessionId);
        return typeof key === "string" && key !== "" ? key : undefined;
      } catch {
        return undefined;
      }
    },
    projectDeferred(event) {
      const owner = ownerOf(event.eventType);
      const policy = owner === undefined ? undefined : deliveryPolicies.get(owner);
      if (!policy?.project) return event;
      try {
        return policy.project(event) ?? event;
      } catch {
        return event;
      }
    },
    noteRefusedAppend() {
      refusedAppends++;
    },
    stats() {
      return { refusedAppends, replayCarry: { ...carryStats } };
    },
  };
}

let registry: PluginPolicyRegistry = createPluginPolicyRegistry();

/** The process-wide registry the event store, gateway and plugin contexts share. */
export function getPluginPolicyRegistry(): PluginPolicyRegistry {
  return registry;
}

/** Test seam: install a fresh (or a given) process-wide registry. */
export function resetPluginPolicyRegistry(next?: PluginPolicyRegistry): PluginPolicyRegistry {
  registry = next ?? createPluginPolicyRegistry();
  return registry;
}
