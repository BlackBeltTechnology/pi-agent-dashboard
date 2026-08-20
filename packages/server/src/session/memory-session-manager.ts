/**
 * Pure in-memory session registry.
 * Replaces SQLite-backed session-manager.ts.
 */
import type { DashboardSession, SessionSource, SessionStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { deriveEndedAt, type EndedAtDeriver } from "./derive-ended-at.js";

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
}

export interface RegisterSessionParams {
  id: string;
  cwd: string;
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
  unregister(sessionId: string, opts?: UnregisterOptions): void;
  update(sessionId: string, updates: Partial<DashboardSession>): void;
  get(sessionId: string): DashboardSession | undefined;
  listActive(): DashboardSession[];
  listAll(): DashboardSession[];
  /** Called after any mutation (register, unregister, update). Receives the affected session ID and optional context. */
  onChange?: (sessionId: string, ctx?: OnChangeContext) => void;
  /** Called after a session is unregistered (status set to ended). */
  onUnregister?: (sessionId: string) => void;
}

export function createMemorySessionManager(
  derive: EndedAtDeriver = deriveEndedAt,
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

  const mgr: SessionManager = {
    register(params: RegisterSessionParams): DashboardSession {
      // Preserve accumulated data (tokens, cost) from a prior session with the
      // same ID (e.g. restored after server restart). Git and openspec data are
      // polled by the bridge extension shortly after reconnect, so they don't
      // need to be carried over.
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
          // Preserve context usage until bridge sends fresh data
          contextTokens: existing.contextTokens,
          contextWindow: existing.contextWindow,
        } : {
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
        }),
        // Apply registration params (always override)
        id: params.id,
        cwd: params.cwd,
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

    unregister(sessionId: string, opts?: UnregisterOptions): void {
      const session = sessions.get(sessionId);
      if (session) {
        session.status = "ended";
        // An ended session is not compacting. Without this an unregister that
        // lands mid-compaction leaves the flag set on the record, and the
        // reload dispatcher would refuse forever on a session restored from
        // that record. See change: fix-out-of-band-reload.
        session.compacting = false;
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
        mgr.onChange?.(sessionId);
        mgr.onUnregister?.(sessionId);
      }
    },

    update(sessionId: string, updates: Partial<DashboardSession>): void {
      const session = sessions.get(sessionId);
      if (session) {
        Object.assign(session, updates);
        ensureEndedAt(session);
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
  };

  return mgr;
}
