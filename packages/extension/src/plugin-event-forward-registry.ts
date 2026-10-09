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
 * already owned by core or another plugin keeps its first owner (conflict
 * counted). See change: add-plugin-bridge-contributions.
 */

import {
  type AcceptedChannelSpec,
  BRIDGE_READY_CHANNEL,
  REGISTER_EVENT_FORWARD_CHANNEL,
  validateDeclaration,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import { StreamForwardBuffer, type StreamForwardBufferStats } from "./stream-forward-buffer.js";

interface BusLike {
  on: (channel: string, handler: (data: unknown) => void) => (() => void) | void;
  emit: (channel: string, data: unknown) => void;
}

export interface PluginForwardDeps {
  /** Send one `event_forward` with the already-resolved event type. */
  send: (eventType: string, data: Record<string, unknown>) => void;
  isSessionReady: () => boolean;
  isActive: () => boolean;
  isConnected: () => boolean;
  /** True when core already forwards this channel (FLOW/SUBAGENT maps). */
  isCoreChannel: (channel: string) => boolean;
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

export class PluginForwardRegistry {
  private readonly owned = new Map<string, OwnedChannel>();
  private readonly perPlugin = new Map<string, number>();
  private readonly unsubscribers: Array<() => void> = [];
  private readonly buffer: StreamForwardBuffer;
  private counters = { rejected: 0, rejectedDeclarations: 0, conflicts: 0, forwarded: 0 };
  private disposed = false;

  constructor(
    private readonly events: BusLike | undefined,
    private readonly deps: PluginForwardDeps,
    buffer: StreamForwardBuffer = new StreamForwardBuffer(),
  ) {
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

  /** Validate + subscribe one declaration. Never throws. */
  declare(raw: unknown): void {
    if (this.disposed || !this.events) return;
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
      for (const spec of result.accepted) this.acceptChannel(result.pluginId, spec);
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
        existing.key === spec.key;
      if (!same) this.counters.conflicts++;
      return;
    }
    if (this.deps.isCoreChannel(spec.channel)) {
      this.counters.conflicts++;
      return;
    }
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
        if (ready) this.forward(ch.as, data);
        return;
      }
      if (ready && this.deps.isConnected() && this.buffer.size === 0) {
        this.forward(ch.as, data);
        return;
      }
      const keyValue = ch.key !== undefined ? data[ch.key] : undefined;
      if (!this.buffer.retain(ch.pluginId, ch.channel, ch.delivery, keyValue, data)) return;
      // Connected again with a backlog: drain in order so live messages never overtake it.
      if (ready && this.deps.isConnected()) this.flush();
    } catch {
      /* forwarding failure must never break event delivery */
    }
  }

  private forward(eventType: string, data: Record<string, unknown>): void {
    this.deps.send(eventType, data);
    this.counters.forwarded++;
  }

  /** Forward every retained message in emission order (call on (re-)ready). */
  flush(): number {
    if (this.disposed) return 0;
    if (!(this.deps.isSessionReady() && this.deps.isActive() && this.deps.isConnected())) return 0;
    const drained = this.buffer.drain();
    for (const msg of drained) {
      const ch = this.owned.get(msg.channel);
      if (ch) this.forward(ch.as, msg.data);
    }
    return drained.length;
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
    this.buffer.reset();
  }
}
