/**
 * Plugin event-forward registry: lets plugin bridge entries declare which bus
 * channels the dashboard bridge forwards, so core never names a plugin channel.
 *
 * Protocol (D1/D2): a plugin emits `dashboard:register-event-forward` with an
 * `EventForwardDeclaration`. `attach()` subscribes that channel and THEN emits
 * `dashboard:bridge-ready`, so a plugin that activated before the bridge
 * re-declares. Each accepted channel gets exactly ONE `events.on` subscription
 * per registry instance; `dispose()` releases all of them (bridge reload).
 *
 * Delivery (D4): `live` forwards while ready+active (else dropped — the generic
 * rule); `latest` / `stream` forward while ready+active+connected, else they are
 * retained in the {@link StreamForwardBuffer} and flushed in emission order by
 * `flush()`. Never coalesced or throttled on the live path.
 *
 * Declarations are untrusted (D3): validated by `validateDeclaration`; a channel
 * already owned by another plugin keeps its first owner (conflict counted), and
 * so does a forwarded `as` type owned by another plugin.
 *
 * Manifest ownership (move-subagents-to-plugin D1): the server sends a
 * `plugin_ownership` table (`setOwnership`). Declarations are HELD until it
 * arrives, then evaluated; a declaration forwarding as a type the table assigns
 * to another plugin is refused (counted), and every plugin-declared forward is
 * stamped with its `pluginId` so the server can verify it on ingest.
 * See change: add-plugin-bridge-contributions, update-flows-plugin, move-subagents-to-plugin.
 */

