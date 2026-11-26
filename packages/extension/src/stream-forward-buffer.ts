/**
 * Retention buffer for PLUGIN-declared bus channels while the bridge cannot
 * forward (session not ready, bridge inactive, or socket down).
 *
 * - `latest`: newest message per (plugin, channel, key value).
 * - `stream`: every message per (plugin, key value) in emission order — ONE
 *   bucket shared by all stream channels of a plugin, so interleaving across
 *   channels (delta, delta, entry, delta) survives the flush.
 *
 * - `latest` with a `group`: ONE slot per (plugin, group, key) shared by every
 *   channel of the group — the newest message across the group wins.
 *
 * Bounds: stream ≤ 2000 msgs and ≤ 2 MiB per key (drop oldest, counted); a
 * key budget PER PLUGIN (default 64, declared `maxKeys` ≤ 256) shared by
 * latest + stream (evict that plugin's oldest key, counted per plugin), so one
 * plugin can never evict another's state. All storage is `Map`-based, so a key
 * value like `"__proto__"` is inert.
 * See change: add-plugin-bridge-contributions (D3/D4), move-subagents-to-plugin (D1).
 */

import { isValidKeyValue } from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";

export interface RetainedMessage {
  channel: string;
  data: Record<string, unknown>;
  seq: number;
  bytes: number;
}

interface Bucket {
  pluginId: string;
  delivery: "latest" | "stream";
  messages: RetainedMessage[];
  bytes: number;
}

export interface StreamForwardBufferOptions {
  maxKeys?: number;
  maxMessagesPerKey?: number;
  maxBytesPerKey?: number;
}

export interface StreamForwardBufferStats {
  /** Messages currently retained (gauge). */
  retained: number;
  /** Messages dropped by the stream bound or by key eviction (cumulative). */
  dropped: number;
  /** Keys evicted by the shared 64-key budget (cumulative). */
  evictedKeys: number;
  /** Messages refused for an invalid key value (cumulative). */
  keyRejected: number;
  /** Per-plugin loss counters (cumulative): messages dropped, keys evicted. */
  byPlugin: Record<string, { dropped: number; evictedKeys: number }>;
}

export const DEFAULT_MAX_KEYS = 64;
export const CEILING_MAX_KEYS = 256;
export const DEFAULT_MAX_MESSAGES_PER_KEY = 2000;
export const DEFAULT_MAX_BYTES_PER_KEY = 2 * 1024 * 1024;

function approxBytes(data: unknown): number {
  try {
    return (JSON.stringify(data) ?? "").length;
  } catch {
    return 0;
  }
}

export class StreamForwardBuffer {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;
  private readonly maxMessages: number;
  private readonly maxBytes: number;
  private seq = 0;
  private readonly keyBudgets = new Map<string, number>();
  private readonly keyCounts = new Map<string, number>();
  private readonly perPlugin = new Map<string, { dropped: number; evictedKeys: number }>();
  readonly stats: StreamForwardBufferStats = {
    retained: 0,
    dropped: 0,
    evictedKeys: 0,
    keyRejected: 0,
    byPlugin: {},
  };

  constructor(opts: StreamForwardBufferOptions = {}) {
    this.maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
    this.maxMessages = opts.maxMessagesPerKey ?? DEFAULT_MAX_MESSAGES_PER_KEY;
    this.maxBytes = opts.maxBytesPerKey ?? DEFAULT_MAX_BYTES_PER_KEY;
  }

  /** Set one plugin's key budget (clamped to 1..256); default is `maxKeys`. */
  setMaxKeys(pluginId: string, maxKeys: number): void {
    this.keyBudgets.set(pluginId, Math.max(1, Math.min(CEILING_MAX_KEYS, Math.floor(maxKeys))));
  }

  private pluginStats(pluginId: string): { dropped: number; evictedKeys: number } {
    let st = this.perPlugin.get(pluginId);
    if (!st) {
      st = { dropped: 0, evictedKeys: 0 };
      this.perPlugin.set(pluginId, st);
      this.stats.byPlugin[pluginId] = st;
    }
    return st;
  }

  get size(): number {
    return this.stats.retained;
  }

  /** Distinct retained keys (latest + stream share the budget). */
  get keyCount(): number {
    return this.buckets.size;
  }

  /**
   * Retain one message. Returns false (and counts) when the key value is not a
   * string / finite number ≤ 128 chars — such a message is never retained.
   */
  retain(
    pluginId: string,
    channel: string,
    delivery: "latest" | "stream",
    keyValue: unknown,
    data: Record<string, unknown>,
    group?: string,
  ): boolean {
    if (!isValidKeyValue(keyValue)) {
      this.stats.keyRejected++;
      return false;
    }
    const kv = `${typeof keyValue}:${String(keyValue)}`;
    const slot = group !== undefined ? `g:${group}` : `c:${channel}`;
    const bucketKey =
      delivery === "latest" ? `L\u0000${pluginId}\u0000${slot}\u0000${kv}` : `S\u0000${pluginId}\u0000${kv}`;
    const msg: RetainedMessage = { channel, data, seq: ++this.seq, bytes: approxBytes(data) };
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      this.evictForNewKey(pluginId);
      bucket = { pluginId, delivery, messages: [], bytes: 0 };
      this.buckets.set(bucketKey, bucket);
      this.keyCounts.set(pluginId, (this.keyCounts.get(pluginId) ?? 0) + 1);
    }
    if (delivery === "latest") {
      const prev = bucket.messages.length;
      bucket.messages = [msg];
      bucket.bytes = msg.bytes;
      this.stats.retained += 1 - prev;
      return true;
    }
    bucket.messages.push(msg);
    bucket.bytes += msg.bytes;
    this.stats.retained++;
    while (
      bucket.messages.length > 1 &&
      (bucket.messages.length > this.maxMessages || bucket.bytes > this.maxBytes)
    ) {
      const dropped = bucket.messages.shift();
      if (!dropped) break;
      bucket.bytes -= dropped.bytes;
      this.stats.retained--;
      this.stats.dropped++;
      this.pluginStats(pluginId).dropped++;
    }
    return true;
  }

  private evictForNewKey(pluginId: string): void {
    const budget = this.keyBudgets.get(pluginId) ?? this.maxKeys;
    while ((this.keyCounts.get(pluginId) ?? 0) >= budget) {
      let oldestKey: string | undefined;
      for (const [k, b] of this.buckets) {
        if (b.pluginId === pluginId) {
          oldestKey = k;
          break;
        }
      }
      if (oldestKey === undefined) return;
      const bucket = this.buckets.get(oldestKey);
      this.buckets.delete(oldestKey);
      this.keyCounts.set(pluginId, (this.keyCounts.get(pluginId) ?? 1) - 1);
      this.stats.evictedKeys++;
      const st = this.pluginStats(pluginId);
      st.evictedKeys++;
      if (bucket) {
        this.stats.retained -= bucket.messages.length;
        this.stats.dropped += bucket.messages.length;
        st.dropped += bucket.messages.length;
      }
    }
  }

  /** Remove and return every retained message in global emission order. */
  drain(): RetainedMessage[] {
    if (this.buckets.size === 0) return [];
    const all: RetainedMessage[] = [];
    for (const bucket of this.buckets.values()) all.push(...bucket.messages);
    this.buckets.clear();
    this.keyCounts.clear();
    this.stats.retained = 0;
    all.sort((a, b) => a.seq - b.seq);
    return all;
  }

  reset(): void {
    this.buckets.clear();
    this.keyCounts.clear();
    this.stats.retained = 0;
  }
}
