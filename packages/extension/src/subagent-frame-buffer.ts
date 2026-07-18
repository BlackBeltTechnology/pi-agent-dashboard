/**
 * SubagentFrameBuffer — makes the running-subagent timeline reconcilable
 * instead of fire-and-forget.
 *
 * Background: the bridge's `pi.events.emit` intercept forwards subagent
 * lifecycle frames (`subagents:created/started/completed/failed`) as
 * `event_forward` messages, but only while `sessionReady && isActive()`.
 * Frames emitted during a not-ready window (reconnect / discovery / `/reload`
 * / bridge takeover) were silently dropped, so a running subagent's detail
 * panel stayed empty or stale until the next tick — or until completion, when
 * the durable reducer backfill kicks in. See change:
 * fix-subagent-live-detail-reliability.
 *
 * This buffer closes that gap two ways:
 *  - D1 buffer-and-flush: while not ready, retain the latest frame per
 *    `agentId` (each frame carries a FULL snapshot, so latest supersedes
 *    older ones) in a bounded map, and drain it on the next re-register.
 *  - D2 resync: keep the latest snapshot of each RUNNING subagent so the
 *    client can pull current state after a gap that outlived the buffer
 *    (long disconnect) or when opening detail for a running subagent whose
 *    `entries[]` is empty. Finished subagents are dropped from the snapshot
 *    map — the durable completed-case backfill already covers them, so a
 *    resync for an unknown/finished agent is a no-op.
 */

/** A subagent EventBus frame: the raw channel name plus its data payload. */
export interface SubagentFrame {
  channel: string;
  data: Record<string, unknown>;
}

/** EventBus channels that carry subagent lifecycle frames. */
export const SUBAGENT_CHANNELS = new Set<string>([
  "subagents:created",
  "subagents:started",
  "subagents:completed",
  "subagents:failed",
]);

/** Channels that terminate a subagent run (drop it from the resync snapshots). */
const TERMINAL_CHANNELS = new Set<string>(["subagents:completed", "subagents:failed"]);

export interface SubagentFrameStats {
  /** Frames forwarded live (ready path). */
  forwarded: number;
  /** Frames buffered because the bridge was not ready. */
  buffered: number;
  /** Frames drained + forwarded on re-register. */
  flushed: number;
  /** Not-ready frames that could not be buffered (no `agentId`). */
  droppedNoAgentId: number;
  /** Frames/snapshots evicted because the 64-agent bound was exceeded. */
  overflowEvicted: number;
  /** Resync requests received. */
  resyncRequests: number;
  /** Resync requests answered with a snapshot. */
  resyncServed: number;
  /** Resync requests served via the fast `agentId` key. */
  resyncByAgentId: number;
  /** Resync requests served via the derived `agentSessionId` values-scan. */
  resyncByAgentSessionId: number;
  /** Resync requests for an unknown/finished agent (no-op). */
  resyncNoop: number;
}

export class SubagentFrameBuffer {
  /** agentId → latest buffered frame (retained across a not-ready window). */
  private readonly pending = new Map<string, SubagentFrame>();
  /** agentId → latest snapshot of a still-running subagent (for resync). */
  private readonly snapshots = new Map<string, SubagentFrame>();

  readonly stats: SubagentFrameStats = {
    forwarded: 0,
    buffered: 0,
    flushed: 0,
    droppedNoAgentId: 0,
    overflowEvicted: 0,
    resyncRequests: 0,
    resyncServed: 0,
    resyncByAgentId: 0,
    resyncByAgentSessionId: 0,
    resyncNoop: 0,
  };

  /** @param maxAgents bound on distinct buffered agents (drop-oldest beyond it). */
  constructor(private readonly maxAgents = 64) {}

  static isSubagentChannel(channel: string): boolean {
    return SUBAGENT_CHANNELS.has(channel);
  }

  static agentIdOf(data: Record<string, unknown> | undefined): string | undefined {
    return data && typeof data.id === "string" ? data.id : undefined;
  }

  /**
   * The runner session id (v7) a frame carries on its `details`, if any. The
   * producer (>= 0.2.3) sets `agentSessionId` on `AgentDetails` = the frame
   * `data.details` payload. Absent → undefined (older producer).
   */
  static agentSessionIdOf(data: Record<string, unknown> | undefined): string | undefined {
    const details = data?.details as Record<string, unknown> | undefined;
    return details && typeof details.agentSessionId === "string" ? details.agentSessionId : undefined;
  }

