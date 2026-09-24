/**
 * Pure in-memory session registry.
 * Replaces SQLite-backed session-manager.ts.
 */

import { pathKey } from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";
import type { ClosedReason, DashboardSession, SessionSource, SessionStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { deriveEndedAt, type EndedAtDeriver } from "./derive-ended-at.js";
import { resolveOrderKey } from "./resolve-order-key.js";

/**
 * Snapshot window constants (D4). The specs state the same numbers.
 * `SNAPSHOT_ENDED_GLOBAL` — newest ended sessions kept overall, by
 * `endedAt ?? lastActivityAt ?? startedAt` desc.
 * `SNAPSHOT_ENDED_PER_GROUP` — first entries of `endedSequence(g)` kept for
 * every group with a non-ended session or a pin.
 * See change: fix-connect-snapshot-frame-loss.
 */
const SNAPSHOT_ENDED_GLOBAL = 120;
const SNAPSHOT_ENDED_PER_GROUP = 3;

/**
 * Persisted-order read surface the snapshot window needs. Structural subset
 * of `SessionOrderManager`, so the real manager satisfies it directly.
 * See change: fix-connect-snapshot-frame-loss (D4).
 */
export interface SnapshotOrders {
  getOrder(groupKey: string): string[];
  getAllOrders(): Record<string, string[]>;
}

/**
 * Shallow copy of a session row minus `notifyLog`. Snapshot and page rows are
 * stripped because the notify log is replayed on subscribe — carrying it in
 * every row is what pushed `sessions_snapshot` past MAX_WS_BUFFER.
 * See change: fix-connect-snapshot-frame-loss (D4).
 */
export function stripNotifyLog(session: DashboardSession): DashboardSession {
  const { notifyLog: _dropped, ...row } = session;
  return row;
}

/** Wire shape of `buildSnapshot` — the connect `sessions_snapshot` payload body. */
export interface SnapshotResult {
  /** Windowed rows, `notifyLog`-stripped. */
  sessions: DashboardSession[];
  /** groupKey → persisted order filtered to the window (non-empty entries only). */
  orders: Record<string, string[]>;
  /** groupKey → ended count regardless of window, for every group with ≥1 ended. */
  endedTotals: Record<string, number>;
}

/**
 * How a session's ending became known. `witnessed` — the server observed it
 * (explicit end signal, user-initiated termination) — stamps the time of the
 * event. `inferred` — a heartbeat/grace expiry, or a history record being
 * unregistered right after it was registered — derives the time from evidence,
 * because the end happened earlier and was only detected now.
 * See change: fix-ended-session-missing-endedat.
 */
export interface UnregisterOptions {
  /** Default `true` — preserves the observed-ending `Date.now()` stamp. */
  witnessed?: boolean;
  /**
   * Why the session is ending. Call sites that know their cause pass it
   * explicitly (`"manual"`, `"spawn_failed"`, a pid probe result); a terminal
   * transition with no better information is stamped `"unknown"` centrally.
   * See change: stop-discarding-known-session-state.
   */
  closedReason?: ClosedReason;
}

export interface RegisterSessionParams {
  id: string;
  cwd: string;
  /**
   * Paired-device id when the registering bridge was REMOTE. Absent means the
   * session's files are on this host. Derived by the gateway from the
   * connection credential — never from anything the bridge sent.
   */
  originDeviceId?: string;
  name?: string;
  source: SessionSource;
  model?: string;
  thinkingLevel?: string;
  sessionFile?: string;
  sessionDir?: string;
  firstMessage?: string;
  startedAt?: number;
  pid?: number;
  /**
   * Why the bridge is registering this session. Forwarded from the
   * `session_register` protocol message (see
   * `SessionRegisterMessage.registerReason`). Used by `onChange` to
   * decide whether to apply the configured `reattachPlacement` policy.
   * See change: reattach-move-to-front.
   */
  registerReason?: "spawn" | "reattach";
  /**
   * Whether a TUI is attached to the pi process (forwarded from
   * `SessionRegisterMessage.hasUI`). `false` for headless/print-mode
   * workers. Drives the first-register auto-hide heuristic. Absent ⇒
   * no auto-hide (legacy bridge).
   * See change: auto-hide-headless-worker-sessions.
   */
  hasUI?: boolean;
  /**
   * Explicit visibility override forwarded from
   * `SessionRegisterMessage.visibilityIntent`. Wins over the heuristic at
   * first register.
   * See change: auto-hide-headless-worker-sessions.
   */
  visibilityIntent?: "hidden" | "visible";
  /**
   * Strong dashboard-spawn signal, forwarded from `session_register`
   * (`SessionRegisterMessage.dashboardSpawned`) and normalized to a strict
   * boolean by the gateway. Replaces `params.source` in the auto-hide
   * heuristic: `source` is the bridge's SELF-REPORT, evaluated before
   * `decideDashboardSource` stamps `"dashboard"`, so it can never carry the
   * value the heuristic was testing for.
   * See change: fix-spawn-correlation-ttl-coupling (D3).
   */
  dashboardSpawned?: boolean;
}

export interface OnChangeContext {
  /**
   * Set when `onChange` is fired from `register(...)` and the inbound
   * params carried a `registerReason`. Undefined for `update`/`unregister`
   * paths and for legacy registers without the field.
   * See change: reattach-move-to-front.
   */
  registerReason?: "spawn" | "reattach";
  /**
   * The session's status BEFORE `register(...)` overwrote it to `"active"`.
   * Captured because `register()` unconditionally sets `status: "active"`,
   * which would otherwise hide a `"streaming"` reattach from policies
   * that gate on streaming. Undefined for first-ever registers and for
   * `update`/`unregister` paths.
   * See change: reattach-move-to-front.
   */
  priorStatus?: SessionStatus;
}

export interface SessionManager {
  register(params: RegisterSessionParams): DashboardSession;
  /** Restore a previously persisted session (e.g. on startup). Does not trigger onChange. */
  restore(session: DashboardSession): void;
  /**
   * Evict a session from the live registry without marking it ended or
   * emitting `onChange`/`onUnregister`. Used by the archive transition, which
   * has already persisted the sidecar and does not want a further debounced
   * write to originate for a non-resident session.
   * See change: archive-sessions-lazy-load.
   */
  remove(sessionId: string): void;
  unregister(sessionId: string, opts?: UnregisterOptions): void;
  update(sessionId: string, updates: Partial<DashboardSession>): void;
  get(sessionId: string): DashboardSession | undefined;
  listActive(): DashboardSession[];
  listAll(): DashboardSession[];
  /**
   * Ended ids of `groupKey` in render order: the persisted order restricted
   * to ended ids, then ended ids with no persisted position by `startedAt`
   * desc — byte-for-byte the order the client's `sortSessionsByOrder`
   * renders. `pinned` is the pinned-directory list the group keys resolve
   * against. See change: fix-connect-snapshot-frame-loss (D4).
   */
  endedSequence(groupKey: string, pinned?: readonly string[]): string[];
  /**
   * The snapshot window id set, recomputed on every call: all non-ended ∪
   * global newest-`SNAPSHOT_ENDED_GLOBAL` ended ∪ per-group first
   * `SNAPSHOT_ENDED_PER_GROUP` of `endedSequence(g)` for groups with a
   * non-ended session or a pin. See change: fix-connect-snapshot-frame-loss (D4).
   */
  snapshotVisibleIds(pinned?: readonly string[]): Set<string>;
  /**
   * Windowed connect snapshot: stripped rows, window-filtered orders,
   * `endedTotals` per group. See change: fix-connect-snapshot-frame-loss (D4).
   */
  buildSnapshot(pinned?: readonly string[]): SnapshotResult;
  /** Called after any mutation (register, unregister, update). Receives the affected session ID and optional context. */
  onChange?: (sessionId: string, ctx?: OnChangeContext) => void;
  /** Called after a session is unregistered (status set to ended). */
  onUnregister?: (sessionId: string) => void;
  /**
   * Called on the EXACT transition to `ended`, from BOTH seams (`unregister`
   * and `update`), before `onChange`. The eager, durable write point for the
   * terminal `closedReason`: `onUnregister` covers only the unregister seam,
   * and the routine `onChange` save is a full `.meta.json` overwrite that does
   * not enumerate the field. See change: stop-discarding-known-session-state.
   */
  onEnded?: (sessionId: string) => void;
}

export function createMemorySessionManager(
  derive: EndedAtDeriver = deriveEndedAt,
  /** Persisted orders the snapshot window reads; absent → empty orders. */
  orders?: SnapshotOrders,
): SessionManager {
  const sessions = new Map<string, DashboardSession>();

  /**
   * The invariant: a session in the map with `status: "ended"` always carries
   * an `endedAt`. Fills only when absent — an explicitly supplied value is
   * always preserved.
   *
   * The conditional short-circuits BEFORE `derive` so the common case costs
   * nothing: this runs on `update()`, which fires on every activity event, and
   * on `restore()`, which runs once per record over a ~3,300-record store.
   *
   * Never emits `onChange` — see D1a: at boot the restore loop precedes the
   * ended-id seeding, so an emitting helper would `moveToFront` every restored
   * record and broadcast a `sessions_reordered` storm, churning the very stored
   * order this change protects.
   */
  function ensureEndedAt(session: DashboardSession): void {
    if (session.status !== "ended" || session.endedAt !== undefined) return;
    session.endedAt = derive(session);
  }

  // ── Snapshot window (D4) — see change: fix-connect-snapshot-frame-loss ──

  /** Group key the sidebar groups/orders by (pin > worktree mainPath > cwd). */
  const groupKeyOf = (s: DashboardSession, pinned: readonly string[]): string =>
    resolveOrderKey(s, pinned);

  /** Global-window sort key: `endedAt ?? lastActivityAt ?? startedAt` (startedAt is always set). */
  const endedSortKey = (s: DashboardSession): number => s.endedAt ?? s.lastActivityAt ?? s.startedAt;

  function endedSequence(groupKey: string, pinned: readonly string[] = []): string[] {
    const ended: DashboardSession[] = [];
    for (const s of sessions.values()) {
      if (s.status === "ended" && groupKeyOf(s, pinned) === groupKey) ended.push(s);
    }
    const inGroup = new Set(ended.map((s) => s.id));
    const persisted = (orders?.getOrder(groupKey) ?? []).filter((id) => inGroup.has(id));
    const persistedSet = new Set(persisted);
    const unpersisted = ended
      .filter((s) => !persistedSet.has(s.id))
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((s) => s.id);
    return [...persisted, ...unpersisted];
  }

  function snapshotVisibleIds(pinned: readonly string[] = []): Set<string> {
    const visible = new Set<string>();
    const endedAll: DashboardSession[] = [];
    const endedByGroup = new Map<string, DashboardSession[]>();
    const groupsWithNonEnded = new Set<string>();
    for (const s of sessions.values()) {
      if (s.status === "ended") {
        endedAll.push(s);
        const g = groupKeyOf(s, pinned);
        let list = endedByGroup.get(g);
        if (!list) {
          list = [];
          endedByGroup.set(g, list);
        }
        list.push(s);
      } else {
        visible.add(s.id);
        groupsWithNonEnded.add(groupKeyOf(s, pinned));
      }
    }
    // Global window: newest N ended, id asc as the deterministic tiebreak.
    const globalWindow = endedAll
      .sort((a, b) => endedSortKey(b) - endedSortKey(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, SNAPSHOT_ENDED_GLOBAL);
    for (const s of globalWindow) visible.add(s.id);
    // Per-group window: first N of the group's ended sequence, for groups
    // with a non-ended session or a pin.
    const pinnedKeys = new Set(pinned.map((d) => pathKey(d, process.platform)));
    for (const [g, list] of endedByGroup) {
      if (!groupsWithNonEnded.has(g) && !pinnedKeys.has(pathKey(g, process.platform))) continue;
      for (const id of endedSequence(g, pinned).slice(0, SNAPSHOT_ENDED_PER_GROUP)) {
        visible.add(id);
      }
    }
    return visible;
  }

  function buildSnapshot(pinned: readonly string[] = []): SnapshotResult {
    // One visible-set computation feeds BOTH rows and orders, so the snapshot
    // stays self-consistent even if a session's status flips mid-build (X7).
    const visible = snapshotVisibleIds(pinned);
    const rows: DashboardSession[] = [];
    for (const s of sessions.values()) {
      if (visible.has(s.id)) rows.push(stripNotifyLog(s));
    }
    const windowedOrders: Record<string, string[]> = {};
    for (const [g, ids] of Object.entries(orders?.getAllOrders() ?? {})) {
      const filtered = ids.filter((id) => visible.has(id));
      if (filtered.length > 0) windowedOrders[g] = filtered;
    }
    const endedTotals: Record<string, number> = {};
    for (const s of sessions.values()) {
      if (s.status !== "ended") continue;
      const g = groupKeyOf(s, pinned);
      endedTotals[g] = (endedTotals[g] ?? 0) + 1;
    }
    return { sessions: rows, orders: windowedOrders, endedTotals };
  }

  const mgr: SessionManager = {
    register(params: RegisterSessionParams): DashboardSession {
      // Preserve accumulated data (tokens, cost) from a prior session with the
      // same ID (e.g. restored after server restart). Openspec data is polled
      // by the bridge extension shortly after reconnect, so it doesn't need to
      // be carried over. `gitWorktree` is NOT re-polled when the worktree no
      // longer exists, so it is carried over for a same-cwd reattach (below).
      const existing = sessions.get(params.id);
      const priorStatus = existing?.status;

      const session: DashboardSession = {
        // Carry over accumulated data from the existing session (e.g. restored after restart)
        ...(existing ? {
          tokensIn: existing.tokensIn,
          tokensOut: existing.tokensOut,
          cacheRead: existing.cacheRead,
          cacheWrite: existing.cacheWrite,
          cost: existing.cost,
          // Preserve user-set openspec assignment (not polled, set via dashboard UI)
          attachedProposal: existing.attachedProposal,
          // Preserve user-owned tags across a bridge reattach (not polled, set via
          // dashboard UI). Without this the reattach onChange save wipes them from
          // disk. See change: fix-tags-lost-on-bridge-reattach.
          tags: existing.tags,
          // Preserve retained notifications across a bridge reattach — the
          // reattach onChange save is a full .meta.json overwrite, so dropping
          // them here would wipe them from disk too.
          // See change: split-notify-from-prompt-request.
          notifyLog: existing.notifyLog,
          // Preserve the identity-plane owner across a bridge reattach
          // (dashboard restart). Same full-overwrite hazard as `tags`: dropping
          // it here wipes it from disk and the session turns ownerless.
          // A re-register never CHANGES an owner (only the spawn token does).
          principalOwner: existing.principalOwner,
          // Preserve context usage until bridge sends fresh data
          contextTokens: existing.contextTokens,
          contextWindow: existing.contextWindow,
          // Preserve resolved worktree parentage across a SAME-cwd reattach
          // (server restart / bridge reconnect / resume). A different cwd
          // starts unresolved and the bridge re-reports it. Without this, the
          // reconnect cache reset forces a fresh `gitWorktree: null` while the
          // guard has no `prior` to protect — re-opening the clear during the
          // worktree-removal window. See design D2b.
          // See change: fix-worktree-grouping-lost-on-remove.
          gitWorktree: existing.cwd === params.cwd ? existing.gitWorktree : undefined,
        } : {
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
        }),
        // Apply registration params (always override)
        id: params.id,
        cwd: params.cwd,
        originDeviceId: params.originDeviceId,
        name: params.name ?? existing?.name,
        source: params.source,
        status: "active",
        model: params.model,
        thinkingLevel: params.thinkingLevel,
        startedAt: params.startedAt ?? existing?.startedAt ?? Date.now(),
        endedAt: undefined,
        sessionFile: params.sessionFile,
        sessionDir: params.sessionDir,
        // Auto-hide decision (single writer). On reattach (an already-known
        // session re-registering after a dashboard restart / reconnect) the
        // prior `hidden` is preserved so a manual unhide/hide survives. On
        // first register (spawn / legacy / no prior record) an explicit
        // visibilityIntent wins, else headless non-dashboard sessions are
        // hidden. The last branch reads the dashboard-spawn SIGNAL, never the
        // bridge's pre-decision `source`.
        // See change: auto-hide-headless-worker-sessions,
        //             fix-spawn-correlation-ttl-coupling (D3).
        hidden: (params.registerReason === "reattach" && existing)
          ? existing.hidden
          : params.visibilityIntent === "hidden"
            ? true
            : params.visibilityIntent === "visible"
              ? false
              : params.hasUI === false && params.dashboardSpawned !== true,
        firstMessage: params.firstMessage ?? existing?.firstMessage,
        dataUnavailable: false,
        pid: params.pid,
        // Pi-native queue mirror: reset to empty on register / re-register;
        // a fresh `queue_update` from the bridge populates it.
        // See change: add-followup-edit-and-steer-cancel.
        pendingQueues: { steering: [], followUp: [] },
      };
      sessions.set(params.id, session);
      mgr.onChange?.(params.id, {
        registerReason: params.registerReason,
        priorStatus,
      });
      return session;
    },

    restore(session: DashboardSession): void {
      ensureEndedAt(session);
      sessions.set(session.id, session);
    },

    remove(sessionId: string): void {
      sessions.delete(sessionId);
    },

    unregister(sessionId: string, opts?: UnregisterOptions): void {
      const session = sessions.get(sessionId);
      if (session) {
        // Capture BEFORE flipping: a duplicate termination signal for an
        // already-ended session is not a new ending and must not overwrite a
        // good reason with `unknown` (design D1).
        const wasEnded = session.status === "ended";
        session.status = "ended";
        // Central `→ ended` stamp (design D1 option B): no unregister path can
        // produce an unlabelled death. Call sites that know better pass an
        // explicit reason; the rest get `unknown`.
        if (!wasEnded && session.closedReason === undefined) {
          session.closedReason = opts?.closedReason ?? "unknown";
        }
        // An ended session is not compacting. Without this an unregister that
        // lands mid-compaction leaves the flag set on the record, and the
        // reload dispatcher would refuse forever on a session restored from
        // that record. See change: fix-out-of-band-reload.
        session.compacting = false;
        // A dead session has no host pressure: the verdict describes a LIVE
        // bridge's silence, and leaving it on the row lets a later
        // `sessions_snapshot` serve a stale badge for a card that is gone.
        // See change: fix-false-unresponsive-badge.
        session.hostPressure = undefined;
        // Witnessed (the default) keeps the observed instant. An inferred
        // ending — heartbeat/grace expiry, or history registered then
        // immediately unregistered — must not record detection time.
        //
        // Only stamp when the record does not already carry one: a duplicate
        // termination signal for an already-ended session is not a new ending,
        // and moving the timestamp would violate the same "an explicit value is
        // preserved" rule `ensureEndedAt` honours (and could reshuffle the
        // ended-tier order seed). See change: fix-ended-session-missing-endedat.
        if (session.endedAt === undefined) {
          session.endedAt = opts?.witnessed === false ? derive(session) : Date.now();
        }
        if (!wasEnded) mgr.onEnded?.(sessionId);
        mgr.onChange?.(sessionId);
        mgr.onUnregister?.(sessionId);
      }
    },

    update(sessionId: string, updates: Partial<DashboardSession>): void {
      const session = sessions.get(sessionId);
      if (session) {
        // Central `→ ended` stamp, mirroring `unregister`. `wasEnded` makes the
        // detection exact: a no-op update on an already-ended session must not
        // overwrite a good reason with `unknown` (design D1).
        const wasEnded = session.status === "ended";
        const priorReason = session.closedReason;
        Object.assign(session, updates);
        ensureEndedAt(session);
        // Also fire when an ended record has NO reason (an explicit `undefined`
        // key in `updates` can clear it): the invariant is "no ended session
        // without a reason", and a stale reason already set is never touched.
        if (session.status === "ended" && session.closedReason === undefined) {
          session.closedReason = "unknown";
        }
        // Same clearing rule as `unregister`, for the seam that ends a session
        // via `update({ status: "ended" })`.
        // See change: fix-false-unresponsive-badge.
        if (session.status === "ended") session.hostPressure = undefined;
        // Persist on the terminal TRANSITION **and** whenever the reason CHANGES
        // (e.g. an already-ended session learns a better reason). Firing only on
        // the transition would skip the eager `setLiveness` write for the latter,
        // leaving the reason stale on disk after the next full-overwrite save.
        const endedNewly = !wasEnded && session.status === "ended";
        const reasonChanged = session.status === "ended" && session.closedReason !== priorReason;
        if (endedNewly || reasonChanged) mgr.onEnded?.(sessionId);
        mgr.onChange?.(sessionId);
      }
    },

    get(sessionId: string): DashboardSession | undefined {
      return sessions.get(sessionId);
    },

    listActive(): DashboardSession[] {
      return Array.from(sessions.values()).filter((s) => s.status !== "ended");
    },

    listAll(): DashboardSession[] {
      return Array.from(sessions.values());
    },

    endedSequence,

    snapshotVisibleIds,

    buildSnapshot,
  };

  return mgr;
}