import {
  type AcceptedChannelSpec,
  BRIDGE_READY_CHANNEL,
  type PluginOwnershipTable,
  REGISTER_EVENT_FORWARD_CHANNEL,
  validateDeclaration,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import {
  type EventTypeOwner,
  matchEventTypeOwner,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/event-type-owners.js";
import { normalizeReplayEntryTypes } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/replay-entry-types.js";
import { StreamForwardBuffer, type StreamForwardBufferStats } from "./stream-forward-buffer.js";

interface BusLike {
  on: (channel: string, handler: (data: unknown) => void) => (() => void) | void;
  emit: (channel: string, data: unknown) => void;
}

export interface PluginForwardDeps {
  /** Send one `event_forward` with the already-resolved event type, stamped with the declaring pluginId. */
  send: (eventType: string, data: Record<string, unknown>, pluginId: string) => void;
  isSessionReady: () => boolean;
  isActive: () => boolean;
  isConnected: () => boolean;
  /** True when core already forwards this channel (core maps no plugin channel today). */
  isCoreChannel?: (channel: string) => boolean;
}

interface OwnedChannel extends AcceptedChannelSpec {
  pluginId: string;
}

export interface PluginForwardStats {
  declared: number;
  rejected: number;
  rejectedDeclarations: number;
  conflicts: number;
  forwarded: number;
  buffer: StreamForwardBufferStats & { keys: number };
}

/** Declarations held before the ownership table arrives; extras are counted as rejected. */
const MAX_HELD_DECLARATIONS = 64;

export class PluginForwardRegistry {
  private readonly owned = new Map<string, OwnedChannel>();
  /** Forwarded `as` type → owning pluginId (first owner wins across plugins). */
  private readonly asOwners = new Map<string, string>();
  /** Declared persisted custom-entry types (union over declaring plugins). */
  private readonly entryTypes = new Set<string>();
  private readonly perPlugin = new Map<string, number>();
  /** Held until the server's ownership table arrives (D1). */
  private held: unknown[] = [];
  private owners: EventTypeOwner[] | undefined;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly buffer: StreamForwardBuffer;
  private counters = { rejected: 0, rejectedDeclarations: 0, conflicts: 0, forwarded: 0 };
  private disposed = false;
  private readonly events: BusLike | undefined;
  private readonly deps: PluginForwardDeps;

  constructor(
    events: BusLike | undefined,
    deps: PluginForwardDeps,
    buffer: StreamForwardBuffer = new StreamForwardBuffer(),
  ) {
    this.events = events;
    this.deps = deps;
    this.buffer = buffer;
  }

  /** Attach the declaration listener, then announce readiness (handshake). */
  attach(): void {
    if (!this.events || this.disposed) return;
    const off = this.events.on(REGISTER_EVENT_FORWARD_CHANNEL, (raw) => this.declare(raw));
    if (typeof off === "function") this.unsubscribers.push(off);
    try {
      this.events.emit(BRIDGE_READY_CHANNEL, {});
    } catch {
      /* a throwing plugin listener must not break bridge init */
    }
  }

  /**
   * Apply the server's ownership table (D1) and evaluate every held
   * declaration. A later table replaces the earlier one (re-register).
   */
  setOwnership(table: Pick<PluginOwnershipTable, "eventTypes"> | undefined): void {
    if (this.disposed) return;
    const byPlugin = new Map<string, string[]>();
    const types = table && typeof table.eventTypes === "object" && table.eventTypes ? table.eventTypes : {};
    for (const pattern of Object.keys(types)) {
      const owner = types[pattern];
      if (typeof owner !== "string") continue;
      const list = byPlugin.get(owner) ?? [];
      list.push(pattern);
      byPlugin.set(owner, list);
    }
    this.owners = [...byPlugin].map(([ownerId, eventTypes]) => ({ ownerId, displayName: ownerId, eventTypes }));
    const held = this.held;
    this.held = [];
    for (const raw of held) this.declare(raw);
  }

  /** Validate + subscribe one declaration. Never throws. */
  declare(raw: unknown): void {
    if (this.disposed || !this.events) return;
    if (!this.owners) {
      if (this.held.length < MAX_HELD_DECLARATIONS) this.held.push(raw);
      else this.counters.rejectedDeclarations++;
      return;
    }
    try {
      const pluginIdRaw =
        raw && typeof raw === "object" && Object.prototype.hasOwnProperty.call(raw, "pluginId")
          ? (raw as { pluginId?: unknown }).pluginId
          : undefined;
      const pid = typeof pluginIdRaw === "string" ? pluginIdRaw : "";
      const result = validateDeclaration(raw, {
        existingForPlugin: this.perPlugin.get(pid) ?? 0,
        existingTotal: this.owned.size,
        isKnown: (channel) => this.owned.get(channel)?.pluginId === pid,
      });
      if (!result.ok || !result.pluginId) {
        this.counters.rejectedDeclarations++;
        return;
      }
      this.counters.rejected += result.rejected.length;
      if (result.maxKeysRejected) this.counters.rejected++;
      if (result.maxKeys !== undefined) this.buffer.setMaxKeys(result.pluginId, result.maxKeys);
      for (const spec of result.accepted) this.acceptChannel(result.pluginId, spec);
      const replayTypes = Object.prototype.hasOwnProperty.call(raw, "replayEntryTypes")
        ? (raw as { replayEntryTypes?: unknown }).replayEntryTypes
        : undefined;
      for (const t of normalizeReplayEntryTypes(replayTypes)) this.entryTypes.add(t);
    } catch {
      this.counters.rejectedDeclarations++;
    }
  }

  private acceptChannel(pluginId: string, spec: AcceptedChannelSpec): void {
    const existing = this.owned.get(spec.channel);
    if (existing) {
      const same =
        existing.pluginId === pluginId &&
        existing.as === spec.as &&
        existing.delivery === spec.delivery &&
        existing.key === spec.key &&
        existing.group === spec.group;
      if (!same) this.counters.conflicts++;
      return;
    }
    // Manifest ownership: a type owned by another plugin is refused, not conflicted.
    const owner = this.owners ? matchEventTypeOwner(this.owners, spec.as)?.ownerId : undefined;
    if (owner !== undefined && owner !== pluginId) {
      this.counters.rejected++;
      return;
    }
    if (this.deps.isCoreChannel?.(spec.channel)) {
      this.counters.conflicts++;
      return;
    }
    // A forwarded type is owned by ONE plugin: another pluginId may not forward
    // as it (anti-spoofing; the same plugin may map two channels to it).
    const asOwner = this.asOwners.get(spec.as);
    if (asOwner !== undefined && asOwner !== pluginId) {
      this.counters.conflicts++;
      return;
    }
    this.asOwners.set(spec.as, pluginId);
    const owned: OwnedChannel = { ...spec, pluginId };
    this.owned.set(spec.channel, owned);
    this.perPlugin.set(pluginId, (this.perPlugin.get(pluginId) ?? 0) + 1);
    const off = this.events?.on(spec.channel, (data) => this.onMessage(owned, data));
    if (typeof off === "function") this.unsubscribers.push(off);
  }

  private onMessage(ch: OwnedChannel, raw: unknown): void {
    if (this.disposed) return;
    try {
      const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const ready = this.deps.isSessionReady() && this.deps.isActive();
      if (ch.delivery === "live") {
        // Not forwardable → drop; `send` would otherwise queue it for reconnect.
        if (ready && this.deps.isConnected()) this.forward(ch, data);
        return;
      }
      if (ready && this.deps.isConnected() && this.buffer.size === 0) {
        this.forward(ch, data);
        return;
      }
      const keyValue = ch.key !== undefined ? data[ch.key] : undefined;
      if (!this.buffer.retain(ch.pluginId, ch.channel, ch.delivery, keyValue, data, ch.group)) return;
      // Connected again with a backlog: drain in order so live messages never overtake it.
      if (ready && this.deps.isConnected()) this.flush();
    } catch {
      /* forwarding failure must never break event delivery */
    }
  }

  private forward(ch: OwnedChannel, data: Record<string, unknown>): void {
    this.deps.send(ch.as, data, ch.pluginId);
    this.counters.forwarded++;
  }

  /** Forward every retained message in emission order (call on (re-)ready). */
  flush(): number {
    if (this.disposed) return 0;
    if (!(this.deps.isSessionReady() && this.deps.isActive() && this.deps.isConnected())) return 0;
    const drained = this.buffer.drain();
    for (const msg of drained) {
      const ch = this.owned.get(msg.channel);
      if (ch) this.forward(ch, msg.data);
    }
    return drained.length;
  }

  /** Declared plugin entry types (replayed as protocol events, never generic rows). */
  replayEntryTypes(): ReadonlySet<string> {
    return this.entryTypes;
  }

  declaredChannels(): string[] {
    return [...this.owned.keys()];
  }

  get stats(): PluginForwardStats {
    return {
      declared: this.owned.size,
      ...this.counters,
      buffer: { ...this.buffer.stats, keys: this.buffer.keyCount },
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.unsubscribers) {
      try {
        off();
      } catch {
        /* keep releasing */
      }
    }
    this.unsubscribers.length = 0;
    this.held = [];
    this.buffer.reset();
  }
}