  /**
   * Evict the oldest-inserted keys from `map` until it fits `maxAgents`.
   * Each eviction is real data loss, so it bumps the overflow counter.
   */
  private evictToBound(map: Map<string, SubagentFrame>): void {
    while (map.size > this.maxAgents) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
      this.stats.overflowEvicted += 1;
    }
  }

  /**
   * Update the running-subagent snapshot map. Called for every subagent frame
   * regardless of ready state so a resync can always return current state.
   * Bounded to `maxAgents` with the same latest-wins / drop-oldest policy as
   * `pending`, so retained resync snapshots cannot grow unbounded.
   */
  private track(channel: string, agentId: string, data: Record<string, unknown>): void {
    if (TERMINAL_CHANNELS.has(channel)) {
      this.snapshots.delete(agentId);
      return;
    }
    // Re-insert to move this agent to the most-recent position, then bound.
    this.snapshots.delete(agentId);
    this.snapshots.set(agentId, { channel, data });
    this.evictToBound(this.snapshots);
  }

  /**
   * Record a subagent frame that IS being forwarded live. Updates the resync
   * snapshot and the forwarded counter. Call on the ready path.
   */
  markForwarded(channel: string, data: Record<string, unknown>): void {
    const agentId = SubagentFrameBuffer.agentIdOf(data);
    if (agentId) this.track(channel, agentId, data);
    this.stats.forwarded += 1;
  }

  /**
   * Buffer a subagent frame emitted while the bridge is NOT ready. Retains the
   * latest frame per `agentId`; when the distinct-agent bound is exceeded,
   * evicts the oldest-inserted agent. Returns true if buffered, false if it
   * could not be buffered (no `agentId` on the frame).
   */
  buffer(channel: string, data: Record<string, unknown>): boolean {
    const agentId = SubagentFrameBuffer.agentIdOf(data);
    if (!agentId) {
      this.stats.droppedNoAgentId += 1;
      return false;
    }
    this.track(channel, agentId, data);
    // Re-insert to move this agent to the most-recent position (emission order).
    this.pending.delete(agentId);
    this.pending.set(agentId, { channel, data });
    this.evictToBound(this.pending);
    this.stats.buffered += 1;
    return true;
  }

  /**
   * Drain the buffered frames in emission order (oldest-inserted agent first).
   * Clears the buffer; the caller forwards each returned frame. The resync
   * snapshots are intentionally NOT cleared — a subagent can still be running.
   */
  drain(): SubagentFrame[] {
    const out = [...this.pending.values()];
    this.pending.clear();
    this.stats.flushed += out.length;
    return out;
  }

  /**
   * Resync (D2): the latest retained snapshot for a running subagent, or
   * undefined for an unknown/finished agent (caller replies with nothing).
   *
   * The incoming `id` may be EITHER the v4 `agentId` (fast-path key lookup) or
   * the v7 runner `agentSessionId` carried on a frame's `details` (derived
   * values-scan fallback). The mapping is a pure function of the already-bounded
   * (≤ maxAgents) `snapshots` map — no separate alias index, no `finished` set —
   * so it cannot leak or diverge. The scan is O(≤ maxAgents) on a rare,
   * user-initiated cold path. Terminal/evicted runs retain no snapshot, so both
   * ids resolve to nothing. See change: resolve-subagent-inspector-by-session-id (D3).
   */
  resync(id: string): SubagentFrame | undefined {
    this.stats.resyncRequests += 1;
    const byAgentId = this.snapshots.get(id);
    if (byAgentId) {
      this.stats.resyncServed += 1;
      this.stats.resyncByAgentId += 1;
      return byAgentId;
    }
    for (const snap of this.snapshots.values()) {
      if (SubagentFrameBuffer.agentSessionIdOf(snap.data) === id) {
        this.stats.resyncServed += 1;
        this.stats.resyncByAgentSessionId += 1;
        return snap;
      }
    }
    this.stats.resyncNoop += 1;
    return undefined;
  }

  /** Drop all retained state (session change / shutdown). */
  reset(): void {
    this.pending.clear();
    this.snapshots.clear();
  }

  /** Number of distinct agents currently buffered. */
  get pendingSize(): number {
    return this.pending.size;
  }
}
