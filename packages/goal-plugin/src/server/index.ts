/**
 * goal-plugin · SERVER entry — composition root for the goal PRODUCT.
 *
 * The goal product (store, REST surface, supervisor, goal_status peers,
 * primer, driver-link handover) is HOSTED HERE, not in the dashboard core.
 * Every host service it needs is reached through `ServerPluginContext`
 * (spawn/rename/assign-ref/network guard/shutdown/known-cwds), mirroring
 * `automation-plugin`'s self-containment. On-disk formats, wire types, REST
 * paths, and session-field shapes are byte-identical to the pre-move core
 * wiring; the plugin's manifest id (`"goal"`) is the same owner id core
 * filed refs under.
 *
 * Composition (registerPlugin, in order):
 *   1. GoalStore (same `~/.pi/dashboard/goals` data dir + format)
 *   2. `goals_update` broadcast (read-time spend decoration)
 *   3. `goal_status` peers — verdict accumulator → status projector →
 *      budget guard (same registration order core used) — then the
 *      pre-existing snapshot handler
 *   4. Primer (rename via `ctx.renameSession`, prompts via `ctx.sendToSession`)
 *   5. REST routes on `ctx.fastify` under the unchanged `/api/folders/goals*`
 *   6. Supervisor (spawn/kill/resume via ctx) + 30 s boot-reconcile timer
 *   7. Death fanout via `ctx.onSessionEnded`
 *   8. Driver-link handover via `ctx.onSessionResolved` (first-register only)
 *   9. Dispose via `ctx.onShutdown` (fires before the pi gateway stops)
 *
 * See change: relocate-goal-product-to-plugin (D1–D5),
 * add-goal-continuation-plugin (snapshot + control shell).
 */
import type { DashboardSession, GoalJudge, GoalBudget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  GOAL_PLUGIN_ID,
  GOAL_STATUS_MESSAGE,
  GOAL_STATUS_EVENT_TYPE,
  type GoalStatusSnapshot,
} from "../shared/goal-types.js";
import {
  probeGoalCommandSurface,
  goalConfigCommand,
  type GoalCommandSurface,
  type GoalCommandTier,
} from "./probe.js";
import { createGoalStore, type GoalStore } from "./goal-store.js";
import { createGoalSupervisor, type GoalDriverSpawnRequest, type GoalSupervisor } from "./goal-supervisor.js";
import { createGoalVerdictAccumulator } from "./goal-verdict-accumulator.js";
import { createGoalStatusProjector } from "./goal-status-projector.js";
import { decideBudgetHalt } from "./goal-budget-guard.js";
import { decorateGoalsWithSpend } from "./decorate-goals-spend.js";
import { buildGoalReprime, primeGoalSession } from "./goal-session-primer.js";
import { registerGoalRoutes } from "./routes.js";

/**
 * Detect the running extension's command surface. The extension is not
 * vendored, so we can't import its grammar; we baseline to the commands the
 * bridge already round-trips today (`/goal`, `/subgoal`) → dashboard-budget
 * tier. Upgrade seam: when a future extension advertises a config command,
 * flip `acceptsConfig` here (or detect it) to detect it to reach the `full`
 * tier.
 */
function detectGoalCommandSurface(): GoalCommandSurface {
  return { acceptsSubgoal: true };
}

/** Map a control action + payload to the `/goal …` command text the extension handles. */
function goalCommandFor(
  action: string,
  payload?: Record<string, unknown>,
  tier: GoalCommandTier = "intent-only",
): string | null {
  switch (action) {
    case "set": {
      const goal = typeof payload?.goal === "string" ? payload.goal.trim() : "";
      return goal ? `/goal ${goal}` : null;
    }
    case "subgoal": {
      const goal = typeof payload?.goal === "string" ? payload.goal.trim() : "";
      return goal ? `/subgoal ${goal}` : null;
    }
    case "pause":
    case "resume":
    case "done":
    case "clear":
      return `/goal ${action}`;
    case "config": {
      // Full-tier only (upgrade seam): push judge + budget into the loop.
      // Degraded/intent tiers return null — budget enforced dashboard-side,
      // judge recorded as intent on the GoalRecord.
      return goalConfigCommand(tier, {
        budget: payload?.budget as GoalBudget | undefined,
        judge: payload?.judge as GoalJudge | undefined,
      });
    }
    default:
      return null;
  }
}

