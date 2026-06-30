/**
 * Event wiring: connects pi gateway events to browser gateway and session management.
 * Extracted from server.ts for clarity.
 */
import type { SessionManager } from "./memory-session-manager.js";
import type { EventStore } from "./memory-event-store.js";
import type { PiGateway } from "./pi-gateway.js";
import type { BrowserGateway } from "./browser-gateway.js";
import type { SessionOrderManager } from "./session-order-manager.js";
import type { PreferencesStore } from "./preferences-store.js";
import { resolveOrderKey } from "./resolve-order-key.js";
import type { PendingForkRegistry } from "./pending-fork-registry.js";
import type { DirectoryService } from "./directory-service.js";
import { extractSessionUpdates, isActivityEvent, isUnreadTrigger } from "./event-status-extraction.js";
import { composeWorktreePayload } from "./git-worktree-compose.js";
import type { ViewedSessionTracker } from "./viewed-session-tracker.js";
import { setCatalogueForSession } from "./provider-catalogue-cache.js";
import { spawnPiSession } from "./process-manager.js";
import { classifyProcesses, buildPidIndex } from "./process-classifier.js";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { mergeSessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { detectOpenSpecActivity, isValidOpenSpecChangeSlug } from "@blackbelt-technology/pi-dashboard-shared/openspec-activity-detector.js";
import { extractTurnStats } from "@blackbelt-technology/pi-dashboard-shared/stats-extractor.js";
import { attachRenameTarget, isNameAutoSetFromAttachment } from "./proposal-attach-naming.js";
import { handleDispatchExtensionCommand } from "./rpc-keeper/dispatch-router.js";
import { keeperOptsFromSpawnResult } from "./headless-pid-registry.js";
import { decideDashboardSource } from "./dashboard-source-decision.js";

/**
 * `true` iff `changeName` appears in the cwd's authoritative OpenSpec poll
 * cache. Returns `true` when the poll cache is absent / not yet initialized
 * (unknown → conservative: keep manual-attachment semantics). Returns
 * `false` only when poll data is authoritative AND omits the name
 * (archived/deleted) — the deleted-proposal bypass. Reads in-memory cache;
 * never triggers a poll.
 * See change: replace-proposal-dialog-with-race-handling.
 */
function openSpecChangeExistsInCache(
  directoryService: DirectoryService,
  cwd: string,
  changeName: string,
): boolean {
  const data = directoryService.getOpenSpecData(cwd);
  if (!data || !data.initialized) return true;
  return data.changes.some((c) => c.name === changeName);
}

/**
 * Server-side opt-in flag (`STRICT_SPAWN_CORRELATION=1`) that suppresses
 * the legacy cwd-FIFO source-stamp fallback. Read once at module init
 * because env vars don't change at runtime in normal operation; tests
 * that need to flip it should re-import or use vi.stubEnv before module
 * load.
 * See change: fix-dashboard-spawn-correlation-by-token.
 */
const STRICT_SPAWN_CORRELATION =
  process.env.STRICT_SPAWN_CORRELATION === "1";

export interface EventWiringDeps {
  sessionManager: SessionManager;
  eventStore: EventStore;
  piGateway: PiGateway;
  browserGateway: BrowserGateway;
  sessionOrderManager: SessionOrderManager;
  /** Source of pinned directories so order-map keys resolve via
   *  `resolveOrderKey` (parent repo for worktree sessions).
   *  See change: simplify-session-card-ordering. */
  preferencesStore: PreferencesStore;
  /** Live gate accessors for status-transition placement. Read fresh per
   *  event so Settings toggles apply without restart.
   *  See change: simplify-session-card-ordering. */
  isCompletedFirst?: () => boolean;
  isQuestionFirst?: () => boolean;
  pendingForkRegistry: PendingForkRegistry;
  directoryService: DirectoryService;
  knownSessionIds: Set<string>;
  pendingDashboardSpawns: Map<string, number>;
  /**
   * Optional pending-attach registry. When provided, the wiring consumes a
   * pending intent on each `session_register` and applies the attach +
   * auto-rename. See change: add-folder-task-checker-and-spawn-attach.
   */
  pendingAttachRegistry?: import("./pending-attach-registry.js").PendingAttachRegistry;
  /**
   * Optional pending-worktree-base registry. When provided, the wiring
   * consumes a pending base ref on each `session_register` and persists
   * it to the session's `.meta.json` sidecar + stamps the in-memory
   * `DashboardSession.gitWorktreeBase` so a later `git_info_update`
   * composes `gitWorktree.base` correctly.
   * See change: add-worktree-spawn-dialog.
   */
  pendingWorktreeBaseRegistry?: import("./pending-worktree-base-registry.js").PendingWorktreeBaseRegistry;
  /**
   * Optional pending-automation-run registry. When provided, the wiring
   * consumes a pending run stamp on each `session_register` and stamps the
   * in-memory `DashboardSession.kind="automation"` + `automationRun`, then
   * persists both to the session's `.meta.json` sidecar.
   * See change: add-automation-plugin.
   */
  pendingAutomationRunRegistry?: import("./pending-automation-run-registry.js").PendingAutomationRunRegistry;
  /**
   * Optional pending-goal-link registry + goal store. When both provided, the
   * wiring consumes a pending goalId on each `session_register`, stamps
   * `.meta.json#goalId` + in-memory `DashboardSession.goalId`, and links the
   * new sessionId into its `GoalRecord`. See change: add-goals-folder-page.
   */
  pendingGoalLinkRegistry?: import("./pending-goal-link-registry.js").PendingGoalLinkRegistry;
  goalStore?: import("./goal-store.js").GoalStore;
  /**
   * Optional goal-session primer. When provided, a session linked to a goal on
   * `session_register` is renamed to the objective and dispatched `/goal …` so
   * the pi-goal-hermes loop actually starts. See change: prime-goal-linked-sessions.
   */
  primeGoalSession?: (
    sessionId: string,
    goal: { objective: string; criteria?: import("@blackbelt-technology/pi-dashboard-shared/types.js").GoalCriterion[] },
  ) => void;
  /**
   * Optional viewed-session tracker. When provided, the wiring evaluates
   * `isUnreadTrigger(...)` on each forwarded event and stamps
   * `session.unread = true` for sessions no browser is currently viewing.
   * See change: session-card-unread-stripes.
   */
  viewedSessionTracker?: ViewedSessionTracker;
  /**
   * Optional client-correlation registry. When provided, the wiring
   * consumes the requestId for the resolved spawnToken after a successful
   * three-tier link and surfaces it on `session_added` as `spawnRequestId`,
   * letting the client auto-select / dismiss its placeholder by exact
   * correlation. See change: spawn-correlation-token.
   */
  pendingClientCorrelations?: import("./pending-client-correlations.js").PendingClientCorrelations;
  /**
   * Optional plugin pi-message dispatcher. When provided, every
   * `plugin_pi_message` envelope forwarded from a plugin bridge entry is
   * routed to plugin-server handlers registered via
   * `ServerPluginContext.registerPiHandler(messageType, handler)`.
   * See change: add-goal-continuation-plugin.
   */
  dispatchPluginPiMessage?: (messageType: string, msg: unknown) => void;
  /**
   * Optional raw pi-event fan-out. When provided, every forwarded
   * `event_forward` event is delivered to plugin-server subscribers
   * registered via `ServerPluginContext.onEvent(handler)`.
   * See change: add-goal-continuation-plugin.
   */
  dispatchPluginRawEvent?: (sessionId: string, event: unknown) => void;
}

/**
 * Wire up all event forwarding from pi gateway to browser gateway.
 * Sets piGateway.onEvent and sessionManager.onUnregister.
 */
export function wireEvents(deps: EventWiringDeps): void {
  const {
    sessionManager,
    eventStore,
    piGateway,
    browserGateway,
    sessionOrderManager,
    preferencesStore,
    isCompletedFirst,
    isQuestionFirst,
    pendingForkRegistry,
    directoryService,
    knownSessionIds,
    pendingDashboardSpawns,
    pendingAttachRegistry,
    pendingWorktreeBaseRegistry,
    pendingAutomationRunRegistry,
    pendingGoalLinkRegistry,
    goalStore,
    primeGoalSession,
    viewedSessionTracker,
    pendingClientCorrelations,
    dispatchPluginPiMessage,
    dispatchPluginRawEvent,
  } = deps;

  /**
   * Deferred order-key re-resolution. A worktree session registers BEFORE
   * its group identity (`gitWorktree.mainPath`)
   * arrives, so its id is inserted under the raw cwd key. Once a later
   * `git_info_update` establishes that identity, the
   * resolved key changes from the raw cwd to the parent key. This moves the
   * id to the FRONT of the resolved key (matching the "new session at top"
   * intent \u2014 the just-spawned session takes the placeholder's slot), prunes
   * the stale key when empty, and broadcasts a single `sessions_reordered`.
   * No-op when the key is unchanged (guarded by `rekey`).
   * See change: fix-worktree-spawn-placeholder-and-ordering.
   */
  function maybeRekeyOrder(sessionId: string, oldOrderKey: string | undefined): void {
    if (!oldOrderKey) return;
    const session = sessionManager.get(sessionId);
    if (!session) return;
    const pinned = preferencesStore.getPinnedDirectories();
    const newOrderKey = resolveOrderKey(session, pinned);
    if (newOrderKey === oldOrderKey) return;
    sessionOrderManager.rekey(oldOrderKey, newOrderKey, sessionId, { toFront: true });
    const validIds = new Set(
      sessionManager.listAll()
        .filter((s) => resolveOrderKey(s, pinned) === newOrderKey)
        .map((s) => s.id),
    );
    browserGateway.broadcastToAll({
      type: "sessions_reordered",
      cwd: newOrderKey,
      sessionIds: sessionOrderManager.getOrder(newOrderKey, validIds),
    });
  }

  // Broadcast placeholder session to browsers when auto-created from early events
  piGateway.onSessionCreated = (sessionId) => {
    const session = sessionManager.get(sessionId);
    if (session) {
      browserGateway.broadcastSessionAdded(session);
    }
  };

  // Consume any pending spawn-with-attach intent for the registering session.
  // See change: add-folder-task-checker-and-spawn-attach.
  //
  // Also consume any pending worktree-base intent (set by the
  // WorktreeSpawnDialog after a successful POST /api/git/worktree) and
  // persist it to the session's .meta.json. See change:
  // add-worktree-spawn-dialog.
  piGateway.onSessionRegistered = (sessionId, cwd) => {
    // ── attachProposal arm ───────────────────────────────────────────────
    let attachConsumed = false;
    if (pendingAttachRegistry) {
      const changeName = pendingAttachRegistry.consume(cwd);
      if (changeName) {
        attachConsumed = true;
        // Lazy import to avoid a circular type dep at module load.
        void import("./browser-handlers/session-meta-handler.js").then(({ applyAttachProposal }) => {
          applyAttachProposal(sessionId, changeName, {
            sessionManager,
            piGateway,
            broadcast: (msg) => {
              if (msg.type === "session_updated") {
                browserGateway.broadcastSessionUpdated(msg.sessionId, msg.updates);
              }
            },
          });
        });
      }
    }

    // ── attachProposal replay arm ─────────────────────────────────────────
    // When no pending spawn-with-attach intent fired (the common
    // dashboard-restart reattach case), replay the in-memory session's
    // current attachedProposal so the reattaching bridge syncs state. Push
    // the explicit value INCLUDING null: a detach that happened while no
    // bridge owned the session no-oped its push, so a reattaching bridge with
    // a stale persisted attachedChange must be cleared. The registry branch
    // above already pushed for the spawn-with-attach case, so skip then to
    // avoid a redundant send. See change: inject-session-context-into-agent.
    if (!attachConsumed) {
      const session = sessionManager.get(sessionId);
      if (session) {
        const attached =
          typeof session.attachedProposal === "string" && session.attachedProposal.length > 0
            ? session.attachedProposal
            : null;
        void import("./browser-handlers/session-meta-handler.js").then(({ pushAttachProposalChanged }) => {
          pushAttachProposalChanged({ piGateway }, sessionId, attached);
        });
      }
    }

    // ── gitWorktreeBase arm ───────────────────────────────────────────────
    if (pendingWorktreeBaseRegistry) {
      const base = pendingWorktreeBaseRegistry.consume(cwd);
      if (base) {
        // Stamp the in-memory session so a later git_info_update composes
        // gitWorktree.base correctly (see composeWorktreePayload).
        sessionManager.update(sessionId, { gitWorktreeBase: base });
        // Persist to .meta.json so the value survives server restart.
        // best-effort: a missing/unwritable sidecar should not break the
        // session register flow.
        const session = sessionManager.get(sessionId);
        if (session?.sessionFile) {
          try {
            mergeSessionMeta(session.sessionFile, { gitWorktreeBase: base });
          } catch (err) {
            console.warn(
              `[event-wiring] failed to persist gitWorktreeBase to .meta.json for ${sessionId}:`,
              err,
            );
          }
        }
        // Broadcast immediately so the WORKSPACE-subcard pill picks up the
        // `base` even before the next git_info_update arrives. We don't
        // know gitWorktree.mainPath / .name yet (bridge sends those
        // separately in git_info_update), but stamping gitWorktreeBase on
        // the wire is harmless — clients ignore it (see composeWorktreePayload).
        browserGateway.broadcastSessionUpdated(sessionId, { gitWorktreeBase: base });
      }
    }

    // ── automation-run arm ────────────────────────────────────────────
    // Consume any pending automation-run stamp queued by the automation
    // plugin's spawn hook for this cwd. Stamps `kind="automation"` +
    // `automationRun` in memory and persists to `.meta.json` so the
    // classification + effective board visibility survive restart.
    // See change: add-automation-plugin.
    if (pendingAutomationRunRegistry) {
      const stamp = pendingAutomationRunRegistry.consume(cwd);
      if (stamp) {
        sessionManager.update(sessionId, {
          kind: "automation",
          automationRun: stamp,
        });
        const session = sessionManager.get(sessionId);
        if (session?.sessionFile) {
          try {
            mergeSessionMeta(session.sessionFile, {
              kind: "automation",
              automationRun: stamp,
            });
          } catch (err) {
            console.warn(
              `[event-wiring] failed to persist automationRun to .meta.json for ${sessionId}:`,
              err,
            );
          }
        }
        browserGateway.broadcastSessionUpdated(sessionId, {
          kind: "automation",
          automationRun: stamp,
        });
      }
    }

    // ── goal-link arm ─────────────────────────────────────────────────
    // Consume any pending goalId queued by the goal route's spawn path for
    // this cwd. Stamps `.meta.json#goalId` + in-memory `goalId`, links the
    // new sessionId into its GoalRecord, and broadcasts the update.
    // See change: add-goals-folder-page.
    if (pendingGoalLinkRegistry && goalStore) {
      const goalId = pendingGoalLinkRegistry.consume(cwd);
      if (goalId) {
        const gs = goalStore;
        // Link in the goal store FIRST; only stamp the session + .meta.json +
        // broadcast once linking succeeds, so a failed link (e.g. goal
        // deleted mid-spawn) can't leave session state diverged from the store.
        gs.linkSession(cwd, goalId, sessionId)
          .then((updated) => {
            sessionManager.update(sessionId, { goalId });
            const session = sessionManager.get(sessionId);
            if (session?.sessionFile) {
              try {
                mergeSessionMeta(session.sessionFile, { goalId });
              } catch (err) {
                console.warn(
                  `[event-wiring] failed to persist goalId to .meta.json for ${sessionId}:`,
                  err,
                );
              }
            }
            browserGateway.broadcastSessionUpdated(sessionId, { goalId });
            // Kick off the pursuit: rename the card to the objective + dispatch
            // `/goal …` so the pi-goal-hermes loop starts. Without this the
            // session boots idle and never tries to reach the goal target.
            primeGoalSession?.(sessionId, updated);
          })
          .catch((err) => {
            console.warn(`[event-wiring] failed to link session ${sessionId} to goal ${goalId}:`, err);
          });
      }
    }
  };

  // Broadcast session ended to browsers when sessions are unregistered
  sessionManager.onUnregister = (sessionId) => {
    const session = sessionManager.get(sessionId);
    if (session) {
      browserGateway.broadcastSessionUpdated(sessionId, {
        status: "ended",
        endedAt: session.endedAt,
        currentTool: null,
      });
    }
  };

  // Per-event cap for `Session.uiDataMap[event]`. Phase-1 spec contract:
  // last-write-wins on overflow; oldest items are discarded.
  // See change: add-extension-ui-modal, design.md §5.
  const UI_DATA_PER_EVENT_CAP = 1000;

  // Track sessions replaying history — suppress status broadcasts to avoid card flicker
  const replayingSessions = new Set<string>();
  // Sessions whose replay should be discarded (canSkipWipe was true — events already in store)
  const skipReplayInsert = new Set<string>();
  // Debounce flows refresh to prevent infinite loop between sessions in same cwd
  const recentFlowsRefresh = new Set<string>();
  // Per-session timestamp of the most recent `lastActivityAt` broadcast.
  // In-memory state updates on every activity event; the WebSocket broadcast
  // is throttled to at most one per `LAST_ACTIVITY_BROADCAST_INTERVAL_MS` per
  // session. The client's local `now` ticker handles label refreshes between
  // broadcasts. See change: session-card-last-activity-badge.
  const lastActivityBroadcastAt = new Map<string, number>();
  const LAST_ACTIVITY_BROADCAST_INTERVAL_MS = 30_000;

  piGateway.onEvent = (sessionId, msg) => {
    // Generic plugin bridge→server channel. Routed to plugin-server
    // handlers by messageType; never touches core session state.
    // See change: add-goal-continuation-plugin.
    if (msg.type === "plugin_pi_message") {
      dispatchPluginPiMessage?.(msg.messageType, msg);
      return;
    }

    if (msg.type === "event_forward") {
      // Raw-event fan-out to plugin onEvent subscribers (live + replay).
      // Fired before the core handling so plugins see every forwarded event.
      // See change: add-goal-continuation-plugin.
      dispatchPluginRawEvent?.(sessionId, msg.event);
      // Legacy queue_state event no longer emitted (bridge removed PromptQueue).
      // See change: add-followup-edit-and-steer-cancel.
      if (msg.event.eventType === "queue_state") return;
      // When canSkipWipe was true, the event store already has all events —
      // don't insert replayed events again (would cause exponential duplication)
      if (replayingSessions.has(sessionId) && skipReplayInsert.has(sessionId)) {
        // Still process status updates so session state stays accurate
        const updates = extractSessionUpdates(msg.event);
        if (updates) {
          sessionManager.update(sessionId, updates as Partial<DashboardSession>);
        }
        // Skip insert + broadcast — events are already in store
        // Still need to continue to the rest of the handler for openspec/stats
        // but those are only for non-replay events, so we can return early
        return;
      }
      const seq = eventStore.insertEvent(sessionId, msg.event);
      // Skip broadcasting during replay — browser gets events via subscribe replay
      if (!replayingSessions.has(sessionId)) {
        const storedEvent = eventStore.getEvent(sessionId, seq) ?? msg.event;
        browserGateway.broadcastEvent(sessionId, seq, storedEvent);
      }

      // Snapshot pre-update fields used by `isUnreadTrigger`. Captured here
      // so the trigger sees the before/after edges of `status` and
      // `currentTool` cleanly. See change: session-card-unread-stripes.
      const sessionBefore = sessionManager.get(sessionId);
      const beforeSnapshot = {
        status: sessionBefore?.status,
        currentTool: sessionBefore?.currentTool,
      };

      const updates = extractSessionUpdates(msg.event);
      if (updates) {
        sessionManager.update(sessionId, updates as Partial<DashboardSession>);
        // During replay, accumulate in sessionManager but don't broadcast
        // to avoid rapid status flickers on the session card
        if (!replayingSessions.has(sessionId)) {
          browserGateway.broadcastSessionUpdated(sessionId, updates);
        }
      }

      // Unread-trigger evaluation. Only fires for live (non-replay) events
      // and only stamps when no browser is currently viewing the session.
      // The viewedSessionTracker dep is optional for backward compatibility
      // (and to keep tests that don't need it lean).
      // See change: session-card-unread-stripes.
      if (!replayingSessions.has(sessionId) && viewedSessionTracker) {
        const sessionAfter = sessionManager.get(sessionId);
        const afterSnapshot = {
          status: sessionAfter?.status,
          currentTool: sessionAfter?.currentTool,
        };
        if (
          isUnreadTrigger(
            msg.event.eventType,
            beforeSnapshot,
            afterSnapshot,
            msg.event.data,
          ) &&
          !viewedSessionTracker.isViewedByAnyone(sessionId)
        ) {
          if (sessionAfter && !sessionAfter.unread) {
            sessionManager.update(sessionId, { unread: true });
            browserGateway.broadcastSessionUpdated(sessionId, { unread: true });
          }
        }
      }

      // Gated status-transition placement for session-card ordering.
      //   questionFirst: alive session whose currentTool flips to
      //     "ask_user" → move to top of active tier.
      //   completedFirst: alive session emitting `agent_end` (turn done,
      //     still idle) → move to top of active tier.
      // Both gated by the live config flags, idempotent (moveToFront is a
      // no-op when already at front, and we broadcast only on real change),
      // and skipped during replay / for ended sessions (alive→ended is
      // handled in server.ts onChange). See change:
      // simplify-session-card-ordering.
      if (!replayingSessions.has(sessionId)) {
        const placed = sessionManager.get(sessionId);
        if (placed && placed.status !== "ended") {
          const askTrigger =
            !!isQuestionFirst?.() &&
            placed.currentTool === "ask_user" &&
            beforeSnapshot.currentTool !== "ask_user";
          const endTrigger =
            !!isCompletedFirst?.() && msg.event.eventType === "agent_end";
          if (askTrigger || endTrigger) {
            const key = resolveOrderKey(placed, preferencesStore.getPinnedDirectories());
            const before = sessionOrderManager.getOrder(key) ?? [];
            sessionOrderManager.moveToFront(key, sessionId);
            const after = sessionOrderManager.getOrder(key) ?? [];
            const changed =
              before.length !== after.length ||
              before.some((id, i) => id !== after[i]);
            if (changed) {
              browserGateway.broadcastToAll({
                type: "sessions_reordered",
                cwd: key,
                sessionIds: after,
              });
            }
          }
        }
      }

      // Stamp `session.lastActivityAt` on every live activity event.
      // Skipped during replay — historical events should not retroactively
      // bump the badge. In-memory updates always; broadcasts throttled per
      // session. See change: session-card-last-activity-badge.
      if (!replayingSessions.has(sessionId) && isActivityEvent(msg.event.eventType)) {
        const now = Date.now();
        sessionManager.update(sessionId, { lastActivityAt: now });
        const lastBroadcast = lastActivityBroadcastAt.get(sessionId) ?? 0;
        if (now - lastBroadcast >= LAST_ACTIVITY_BROADCAST_INTERVAL_MS) {
          lastActivityBroadcastAt.set(sessionId, now);
          browserGateway.broadcastSessionUpdated(sessionId, { lastActivityAt: now });
        }
      }

      // Server-side OpenSpec activity detection from forwarded events
      // Skip during replay — replayed events from a forked session would set stale phase/change
      if (msg.event.eventType === "tool_execution_start" && !replayingSessions.has(sessionId)) {
        const detectedRaw = detectOpenSpecActivity(
          msg.event.data.toolName as string,
          msg.event.data.args as Record<string, unknown> | undefined,
        );
        // Defense-in-depth (see change: fix-uuid-rename-bug). Even if a future
        // detector regression returns a junk-shaped `changeName` (UUID, mixed
        // case, etc.), refuse to stamp openspecChange / attachedProposal /
        // name. Manual attach paths (browser handler, REST) bypass this and
        // accept any name from a server-curated list.
        const detected =
          detectedRaw && (!detectedRaw.changeName || isValidOpenSpecChangeSlug(detectedRaw.changeName))
            ? detectedRaw
            : null;
        if (detected) {
          const session = sessionManager.get(sessionId);
          const activityUpdates: Partial<DashboardSession> = {};
          let changed = false;
          if (detected.phase && detected.phase !== session?.openspecPhase) {
            activityUpdates.openspecPhase = detected.phase;
            changed = true;
          }
          if (detected.changeName && detected.changeName !== session?.openspecChange) {
            activityUpdates.openspecChange = detected.changeName;
            changed = true;
          }
          if (changed) {
            sessionManager.update(sessionId, activityUpdates);
            const updatedSession = sessionManager.get(sessionId);
            // Auto-attach proposal when changeName is detected via active operations
            // (write/CLI). Reads are passive (browsing/analysis) and don't trigger attach.
            // Phase is optional — skills loaded via prompt templates don't emit a SKILL.md read event.
            const attachUpdates: Partial<DashboardSession> = {};
            // Auto-detect parallel path — see change: fix-mobile-attach-proposal-display
            // (design.md §"Auto-detect parallel path"). Mirrors the witness rule in
            // session-meta-handler.ts: re-attach when the previous attachment was
            // auto-tracked (name === attachedProposal) AND a different changeName
            // is now detected. Inner rename guard reuses attachRenameTarget.
            if (updatedSession?.openspecChange && detected.isActive) {
              const changeName = updatedSession.openspecChange;
              const attached = updatedSession.attachedProposal;
              const isManualAttachment =
                !!attached && !isNameAutoSetFromAttachment(updatedSession);
              // Deleted-proposal bypass (design.md D5): a manual attachment
              // whose change no longer appears in the OpenSpec poll cache has
              // nothing to "replace" — treat it as auto-tracked so the new
              // changeName auto-attaches directly (no dialog). Reuses the
              // in-memory poll cache; never triggers a fresh poll.
              // See change: replace-proposal-dialog-with-race-handling.
              const attachedStillExists =
                isManualAttachment &&
                openSpecChangeExistsInCache(directoryService, updatedSession.cwd, attached!);
              const attachmentWasAutoTracked =
                !attached ||
                isNameAutoSetFromAttachment(updatedSession) ||
                (isManualAttachment && !attachedStillExists);
              const differentChangeDetected = attached !== changeName;
              if (attachmentWasAutoTracked && differentChangeDetected) {
                // Branches 1 / 2 / 4: auto-attach (no attachment, auto-tracked,
                // or deleted-proposal bypass) + auto-rename.
                attachUpdates.attachedProposal = changeName;
                const newName = attachRenameTarget(updatedSession, changeName);
                if (newName !== undefined) {
                  attachUpdates.name = newName;
                  piGateway.sendToSession(sessionId, {
                    type: "rename_session",
                    sessionId,
                    name: newName,
                  });
                }
                sessionManager.update(sessionId, attachUpdates);
              } else if (isManualAttachment && attachedStillExists && differentChangeDetected) {
                // Branch 3: manual attachment to a live proposal, LLM pivoted
                // to a different change — surface the replace dialog via the
                // coalescing `pendingReplaceProposal` slot. Latest wins;
                // same name = no-op; rejected name = ignored.
                // See change: replace-proposal-dialog-with-race-handling.
                const rejected = updatedSession.rejectedReplaceProposals ?? [];
                if (
                  !rejected.includes(changeName) &&
                  updatedSession.pendingReplaceProposal !== changeName
                ) {
                  attachUpdates.pendingReplaceProposal = changeName;
                  sessionManager.update(sessionId, attachUpdates);
                }
              }
            }
            if (!replayingSessions.has(sessionId)) {
              browserGateway.broadcastSessionUpdated(sessionId, {
                ...activityUpdates,
                ...attachUpdates,
              });
            }
          }
        }
      }
      if (msg.event.eventType === "agent_end" && !replayingSessions.has(sessionId)) {
        const session = sessionManager.get(sessionId);
        // Clear OpenSpec tracking AND the replace-proposal lifecycle on every
        // turn end. agent_end = fresh intent slate: the pending suggestion and
        // the per-name rejection memory both reset so a new turn re-prompts.
        // See change: replace-proposal-dialog-with-race-handling.
        if (
          session?.openspecPhase ||
          session?.openspecChange ||
          session?.pendingReplaceProposal ||
          (session?.rejectedReplaceProposals?.length ?? 0) > 0
        ) {
          const clearUpdates: Partial<DashboardSession> = {
            openspecPhase: null as any,
            openspecChange: null as any,
            pendingReplaceProposal: null as any,
            rejectedReplaceProposals: [],
          };
          sessionManager.update(sessionId, clearUpdates);
          browserGateway.broadcastSessionUpdated(sessionId, clearUpdates);
        }
      }

      // Server-side stats extraction from forwarded turn_end events
      if (msg.event.eventType === "turn_end") {
        const ctxUsage = msg.event.data.contextUsage as { tokens: number | null; contextWindow: number } | undefined;
        const stats = extractTurnStats(msg.event.data, ctxUsage);
        if (stats) {
          const session = sessionManager.get(sessionId);
          const statsUpdates: Partial<DashboardSession> = {
            tokensIn: (session?.tokensIn ?? 0) + stats.tokensIn,
            tokensOut: (session?.tokensOut ?? 0) + stats.tokensOut,
            cacheRead: (session?.cacheRead ?? 0) + (stats.turnUsage?.cacheRead ?? 0),
            cacheWrite: (session?.cacheWrite ?? 0) + (stats.turnUsage?.cacheWrite ?? 0),
            cost: (session?.cost ?? 0) + stats.cost,
          };
          if (stats.contextUsage) {
            statsUpdates.contextTokens = stats.contextUsage.tokens;
            statsUpdates.contextWindow = stats.contextUsage.contextWindow;
          }
          sessionManager.update(sessionId, statsUpdates);

          // Synthesize a stats_update event for client replay compatibility
          const statsEvent = {
            eventType: "stats_update",
            timestamp: Date.now(),
            data: {
              tokensIn: stats.tokensIn,
              tokensOut: stats.tokensOut,
              cost: stats.cost,
              turnUsage: stats.turnUsage,
              contextUsage: stats.contextUsage,
            },
          };
          const statsSeq = eventStore.insertEvent(sessionId, statsEvent);
          if (!replayingSessions.has(sessionId)) {
            browserGateway.broadcastEvent(sessionId, statsSeq, statsEvent);
            browserGateway.broadcastSessionUpdated(sessionId, statsUpdates);
          }
        }
      }
    }

    if (msg.type === "replay_complete") {
      const wasSkipped = skipReplayInsert.has(sessionId);
      replayingSessions.delete(sessionId);
      skipReplayInsert.delete(sessionId);
      // Clear any stale OpenSpec activity state that may have leaked
      // (e.g. from events forwarded before the replay flag was set)
      const preSession = sessionManager.get(sessionId);
      if (preSession?.openspecPhase || preSession?.openspecChange) {
        sessionManager.update(sessionId, {
          openspecPhase: null as any,
          openspecChange: null as any,
        });
      }
      // Broadcast the final accumulated status after replay
      const session = sessionManager.get(sessionId);
      if (session) {
        browserGateway.broadcastSessionUpdated(sessionId, {
          status: session.status,
          currentTool: session.currentTool ?? null,
          openspecPhase: null,
          openspecChange: null,
        });
      }
      // Send replayed events to browser subscribers.
      // During replay, event_forward messages were stored but not broadcast.
      // Subscribers who received session_state_reset need the events to rebuild chat.
      // Skip when canSkipWipe was true — browser already has the events.
      if (!wasSkipped) {
        const storedEvents = eventStore.getEvents(sessionId, 1);
        if (storedEvents.length > 0) {
          browserGateway.sendToSubscribers(sessionId, {
            type: "event_replay",
            sessionId,
            events: storedEvents.map((e) => ({ seq: e.seq, event: e.event })),
            isLast: true,
          } as any);
        }
      }
    }

    if (msg.type === "session_register") {
      replayingSessions.add(sessionId);
      // Safety timeout: clear replay flag after 5s if replay_complete never arrives
      setTimeout(() => {
        if (replayingSessions.delete(sessionId)) {
          const wasSkipped = skipReplayInsert.delete(sessionId);
          const session = sessionManager.get(sessionId);
          if (session) {
            browserGateway.broadcastSessionUpdated(sessionId, {
              status: session.status,
              currentTool: session.currentTool ?? null,
            });
          }
          // Send any accumulated events to browser subscribers
          if (!wasSkipped) {
            const fallbackEvents = eventStore.getEvents(sessionId, 1);
            if (fallbackEvents.length > 0) {
              browserGateway.sendToSubscribers(sessionId, {
                type: "event_replay",
                sessionId,
                events: fallbackEvents.map((e) => ({ seq: e.seq, event: e.event })),
                isLast: true,
              } as any);
            }
          }
        }
      }, 5_000);
      // Skip wipe if bridge provides eventCount matching the last known entry count.
      // This avoids full replay cascade when bridge simply reconnects.
      // Compare entry counts (apples to apples) — not entries vs stored events.
      const session = sessionManager.get(sessionId);
      const lastEntryCount = session?.lastEntryCount;
      const canSkipWipe = msg.eventCount !== undefined && lastEntryCount !== undefined && msg.eventCount === lastEntryCount && eventStore.hasEvents(sessionId);
      // Store the bridge's entry count for future reconnect comparisons
      if (msg.eventCount !== undefined) {
        sessionManager.update(sessionId, { lastEntryCount: msg.eventCount });
      }
      if (!canSkipWipe) {
        eventStore.deleteEventsForSession(sessionId);
        browserGateway.broadcastSessionStateReset(sessionId);
      } else {
        // Mark this session so replayed events are not re-inserted into the store
        skipReplayInsert.add(sessionId);
      }
      // NOTE: do NOT reset `hidden` here. The auto-hide decision is the sole
      // responsibility of `memorySessionManager.register` (first register vs
      // reattach-preserve). Resetting `hidden: false` on every register would
      // both defeat the auto-hide heuristic and wipe a manual hide on reattach.
      // See change: auto-hide-headless-worker-sessions.
      sessionManager.update(sessionId, { dataUnavailable: false });

      if (msg.sessionFile) {
        for (const other of sessionManager.listAll()) {
          if (other.id !== sessionId && other.sessionFile === msg.sessionFile) {
            sessionManager.update(other.id, { sessionFile: undefined });
            browserGateway.broadcastSessionUpdated(other.id, { sessionFile: null });
          }
        }
      }

      // Dedup: clean up ghost sessions in the same cwd that were auto-created
      // by duplicate bridge connections (e.g. extension loaded twice).
      // A ghost is active, has no sessionFile, no events, is not connected
      // to the pi-gateway, and was created very recently.
      const now = Date.now();
      for (const other of sessionManager.listAll()) {
        if (
          other.id !== sessionId &&
          other.cwd === msg.cwd &&
          other.status !== "ended" &&
          !other.sessionFile &&
          !piGateway.isSessionConnected(other.id) &&
          !eventStore.hasEvents(other.id) &&
          Math.abs(now - other.startedAt) < 30_000
        ) {
          console.error(`[event-wiring] Cleaning up ghost session ${other.id} (dup of ${sessionId} in ${msg.cwd})`);
          sessionManager.unregister(other.id);
          browserGateway.broadcastSessionRemoved(other.id);
        }
      }

      // Three-tier link: token → pid → cwd-FIFO. Each tier is independently
      // correct; `linkByToken` is the strong identity introduced by
      // `spawn-correlation-token`. cwd-FIFO is the legacy fallback for old
      // bridges that send neither token nor pid (and is logged so we can see
      // when it actually triggers).
      let linked = false;
      if (msg.spawnToken) {
        linked = browserGateway.headlessPidRegistry.linkByToken(msg.spawnToken, sessionId, msg.pid);
      }
      if (!linked && msg.pid !== undefined) {
        linked = browserGateway.headlessPidRegistry.linkByPid(sessionId, msg.pid);
      }
      if (!linked) {
        if (msg.spawnToken || msg.pid !== undefined) {
          console.error(
            `[event-wiring] cwd-FIFO fallback for session ${sessionId} — token=${msg.spawnToken ?? ""} pid=${msg.pid ?? ""} cwd=${msg.cwd}`,
          );
        }
        browserGateway.headlessPidRegistry.linkSession(sessionId, msg.cwd);
      }

      // Resolve the originating browser `requestId` (when known) so the
      // upcoming session_added broadcast can carry spawnRequestId and the
      // client can auto-select / dismiss its placeholder.
      // See change: spawn-correlation-token.
      const spawnRequestId = (msg.spawnToken && pendingClientCorrelations)
        ? pendingClientCorrelations.consume(msg.spawnToken)
        : undefined;

      const isNewSession = !knownSessionIds.has(sessionId);
      knownSessionIds.add(sessionId);
      // Decision matrix delegated to `decideDashboardSource` — strong
      // signal (`msg.dashboardSpawned`, sent on every register from
      // bridges that have `PI_DASHBOARD_SPAWN_TOKEN`) wins, with the
      // legacy `pendingDashboardSpawns` FIFO as fallback for older
      // bridges. See change: fix-dashboard-source-mislabelling.
      const pendingCount = pendingDashboardSpawns.get(msg.cwd) ?? 0;
      const decision = decideDashboardSource({
        dashboardSpawned: msg.dashboardSpawned,
        pendingCount,
        isNewSession,
        strictCorrelation: STRICT_SPAWN_CORRELATION,
      });
      if (decision.shouldStamp) {
        if (decision.consumeLegacyCounter) {
          if (pendingCount <= 1) pendingDashboardSpawns.delete(msg.cwd);
          else pendingDashboardSpawns.set(msg.cwd, pendingCount - 1);
          // Single-line warning so we can observe how often the weak
          // cwd-only signal still fires in the wild. Mirrors the
          // existing fallback log in headlessPidRegistry.linkSession.
          // See change: fix-dashboard-spawn-correlation-by-token.
          console.log(
            `[event-wiring] cwd-FIFO source-stamp fallback sessionId=${sessionId} cwd=${msg.cwd}`,
          );
        }
        const currentSource = sessionManager.get(sessionId)?.source;
        if (currentSource !== "dashboard") {
          sessionManager.update(sessionId, { source: "dashboard" });
          browserGateway.broadcastSessionUpdated(sessionId, { source: "dashboard" });
        }
        // Only persist to the .meta.json sidecar on the strong-signal
        // branch. The cwd-FIFO fallback is too weak to corrupt the
        // on-disk record — a CLI register that races a recent
        // dashboard spawn in the same cwd would otherwise persist
        // the wrong tag across restarts.
        // See change: fix-dashboard-spawn-correlation-by-token.
        if (decision.persistMeta && msg.sessionFile) {
          try {
            // Merge, not overwrite, so any other fields already written
            // synchronously by sibling onSessionRegistered handlers
            // (notably `gitWorktreeBase` from add-worktree-spawn-dialog)
            // survive this stamp. Previously a `writeSessionMeta` here
            // clobbered prior writes.
            mergeSessionMeta(msg.sessionFile, { source: "dashboard" });
          } catch { /* best-effort */ }
        }
      }

      // Fork-parent lookup is keyed by spawn token (was: cwd, racy on
      // multi-fork-in-same-cwd). See change: spawn-correlation-token.
      const forkParent = msg.spawnToken
        ? pendingForkRegistry.consumeFork(msg.spawnToken)
        : undefined;
      // Key the order map by the RESOLVED group path (parent repo for
      // worktree sessions) so the entry lands under the key the client
      // reads. Falls back to msg.cwd when the session isn't in the manager
      // yet (plain checkout → resolved path == cwd anyway).
      // See change: simplify-session-card-ordering.
      const pinned = preferencesStore.getPinnedDirectories();
      const registeredSession = sessionManager.get(sessionId);
      const orderKey = registeredSession
        ? resolveOrderKey(registeredSession, pinned)
        : msg.cwd;
      sessionOrderManager.insert(orderKey, sessionId);

      if (forkParent) {
        const session = sessionManager.get(sessionId);
        if (session && !session.attachedProposal) {
          // Use the actual parent session's proposal, not any random ended session
          const parent = sessionManager.get(forkParent);
          if (parent?.attachedProposal) {
            sessionManager.update(sessionId, { attachedProposal: parent.attachedProposal });
          }
        }
      }

      // validIds = sessions sharing the same resolved group key (not raw
      // cwd), so worktree siblings count toward the same order list.
      const validIds = new Set(
        sessionManager.listAll()
          .filter((s) => resolveOrderKey(s, pinned) === orderKey)
          .map((s) => s.id),
      );
      const order = sessionOrderManager.getOrder(orderKey, validIds);
      browserGateway.broadcastToAll({ type: "sessions_reordered", cwd: orderKey, sessionIds: order });

      const updatedSession = sessionManager.get(sessionId);
      if (updatedSession) {
        browserGateway.broadcastSessionAdded(updatedSession, spawnRequestId ? { spawnRequestId } : undefined);
      }

      const isNewCwd = !sessionManager.listAll().some(
        (s) => s.id !== sessionId && s.cwd === msg.cwd,
      );
      if (isNewCwd) {
        directoryService.onDirectoryAdded(msg.cwd).then(({ sessions, openspecData }) => {
          for (const hist of sessions) {
            if (!sessionManager.get(hist.id)) {
              sessionManager.register({
                id: hist.id,
                cwd: hist.cwd,
                name: hist.name,
                source: "tui",
                sessionFile: hist.sessionFile,
                sessionDir: hist.sessionDir,
                firstMessage: hist.firstMessage,
                startedAt: hist.startedAt,
              });
              sessionManager.unregister(hist.id);
              sessionManager.update(hist.id, { hidden: true });
              const s = sessionManager.get(hist.id);
              if (s) browserGateway.broadcastSessionAdded(s);
            }
          }
          browserGateway.broadcastToAll({
            type: "openspec_update",
            cwd: msg.cwd,
            data: openspecData,
          } as any);
        }).catch(() => {});
      }

      const pendingResume = browserGateway.pendingResumeRegistry.consume(msg.cwd);
      if (pendingResume) {
        piGateway.sendToSession(sessionId, {
          type: "send_prompt",
          sessionId,
          text: pendingResume.text,
          images: pendingResume.images,
        });
        // Clear `resuming` on the OLD session that triggered the auto-resume,
        // not the new session that just registered. The new session never had
        // `resuming: true`; clearing it there was a no-op and left the old
        // session permanently stuck. The 30s onTimeout was also cancelled by
        // `consume()`, so without this fix the old session stays frozen forever.
        sessionManager.update(pendingResume.oldSessionId, { resuming: false });
        browserGateway.broadcastSessionUpdated(pendingResume.oldSessionId, { resuming: false });
      }
    }

    // Pi's queue mirror (steer + follow-up) forwarded from the bridge.
    // Caches `pendingQueues` on the session and broadcasts to subscribed browsers.
    // See change: add-followup-edit-and-steer-cancel.
    if (msg.type === "queue_update") {
      const steering = Array.isArray(msg.steering) ? msg.steering : [];
      const followUp = Array.isArray(msg.followUp) ? msg.followUp : [];
      const update = { pendingQueues: { steering, followUp } } as Partial<DashboardSession>;
      sessionManager.update(sessionId, update);
      if (!replayingSessions.has(sessionId)) {
        browserGateway.broadcastSessionUpdated(sessionId, update);
      }
      return;
    }


    if (msg.type === "first_message_update") {
      sessionManager.update(sessionId, { firstMessage: msg.firstMessage });
      browserGateway.broadcastSessionUpdated(sessionId, { firstMessage: msg.firstMessage });
    }

    if (msg.type === "session_unregister") {
      // Drop the per-session debounce entry so a future re-register with the
      // same id does not silently suppress its first activity broadcast.
      lastActivityBroadcastAt.delete(sessionId);
      browserGateway.broadcastSessionRemoved(sessionId);
    }

    if (msg.type === "commands_list") {
      browserGateway.sendToSubscribers(sessionId, {
        type: "commands_list",
        sessionId,
        commands: msg.commands,
      });
    }

    if (msg.type === "flows_list") {
      browserGateway.sendToSubscribers(sessionId, {
        type: "flows_list",
        sessionId,
        flows: msg.flows,
      });

      // Tell other connected sessions in the same cwd to rediscover flows
      // (debounced to avoid infinite loop: A→refresh B→B sends flows→refresh A→...)
      if (!recentFlowsRefresh.has(sessionId)) {
        recentFlowsRefresh.add(sessionId);
        setTimeout(() => recentFlowsRefresh.delete(sessionId), 5_000);
        const session = sessionManager.get(sessionId);
        if (session) {
          for (const sid of piGateway.getConnectedSessionIds()) {
            if (sid === sessionId || recentFlowsRefresh.has(sid)) continue;
            const other = sessionManager.get(sid);
            if (other && other.cwd === session.cwd) {
              piGateway.sendToSession(sid, { type: "request_flows_refresh", sessionId: sid });
            }
          }
        }
      }
    }

    if (msg.type === "git_info_update") {
      // Compose live worktree state from bridge + server-cached base ref
      // (loaded earlier from .meta.json by session-scanner / spawn flow).
      // `null` clears, `undefined` leaves existing value untouched.
      // See change: add-worktree-spawn-dialog.
      const composedWorktree = composeWorktreePayload(
        msg.gitWorktree,
        sessionManager.get(sessionId)?.gitWorktreeBase,
      );
      const gitUpdates: Record<string, unknown> = {
        gitBranch: msg.gitBranch,
        gitBranchUrl: msg.gitBranchUrl,
        gitPrNumber: msg.gitPrNumber,
        gitPrUrl: msg.gitPrUrl,
      };
      if (composedWorktree !== undefined) {
        // Map wire `null` → in-memory `undefined` so the field clears
        // cleanly on the DashboardSession.
        gitUpdates.gitWorktree = composedWorktree ?? undefined;
      }
      // Capture the resolved order key BEFORE applying the update — at this
      // point `gitWorktree` is not yet set, so the key is the raw worktree
      // cwd the id was inserted under at register time.
      const beforeWtSession = sessionManager.get(sessionId);
      const oldOrderKey = beforeWtSession ? resolveOrderKey(beforeWtSession, preferencesStore.getPinnedDirectories()) : undefined;
      sessionManager.update(sessionId, gitUpdates);
      browserGateway.broadcastSessionUpdated(sessionId, gitUpdates);
      maybeRekeyOrder(sessionId, oldOrderKey);
    }

    if (msg.type === "cwd_missing") {
      // Bridge detected `existsSync(cwd) === false`. Stamp + broadcast.
      // Idempotent: re-emitting on a stamped session is harmless.
      // See change: add-worktree-lifecycle-actions.
      sessionManager.update(sessionId, { cwdMissing: true });
      browserGateway.broadcastSessionUpdated(sessionId, { cwdMissing: true });
    }

    if (msg.type === "pi_version_update") {
      // Bridge reports the pi version its session actually runs (ground truth
      // from inside pi's process). Store + broadcast, mirroring git_info_update.
      // See change: restore-pi-version-skew-surface.
      sessionManager.update(sessionId, { piVersion: msg.version });
      browserGateway.broadcastSessionUpdated(sessionId, { piVersion: msg.version });
    }

    if (msg.type === "files_list") {
      browserGateway.sendToSubscribers(sessionId, {
        type: "files_list",
        sessionId,
        query: msg.query,
        files: msg.files,
      });
    }

    if (msg.type === "models_list") {
      // Broadcast to all browsers (not just subscribers) so model selector
      // is available even before the user opens the session
      browserGateway.broadcastToAll({
        type: "models_list",
        sessionId,
        models: msg.models,
      } as any);
    }

    if (msg.type === "providers_list") {
      // Cache the bridge-pushed catalogue. Browsers don't subscribe to it
      // directly; they read via GET /api/provider-auth/status.
      // Broadcast `models_refreshed` ONLY when the catalogue contents
      // actually changed. Routine state-syncs (every fork/resume/reconnect/
      // subscribe) re-send identical content; broadcasting unconditionally
      // wipes every browser's modelsMap and — because App.tsx's
      // auto-subscribe effect skips re-requesting models for any session
      // that's already in `subscribedRef`, leaves previously-visited
      // sessions with an empty model selector until reconnect.
      //
      // The catalogue cache is now a pure read consumer for the Settings
      // UI (`GET /api/provider-auth/status`). No broadcast: the model-
      // selector dropdown lives on the independent `models_list` channel
      // which is per-session-broadcast already; per-session updates are
      // self-healing without a global wipe.
      // See changes: replace-hardcoded-provider-lists,
      //              fix-providers-list-spurious-models-refreshed,
      //              simplify-model-selection-channels.
      setCatalogueForSession(sessionId, msg.providers);
    }

    if (msg.type === "roles_list") {
      browserGateway.broadcastToAll({
        type: "roles_list",
        sessionId,
        roles: (msg as any).roles,
        presets: (msg as any).presets,
        activePreset: (msg as any).activePreset,
      } as any);
    }

    if (msg.type === "model_update") {
      const modelUpdates: Partial<DashboardSession> = {
        model: msg.model,
      };
      if (msg.thinkingLevel !== undefined) {
        modelUpdates.thinkingLevel = msg.thinkingLevel;
      }
      sessionManager.update(sessionId, modelUpdates);
      browserGateway.broadcastSessionUpdated(sessionId, modelUpdates);
    }

    // Legacy extension_ui_request/dismiss removed — replaced by PromptBus protocol.

    // ── PromptBus protocol messages (extension → browser) ──
    if (msg.type === "prompt_request") {
      browserGateway.trackPromptRequest(sessionId, msg as any);
      browserGateway.sendToSubscribers(sessionId, msg as any);
    }

    if (msg.type === "prompt_dismiss") {
      browserGateway.clearPromptRequest(sessionId, (msg as any).promptId);
      browserGateway.sendToSubscribers(sessionId, msg as any);
    }

    if (msg.type === "prompt_cancel") {
      browserGateway.clearPromptRequest(sessionId, (msg as any).promptId);
      browserGateway.sendToSubscribers(sessionId, msg as any);
    }

    // ── Extension UI System (Phase 1): cache + broadcast ──
    // See change: add-extension-ui-modal.
    if (msg.type === "ui_modules_list") {
      sessionManager.update(sessionId, { uiModules: msg.modules });
      browserGateway.sendToSubscribers(sessionId, {
        type: "ui_modules_list",
        sessionId,
        modules: msg.modules,
      } as any);
    }

    if (msg.type === "ui_data_list") {
      const session = sessionManager.get(sessionId);
      const dataMap = { ...(session?.uiDataMap ?? {}) };
      // Per-event item cap (default N = 1000). Last-write-wins on overflow.
      const items = Array.isArray(msg.items) ? msg.items : [];
      const capped = items.length > UI_DATA_PER_EVENT_CAP
        ? items.slice(items.length - UI_DATA_PER_EVENT_CAP)
        : items;
      dataMap[msg.event] = capped;
      sessionManager.update(sessionId, { uiDataMap: dataMap });
      browserGateway.sendToSubscribers(sessionId, {
        type: "ui_data_list",
        sessionId,
        event: msg.event,
        items: capped,
      } as any);
    }

    // ── Asset register: per-session image asset cache + broadcast ──
    // See change: chat-markdown-local-images-and-math.
    if (msg.type === "asset_register") {
      const { hash, mimeType, data } = msg;
      // Reject malformed messages defensively. The bridge always populates
      // these fields; this guard is purely defense-in-depth so a
      // misbehaving extension cannot inject placeholder asset entries.
      if (typeof hash === "string" && hash.length > 0 &&
          typeof mimeType === "string" && mimeType.length > 0 &&
          typeof data === "string" && data.length > 0) {
        const session = sessionManager.get(sessionId);
        if (session) {
          const next = { ...(session.assets ?? {}) };
          next[hash] = { data, mimeType };
          sessionManager.update(sessionId, { assets: next });
        }
        // Broadcast verbatim regardless of whether the session is known —
        // mirrors the Phase-1 / Phase-2 contract for extension UI messages.
        browserGateway.sendToSubscribers(sessionId, {
          type: "asset_register",
          sessionId,
          hash,
          mimeType,
          data,
        } as any);
      }
    }

    // ── Extension UI System (Phase 2): live decorator cache + broadcast ──
    // See change: add-extension-ui-decorations.
    if (msg.type === "ext_ui_decorator") {
      const session = sessionManager.get(sessionId);
      if (session) {
        const descriptor = msg.descriptor;
        if (descriptor && typeof descriptor.kind === "string" && typeof descriptor.namespace === "string" && typeof descriptor.id === "string") {
          const key = `${descriptor.kind}:${descriptor.namespace}:${descriptor.id}`;
          const next = { ...(session.uiDecorators ?? {}) };
          if (msg.removed === true) delete next[key];
          else next[key] = descriptor;
          sessionManager.update(sessionId, { uiDecorators: next });
        }
      }
      // Broadcast verbatim regardless of whether the session is known — mirrors
      // the Phase-1 contract for `ui_modules_list` / `ui_data_list`.
      browserGateway.sendToSubscribers(sessionId, {
        type: "ext_ui_decorator",
        sessionId,
        descriptor: msg.descriptor,
        ...(msg.removed === true ? { removed: true } : {}),
      } as any);
    }

    if (msg.type === "session_name_update") {
      const nameUpdates = { name: msg.name || undefined };
      sessionManager.update(sessionId, nameUpdates);
      browserGateway.broadcastSessionUpdated(sessionId, nameUpdates);
    }

    if (msg.type === "spawn_new_session") {
      spawnPiSession(msg.cwd, { strategy: loadConfig().spawnStrategy }).then((result) => {
        if (result.process && result.pid) {
          browserGateway.headlessPidRegistry.register(
            result.pid,
            msg.cwd,
            result.process,
            result.spawnToken,
            keeperOptsFromSpawnResult(result),
          );
        }
        browserGateway.broadcastToAll({
          type: "spawn_result",
          cwd: msg.cwd,
          success: result.success,
          message: result.message,
        } as any);
      }).catch(() => { /* ignore spawn errors */ });
    }

    if (msg.type === "sessions_list") {
      for (const piSession of msg.sessions) {
        const existing = sessionManager.get(piSession.id);
        if (!existing) {
          sessionManager.register({
            id: piSession.id,
            cwd: piSession.cwd,
            name: piSession.name,
            source: "unknown",
            sessionFile: piSession.path,
            sessionDir: piSession.cwd,
            firstMessage: piSession.firstMessage,
          });
          sessionManager.unregister(piSession.id);
        } else if (existing.sessionFile !== piSession.path) {
          sessionManager.update(piSession.id, {
            sessionFile: piSession.path,
            sessionDir: piSession.cwd,
          });
        }
      }
      browserGateway.broadcastToAll({
        type: "sessions_list",
        sessionId,
        cwd: msg.cwd,
        sessions: msg.sessions,
      });
    }

    // Forward process list from bridge to subscribed browsers, enriched with
    // per-entry classification. See change: classify-process-list-entries.
    if (msg.type === "process_list") {
      const pidIndex = buildPidIndex(sessionManager.listActive());
      const enriched = classifyProcesses(msg.processes, pidIndex);
      // Store enriched entries so late subscribers replay with classification.
      sessionManager.update(sessionId, { processes: enriched });
      browserGateway.sendToSubscribers(sessionId, {
        type: "process_list_update",
        sessionId,
        processes: enriched,
      });
    }

    // RPC keeper dispatch: bridge → server slash command forward.
    // Fire-and-forget; the handler itself emits browser-bound
    // `command_feedback` events on success and on every failure path.
    // The terminal event is persisted via eventStore.insertEvent so it
    // survives browser reattach (otherwise the chat pill stays "in progress").
    // See change: add-rpc-stdin-dispatch-with-keeper-sidecar (Phase 8).
    if (msg.type === "dispatch_extension_command") {
      void handleDispatchExtensionCommand(msg, {
        headlessPidRegistry: browserGateway.headlessPidRegistry,
        emitCommandFeedback: (sid, command, status, message) => {
          const event = {
            eventType: "command_feedback",
            timestamp: Date.now(),
            data: message === undefined ? { command, status } : { command, status, message },
          };
          const seq = eventStore.insertEvent(sid, event);
          const stored = eventStore.getEvent(sid, seq) ?? event;
          browserGateway.broadcastEvent(sid, seq, stored);
        },
      });
    }

  };
}
