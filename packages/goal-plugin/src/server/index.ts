/**
 * goal-plugin · SERVER entry.
 *
 * Caches the latest `GoalStatusSnapshot` per session (snapshot model,
 * mirroring `queue_update` semantics) and broadcasts it to subscribed
 * browsers as a synthetic `plugin_event`. Receives the bridge-mirrored
 * snapshot over the generic `registerPiHandler("goal_status", …)` channel
 * (infra added in change add-goal-continuation-plugin, section 1b).
 *
 * Control (`plugin_action`: set/pause/resume/done/clear) round-trips from any
 * browser. v1 logs + re-broadcasts the cached snapshot; dispatching the
 * control INTO the running session (server→pi) is deferred — the same
 * follow-up the flows plugin tracks for server-driven control.
 *
 * See change: add-goal-continuation-plugin (design.md Decisions 3 & 4).
 */
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
import type { GoalBudget, GoalJudge } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Detect the running extension's command surface. The extension is not
 * vendored, so we can't import its grammar; we baseline to the commands the
 * bridge already round-trips today (`/goal`, `/subgoal`) → dashboard-budget
 * tier. Upgrade seam: when a future extension advertises a config command,
 * flip `acceptsConfig` here (or detect it) to reach the `full` tier.
 */
function detectGoalCommandSurface(): GoalCommandSurface {
  return { acceptsSubgoal: true };
}

/** Per-session latest snapshot cache. */
const snapshots = new Map<string, GoalStatusSnapshot>();

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

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const { logger, broadcastToSubscribers, registerPiHandler, registerBrowserHandler, sendToSession } = ctx;
  const commandTier = probeGoalCommandSurface(detectGoalCommandSurface());
  logger.info(`goal-plugin server entry activated (command tier: ${commandTier})`);

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
