/**
 * Server-integration facade for the embed-session-lifecycle layer.
 *
 * Constructs the live reaper + observability metrics and wires them to the real
 * server components (session manager, browser gateway, terminal manager,
 * headless pid registry, pi gateway). Dormant when `config().enabled` is false
 * (D8) — constructing and starting it is byte-for-byte behavior-preserving on
 * upgrade. The acquire registry + caps are shared-layer modules consumed by the
 * embed/chat-gateway front when it lands (Non-Goal here), so they are NOT
 * constructed live; only the reaper (which reclaims the automation-produced
 * ephemeral sessions #383 is about) runs.
 *
 * See OpenSpec change: add-embed-session-lifecycle.
 */
import type { EmbedLifecycleConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { TerminateResult } from "../spawn-process/session-terminator.js";
import { createIdleReaper, type IdleReaper } from "./idle-reaper.js";
import {
  createLifecycleMetrics,
  type LifecycleMetrics,
  type LifecycleMetricsSnapshot,
} from "./lifecycle-metrics.js";
import { createLivenessProbe, type LivenessProbe } from "./liveness-probe.js";
import { createReclaimGiveUpTracker, type ReclaimGiveUpTracker } from "./reclaim-give-up.js";
import type { SessionCloserRegistry } from "./plugin-session-close.js";
import { isEphemeral } from "./session-lifecycle-policy.js";

export interface EmbedLifecycleControllerDeps {
  config: () => EmbedLifecycleConfig;
  listSessions: () => readonly DashboardSession[];
  getSubscriberCount: (sessionId: string) => number;
  listTerminalCwds: () => readonly string[];
  hasPendingUiRequest: (sessionId: string) => boolean;
  /**
   * Unanswered PromptBus request tracked for the session. Unioned with
   * `hasPendingUiRequest` into the reaper's `hasPendingAsk` — without it a
   * PromptBus-blocked session is invisible to the reaper and can be
   * phantom-reaped, violating embed-session-lifecycle's existing
   * "ask_user-blocked session is never phantom-reaped".
   * Optional so existing callers/tests that predate the union still compile.
   * See change: restore-ask-user-tool-state-on-reconnect (D5).
   */
  hasPendingPromptRequests?: (sessionId: string) => boolean;
  /** Shared terminator, bound with unattended options at the injection site (server.ts). */
  terminate: (sessionId: string) => Promise<TerminateResult>;
  /** Latch `stop_after_turn`; `true` when delivered to the bridge. */
  sendStopAfterTurn: (sessionId: string) => boolean;
  /** Test seam for the liveness probe (defaults to the real `ps` probe). */
  probe?: LivenessProbe;
  /**
   * Plugin closer registry + close requests. Absent ⇒ no closers, no
   * requests (undeclared behavior). See change: add-session-close-plugin-hook.
   */
  closers?: SessionCloserRegistry;
  /**
   * `false` ⇒ the owning plugin is disabled: its closer is not consulted
   * (no closer ⇒ close). Absent ⇒ every owner counts as enabled.
   */
  isPluginEnabled?: (pluginId: string) => boolean;
  /** Close mode `archive`: mark archive-on-end (+ persist). */
  markArchiveOnEnd?: (sessionId: string, value?: boolean) => void;
  log?: (msg: string) => void;
}

export interface EmbedLifecycleController {
  metrics: LifecycleMetrics;
  reaper: IdleReaper;
  /** Give-up state shared by the reaper and the caps gate (`createCapsAdmission({ giveUp })`). */
  giveUp: ReclaimGiveUpTracker;
  start: () => void;
  stop: () => void;
  snapshot: () => LifecycleMetricsSnapshot;
}

/** An ephemeral session that is not ended is "active". */
function isActiveEphemeral(s: DashboardSession): boolean {
  return isEphemeral(s) && s.status !== "ended";
}

export function createEmbedLifecycleController(
  deps: EmbedLifecycleControllerDeps,
): EmbedLifecycleController {
  const probe = deps.probe ?? createLivenessProbe();
  const log = deps.log ?? ((m: string) => console.log(m));

  const metrics = createLifecycleMetrics({
    countActiveEphemeral: () => deps.listSessions().filter(isActiveEphemeral).length,
    // A cheap idle approximation for diagnostics: active ephemeral, not
    // streaming, no tool running. The reaper itself uses the full predicate.
    countIdleEphemeral: () =>
      deps
        .listSessions()
        .filter((s) => isActiveEphemeral(s) && s.status !== "streaming" && s.currentTool == null)
        .length,
  });

  const giveUp = createReclaimGiveUpTracker();

  const reaper = createIdleReaper({
    config: deps.config,
    listSessions: deps.listSessions,
    probe,
    hasSubscriber: (id) => deps.getSubscriberCount(id) > 0,
    hasTerminalInCwd: (cwd) => deps.listTerminalCwds().some((c) => c === cwd),
    // The union is explicit, not an accident of `currentTool: "ask_user"`:
    // that field only vetoes the IDLE gear (quiescence.ts), while
    // `streamingGearVerdict` reads `hasPendingAsk` and never `currentTool`,
    // so relying on the derivation would leave the phantom-reap path open.
    // See change: restore-ask-user-tool-state-on-reconnect (D5).
    hasPendingAsk: (id) =>
      deps.hasPendingUiRequest(id) || (deps.hasPendingPromptRequests?.(id) ?? false),
    queueCounts: (id) => {
      const q = deps.listSessions().find((s) => s.id === id)?.pendingQueues;
      return { followUp: q?.followUp.length ?? 0, steering: q?.steering.length ?? 0 };
    },
    terminate: deps.terminate,
    sendStopAfterTurn: deps.sendStopAfterTurn,
    giveUp,
    onReap: (id, reason, declared) => {
      metrics.recordReap(reason);
      if (declared) {
        metrics.recordDeclaredReap();
        log(`[session-close] reaped ${id} reason=${reason} declared=true owner=${declared.owner}`);
      }
    },
    onReclaimFailed: () => metrics.recordReclaimFailure(),
    closerFor: (owner) =>
      deps.isPluginEnabled?.(owner) === false ? undefined : deps.closers?.get(owner),
    isCloseRequested: (id) => deps.closers?.isCloseRequested(id) ?? false,
    clearCloseRequest: (id) => deps.closers?.clearCloseRequest(id),
    markArchiveOnEnd: deps.markArchiveOnEnd,
    onCloserVerdict: (id, owner, reason, outcome) => {
      metrics.recordCloserOutcome(outcome);
      log(`[session-close] closer of "${owner}" for ${id} reason=${reason} verdict=${outcome}`);
    },
  });

  return {
    metrics,
    reaper,
    giveUp,
    start: () => reaper.start(),
    stop: () => reaper.stop(),
    snapshot: () => metrics.snapshot(),
  };
}
