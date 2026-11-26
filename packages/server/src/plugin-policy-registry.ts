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
  /** Count one refused `ctx.appendEvent`. */
  noteRefusedAppend(): void;
  stats(): { refusedAppends: number };
}

export function createPluginPolicyRegistry(): PluginPolicyRegistry {
  const ownership = new Map<string, PluginOwnership>();
  const storePolicies = new Map<string, PluginStorePolicy>();
  const deliveryPolicies = new Map<string, PluginDeliveryPolicy>();
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

  return {
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
      return { refusedAppends };
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