/** Boot-reconcile grace: live drivers re-register before reconcile classifies. */
const GOAL_BOOT_RECONCILE_DELAY_MS = 30_000;

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const { logger, broadcastToSubscribers, registerPiHandler, registerBrowserHandler, sendToSession } = ctx;
  const commandTier = probeGoalCommandSurface(detectGoalCommandSurface());
  logger.info(`goal-plugin server entry activated (command tier: ${commandTier})`);

  /** Read a session through the host surface, cast to the shared shape. */
  const getSession = (id: string): DashboardSession | undefined =>
    ctx.sessionManager.getSession(id) as DashboardSession | undefined;

  // ── 1. Durable goal store (same data dir + on-disk format as before). ──
  const store: GoalStore = createGoalStore();

  // ── 2. goals_update broadcast with read-time spend decoration. ─────────
  // Same wire payload core emitted; `broadcastToSubscribers` reaches the same
  // browser-fanout core used directly.
  // See change: fix-goal-detail-turns-and-spend.
  const spendLookup = { get: (id: string) => getSession(id) };
  store.subscribe((cwd, payload) => {
    broadcastToSubscribers({ type: "goals_update", cwd, goals: decorateGoalsWithSpend(payload.goals, spendLookup) });
  });

  // ── 3. goal_status peers (verdict accumulation → durable projection →
  // budget enforcement), registered in the same order core used, followed by
  // the snapshot handler below. Same dispatch mechanism
  // (`dispatchPluginPiMessage`) they rode as core-side peers. See change:
  // sophisticate-goal-authoring-and-control, persist-goal-status-and-progress.
  const lookupSession = (sessionId: string) => {
    const s = getSession(sessionId);
    return s ? { goalId: s.goalId, cwd: s.cwd } : null;
  };
  const accumulator = createGoalVerdictAccumulator({ store, lookupSession });
  registerPiHandler(GOAL_STATUS_MESSAGE, (msg) => accumulator.handle(msg));

  const statusProjector = createGoalStatusProjector({ store, lookupSession });
  registerPiHandler(GOAL_STATUS_MESSAGE, (msg) => statusProjector.handle(msg));

  // Dashboard-side budget enforcement (degraded tier): once a linked goal's
  // live turnsUsed reaches GoalRecord.budget.maxTurns, dispatch /goal pause.
  // Deduped per session so an already-capped loop isn't re-paused every
  // snapshot. See change: sophisticate-goal-authoring-and-control (task 3.2).
  const budgetPaused = new Set<string>();
  registerPiHandler(GOAL_STATUS_MESSAGE, (msg) => {
    const m = msg as { sessionId?: string; payload?: { status?: string; turnsUsed?: unknown } };
    if (!m.sessionId || !m.payload || typeof m.payload.status !== "string") return;
    const sessionId = m.sessionId;
    if (m.payload.status !== "active") {
      budgetPaused.delete(sessionId);
      return;
    }
    const turnsUsed = m.payload.turnsUsed;
    if (typeof turnsUsed !== "number" || !Number.isFinite(turnsUsed)) return;
    // Add to dedup set BEFORE the async lookup to close the race window.
    // Removed again if the lookup shows no halt.
    if (budgetPaused.has(sessionId)) return;
    budgetPaused.add(sessionId);
    const sess = getSession(sessionId);
    if (!sess?.goalId || !sess.cwd) { budgetPaused.delete(sessionId); return; }
    const cwd = sess.cwd;
    const goalId = sess.goalId;
    void store
      .list(cwd)
      .then((goals) => {
        const goal = goals.find((g) => g.id === goalId);
        // Budget on CUMULATIVE turns (design D3): respawns accumulate onto
        // `totalTurnsUsed`, so a fresh driver's low per-session count cannot
        // reset/defeat the cap. Fall back to the live per-session count for a
        // legacy record with no cumulative yet, and take the max to be robust
        // against a projector write that lags this same snapshot.
        // See change: add-goal-session-supervisor.
        const cumulativeTurns = Math.max(goal?.totalTurnsUsed ?? 0, turnsUsed);
        const decision = decideBudgetHalt(
          { status: "active", turnsUsed: cumulativeTurns },
          goal?.budget,
        );
        if (decision.halt && decision.command) {
          void sendToSession(sessionId, decision.command);
        } else {
          budgetPaused.delete(sessionId); // no halt → allow future checks
        }
      })
      .catch((err) => { budgetPaused.delete(sessionId); logger.warn(`[goal-budget-guard] budget check failed for ${goalId}:`, err); });
  });

  // ── 4. Primer — rename via the host capability (same normalization core
  // applied: `{ name: name || undefined }` broadcast), prompts via
  // ctx.sendToSession (same `send_prompt` message). Shared by the spawn path
  // (link handover) and the explicit link path (routes). See change:
  // add-goal-session-supervisor / add-goals-folder-page.
  const primeGoalSessionImpl = (
    sessionId: string,
    goal: { objective: string; criteria?: import("@blackbelt-technology/pi-dashboard-shared/types.js").GoalCriterion[] },
  ): void => {
    primeGoalSession(
      {
        sendPrompt: (sid, text) => void sendToSession(sid, text),
        renameSession: (sid, name) => {
          ctx.renameSession(sid, name);
        },
      },
      sessionId,
      goal,
    );
  };

  // ── 6a. Supervisor (created below; routes + abort close over it). ────
  let goalSupervisor: GoalSupervisor | undefined;

  // ── 5. REST surface — unchanged `/api/folders/goals*` paths on the host
  // fastify instance, mounted with the host's network guard and validated
  // against the host known-cwd service. See change: add-goals-folder-page.
  registerGoalRoutes(ctx.fastify, {
    sessionManager: ctx.sessionManager,
    knownFolderCwds: ctx.consume<() => string[]>("host.knownFolderCwds") ?? (() => []),
    networkGuard: ctx.networkGuard,
    store,
    // Stamp/clear goalId on a session: in-memory + .meta.json + broadcast —
    // the host capability with default persist (byte-identical to core's
    // inline block). See change: relocate-goal-product-to-plugin (D1-#5).
    applyGoalIdToSession: (sessionId, goalId) => {
      ctx.assignSessionRef(sessionId, { goalId: goalId ?? undefined });
    },
    primeGoalSession: primeGoalSessionImpl,
    // Route clear/pause/delete through the supervisor (assigned just below,
    // before the server listens). See change: add-goal-session-supervisor.
    abortGoalSupervision: (cwd, goalId, terminal) =>
      goalSupervisor ? goalSupervisor.abort(cwd, goalId, terminal) : Promise.resolve(),
    // Spawn a headless driver: the host hook files the `{ goalId }` ref
    // against the token under THIS plugin's id (`"goal"` — the same owner id
    // core used) and handles the pre-minted-token/initial-prompt/resume
    // mapping. See change: detach-automation-goal-from-core,
    // relocate-goal-product-to-plugin (D3).
    spawnGoalSession: async (cwd, goalId, opts) => {
      const result = await ctx.spawnSession({
        cwd,
        pluginRef: { goalId },
        lifecycle: { recover: false },
        ...(opts?.model ? { model: opts.model } : {}),
      });
      return { success: result.success, ...(result.message ? { message: result.message } : {}) };
    },
  });

  // Spawn driver: one path through `ctx.spawnSession` — caller-supplied
  // token used verbatim (persisted in `inFlightSpawn` before launch),
  // resume mapping via `opts.resume`, fresh re-prime via `opts.initialPrompt`
  // (enqueued before the spawn, consumed on failure — host-side). See change:
  // relocate-goal-product-to-plugin (D1-#1/#2/#3, D3).
  const spawnDriver = async (req: GoalDriverSpawnRequest): Promise<{ success: boolean; message?: string }> => {
    const result = await ctx.spawnSession({
      cwd: req.cwd,
      spawnToken: req.spawnToken,
      pluginRef: { goalId: req.goalId },
      lifecycle: { recover: false },
      ...(req.reason === "resume" && req.sessionFile ? { resume: { sessionFile: req.sessionFile } } : {}),
      ...(req.reason === "fresh" && req.reprime ? { initialPrompt: req.reprime } : {}),
    });
    return { success: result.success, ...(result.message ? { message: result.message } : {}) };
  };

  goalSupervisor = createGoalSupervisor({
    store,
    mintSpawnToken: () => ctx.mintSpawnToken(),
    isSessionLive: (sessionId) => {
      const s = getSession(sessionId);
      return !!s && s.status !== "ended";
    },
    resolveSessionFile: (sessionId) => getSession(sessionId)?.sessionFile,
    spawnDriver,
    // Token-first kill order preserved: killByToken then killBySession.
    // See change: relocate-goal-product-to-plugin (D1 supervisor deps map).
    killByToken: (token) => ctx.abortSpawnedRun({ spawnToken: token }),
    killBySession: (sessionId) => ctx.abortSpawnedRun({ sessionId }),
    buildReprime: (goal) => buildGoalReprime(goal),
    // Respawn spawns force strategy:"headless" (spawnDriver); the dashboard
    // always spawns headless, so RPC control is available. See change:
    // add-goal-session-supervisor (C2j).
    headlessAvailable: () => true,
    log: (msg, meta) => console.error(msg, meta ?? ""),
  });

  // Boot-time reconcile: classify any pursuing/respawning goal whose driver
  // did not re-register after a restart. DEFERRED past a reconnect grace
  // window so live drivers re-register first. Same 30 s `unref`'d timer core
  // scheduled. See change: add-goal-session-supervisor (S10).
  const bootReconcileTimer = setTimeout(() => {
    goalSupervisor?.reconcileOnBoot().catch((err) => console.error("[goal-supervisor] boot reconcile failed", err));
  }, GOAL_BOOT_RECONCILE_DELAY_MS);
  bootReconcileTimer.unref?.();

  // ── 7. Death fanout: today core ran the supervisor BEFORE all plugin subs;
  // post-move it is one sub in load order (goal and automation run-stores are
  // disjoint → no ordering dependency). See change:
  // relocate-goal-product-to-plugin (D3).
  ctx.onSessionEnded((sessionId) => {
    void goalSupervisor?.onDriverDeath(sessionId);
  });

  // ── 8. Driver-link handover (first-register only). The host dispatches
  // `onSessionResolved` when a session spawned with this plugin's ref
  // registers; the handler ports core's `linkGoalDriver`: clear the outgoing
  // driver (C2e, memory-only), replaceDriver, clear the in-flight spawn,
  // stamp the incoming driver (persisted), prime. Idempotent for a
  // re-delivered first register via the `driverSessionId !== sessionId`
  // guard. The restore path (reconnect / keeper restart without a pending
  // token) deliberately does NOT dispatch — the ref merge already stamped
  // memory; see design D2 for the accepted `replaceDriver` divergence. See
  // change: detach-automation-goal-from-core,
  // relocate-goal-product-to-plugin (D2).
  ctx.onSessionResolved((sessionId, pluginRef) => {
    const goalId = pluginRef.goalId;
    if (typeof goalId !== "string" || !goalId) return;
    const session = getSession(sessionId);
    const cwd = session?.cwd;
    if (!cwd) return;
    store
      .list(cwd)
      .then((goals) => {
        const goal = goals.find((g) => g.id === goalId);
        if (!goal) return;
        // Idempotent re-delivery: this session already drives the goal.
        if (goal.driverSessionId === sessionId) return;
        // C2e: clear the OUTGOING driver's in-memory goalId so a late
        // snapshot from the replaced session can't project onto the goal
        // after handover (memory-only — meta keeps it for rehydration).
        const prevDriver = goal.driverSessionId;
        if (prevDriver && prevDriver !== sessionId) {
          ctx.assignSessionRef(prevDriver, { goalId: undefined }, { persist: false });
        }
        return store.replaceDriver(cwd, goalId, sessionId);
      })
      .then((updated) => {
        if (!updated) return;
        // Clear any persisted in-flight respawn now the new driver registered.
        if (updated.inFlightSpawn) {
          store.setInFlightSpawn(cwd, goalId, null).catch((err) => {
            // The goal may have been deleted between replaceDriver and this
            // write (GoalNotFoundError) — the respawn stamp is moot then.
            logger.warn(`[goal-link] in-flight clear lost for ${goalId}:`, err);
          });
        }
        ctx.assignSessionRef(sessionId, { goalId });
        primeGoalSessionImpl(sessionId, updated);
      })
      .catch((err) => {
        logger.warn(`[goal-link] failed to link session ${sessionId} to goal ${goalId}:`, err);
      });
  });

  // ── 9. Dispose at the host shutdown point (before piGateway.stop() tears
  // bridges down) — cancels boot reconcile + supervisor backoff timers.
  // See change: relocate-goal-product-to-plugin (D1-#8, D3).
  ctx.onShutdown(() => {
    clearTimeout(bootReconcileTimer);
    goalSupervisor?.dispose();
  });

  // Per-session latest snapshot cache.
  const snapshots = new Map<string, GoalStatusSnapshot>();

  function broadcastSnapshot(sessionId: string, snapshot: GoalStatusSnapshot): void {
    broadcastToSubscribers({
      type: "plugin_event",
      pluginId: GOAL_PLUGIN_ID,
      sessionId,
      event: {
        eventType: GOAL_STATUS_EVENT_TYPE,
        timestamp: Date.now(),
        data: snapshot as unknown as Record<string, unknown>,
      },
    });
  }

  // Bridge → server: clean snapshot mirrored from pi-goal-hermes:event.
  // Registered AFTER the peers above (same relative order as core).
  registerPiHandler(GOAL_STATUS_MESSAGE, (msg) => {
    const m = msg as { sessionId?: string; payload?: GoalStatusSnapshot };
    if (!m.sessionId || !m.payload || typeof m.payload.status !== "string") return;
    if (m.payload.status === "cleared") {
      snapshots.delete(m.sessionId);
    } else {
      snapshots.set(m.sessionId, m.payload);
    }
    broadcastSnapshot(m.sessionId, m.payload);
  });

  // Browser → server control. Round-trip proof; server→pi dispatch deferred.
  registerBrowserHandler("plugin_action", (msg) => {
    const m = msg as {
      pluginId?: string;
      sessionId?: string | null;
      action?: string;
      payload?: Record<string, unknown>;
    };
    if (m.pluginId !== GOAL_PLUGIN_ID || !m.sessionId) return;
    // intent-only tier: record on GoalRecord only, no loop coupling.
    if (commandTier === "intent-only") {
      logger.info(`goal action "${m.action}" suppressed (tier: intent-only)`);
      return;
    }
    const command = m.action ? goalCommandFor(m.action, m.payload, commandTier) : null;
    if (!command) {
      logger.warn(`unknown or malformed goal action: ${m.action}`);
      return;
    }
    // Dispatch the `/goal …` command into the session. The bridge's
    // sessionPrompt routes slash text through the extension-command
    // dispatcher (Path C keeper for headless sessions). The extension then
    // emits a fresh pi-goal-hermes:event, which flows back as a new snapshot.
    const delivered = sendToSession(m.sessionId, command);
    logger.info(`goal action "${m.action}" → "${command}" session=${m.sessionId} delivered=${delivered}`);
  });
}

export default registerPlugin;
