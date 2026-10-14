/**
 * pi lifecycle handlers (`session_start`, `turn_end`, `session_shutdown`, `session_info_changed`, `project_trust`).
 *
 * Extracted from `bridge.ts` (change: test-trust-audit, design D2). Receives the per-incarnation
 * `BridgeInstance`; holds no module-level mutable state and never imports the bridge entry point.
 */

import { loadConfig, resolveDashboardPorts } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { discoverDashboard } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { Loader } from "@earendil-works/pi-tui";
import { cleanupAttachmentsForSession, } from "../ask-user-attachments.js";
import { registerAskUserTool } from "../ask-user-tool.js";
import { extractFirstMessage, filterHiddenCommands, getCurrentModelString, isHeadlessRpcSession, safeCwd } from "../bridge-context.js";
import { hasExplicitModelArg, shouldApplyDefaultModel } from "../bridge-default-model-gate.js";
import { drainDisposables } from "../bridge-polling.js";
import { registerCanvasTool } from "../canvas-tool.js";
import { DashboardDefaultAdapter } from "../dashboard-default-adapter.js";
import { decideRetarget } from "../endpoint-resolution.js";
import { mapEventToProtocol } from "../event-forwarder.js";
import { bridgeExtensionIdentity } from "../extension-identity.js";
import { registerFlowEventListeners } from "../flow-event-wiring.js";
import { createGitPollState, runGitPollTick } from "../git-poll.js";
import { flipHasUI } from "../hasui-flip.js";
import { healthUrlForInstance, probeEndpointReachability, verifyInstanceIdentity } from "../instance-verification.js";
import { sendPiVersionIfChanged as _sendPiVersionIfChanged } from "../model-tracker.js";
import { provisionOpenspecCli } from "../openspec-cli-shim.js";
import { pollCost } from "../poll-cost.js";
import { collectMetrics, startMetricsMonitor, stopMetricsMonitor } from "../process-metrics.js";
import { createProcessScanScheduler } from "../process-scan-scheduler.js";
import { scanChildProcessesAsync } from "../process-scanner.js";
import { decideProjectTrust, readEventCwd } from "../project-trust.js";
import { PromptBus } from "../prompt-bus.js";
import { buildProviderCatalogue, toModelInfo } from "../provider-register.js";
import { gateRemoteRegistration, isRemoteEndpoint } from "../remote-registration-gate.js";
import { registerRoleModelTools } from "../role-model-tools.js";
import { autoStartServer } from "../server-auto-start.js";
import { launchServer } from "../server-launcher.js";
import { loadServerPins, notePinEndpoint, serverPinsPath } from "../server-pin-store.js";
import { handleSessionChange as _handleSessionChange, consumeSpawnToken, filterByEnabledModels, isLive } from "../session-sync.js";
import { detectSessionSource } from "../source-detector.js";
import { consumePendingReloadOnSessionStart, releaseBridgeOwnerOnShutdown, reloadCompletedFeedback } from "../terminal-reload.js";
import { refreshUiModules, subscribeUiInvalidate } from "../ui-modules.js";
import { runUiSafely } from "../ui-stale-guard.js";
import { sendShutdownUsageThenUnregister, type UsageDrain } from "../usage-drain.js";
import { detectIsGitRepo } from "../vcs-info.js";
import { buildVisibilityRegisterFields } from "../visibility-intent.js";
import { formatHostPort } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import type { BridgeInstance } from "./instance.js";
import { patchUiForPromptBus } from "./ui-prompt-patch.js";

const HEARTBEAT_INTERVAL = 15_000;
const GIT_POLL_INTERVAL = 30_000;
// Platform-aware process scan cadence. Windows keeps the original 10 s /
// 30 s floor because PowerShell Get-CimInstance is expensive and can flash consoles;
// Unix uses 5 s / 5 s so legitimate bash subprocesses surface while still
// running. See change: tighten-process-list-ux.
const PROCESS_MIN_ELAPSED_MS = process.platform === "win32" ? 30_000 : 5_000; // platform-branch-ok: Windows-safe default (costly PowerShell Get-CimInstance)

/** Env var a plugin spawn uses to override `askUserPromptTimeoutSeconds` for one session. */
const ASK_USER_TIMEOUT_ENV = "PI_EXT_PI_DASHBOARD_ASK_USER_PROMPT_TIMEOUT_SECONDS";

/**
 * Effective PromptBus `timeoutMs`: a valid integer override from the environment
 * wins over `configSeconds`; a value `<= 0` means infinite (returned as `-1`).
 * A non-integer override is ignored with a warning; empty counts as absent.
 * See change: add-pending-question-stack (D11).
 */
export function resolveAskUserTimeoutMs(
  configSeconds: number,
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string) => void = (m) => console.warn(m),
): number {
  let seconds = configSeconds;
  const raw = env[ASK_USER_TIMEOUT_ENV]?.trim();
  if (raw) {
    if (/^-?\d+$/.test(raw)) seconds = Number.parseInt(raw, 10);
    else warn(`[bridge] ignoring ${ASK_USER_TIMEOUT_ENV}=${JSON.stringify(raw)}: not an integer; using config`);
  }
  return seconds > 0 ? seconds * 1000 : -1;
}

// Shared handler for session changes (new/fork/resume)
function handleSessionChange(inst: BridgeInstance, ctx: any, usageSeed?: ReturnType<UsageDrain["baseline"]>) {
  // Clear attachedChange on a real session switch (new/fork/resume): it is
  // persisted globally + restored at activate, so without this the previous
  // session's attached change would leak into the new session's prompt until
  // the server replays. The server re-pushes the correct value for the new
  // sessionId on its session_register. See change: inject-session-context-into-agent.
  inst.attachedChange = null;
  inst.shared.attachedChange = null;
  // Drop retained subagent frames/snapshots on a real session switch — the
  // new/fork/resumed session's subagents are unrelated to the outgoing one.
  // See change: fix-subagent-live-detail-reliability.
  inst.subagentFrameBuffer.reset();
  // Same disposal point for the tick throttle: clear every armed trailing
  // timer and drop every held frame, so nothing from the outgoing session
  // can fire against the new one.
  // See change: reduce-bridge-tick-bandwidth (D3).
  inst.subagentTickThrottle.reset();
  // A session boundary invalidates the CONTENT itself (unlike a reconnect), so
  // drop any parked text snapshot and cancel its window rather than flushing
  // it into the new session. See change:
  // coalesce-bridge-message-update-snapshots (D8).
  inst.coalescer.clear();
  // Clear the stop-after-turn latch so a new/fork/resumed session does not
  // inherit the previous session's pending graceful-stop and shut down on
  // its first turn_end. See change: adopt-pi-071-072-073-features.
  inst.shared.shouldStopAfterTurn = false;
  // Drop the auto-namer and its carried state: it is a PER-SESSION state
  // machine, so a new/fork/resumed session must not inherit the outgoing
  // session's permanent stop, spent attempt budget or auto-named flag — it
  // would report `stopped` / `already-named` without ever attempting to name.
  // The server re-pushes the incoming session's own persisted state on its
  // session_register. See change: fix-auto-naming-reasoning-model.
  inst.autoNamer = undefined;
  inst.namerState = undefined;
  inst.shared.namerState = undefined;
  // Bridge shadow queues reset on session change so the new session
  // starts with empty chips. See change: add-followup-edit-and-steer-cancel.
  if (inst.bridgeSteering.length > 0 || inst.bridgeFollowUp.length > 0) {
    inst.bridgeSteering = [];
    // Drops every entry AND its image bytes, releasing the byte budget.
    inst.bridgeFollowUp.reset();
    inst.emitQueueUpdate();
  }
  inst.renewGitTracker();
  const bc = inst.syncBc();
  _handleSessionChange(bc, ctx, inst.getFlowsList, usageSeed);
  inst.applyBc(bc);
  // A new session id needs its own `pi_version_update` (below-floor flag).
  // After applyBc, so syncBc() carries the NEW session id.
  // See change: update-pi-core-1-0-adopt-apis.
  inst.sendPiVersionIfChanged();

  // Restart polling timers
  startGitPollTimer(inst, ctx);
}

// Single source of truth for the git + name/model poll loop. Both session
// start and session change call this so the two timers can never drift.
// Caches ctx.cwd (the throwing getter) and clears any prior timer first.
function startGitPollTimer(inst: BridgeInstance, ctx: any) {
  if (inst.gitPollTimer) clearInterval(inst.gitPollTimer);
  // safeCwd: startGitPollTimer runs inside handleSessionChange BEFORE
  // connection.connect(); an un-guarded ctx.cwd throw here skips connect()
  // (#393). See change: fix-bridge-resume-disconnect.
  inst.cachedCwd = safeCwd(ctx);
  const pollState = createGitPollState();
  inst.gitPollTimer = setInterval(() => {
    // runGitPollTick handles a rejecting git tick itself; this catch is the
    // last line so the interval callback can never raise an unhandled rejection.
    runGitPollTick({
      isActive: inst.isActive,
      cachedCwd: () => inst.cachedCwd,
      tickGit: (cwd) => {
        const gbc = inst.syncBc();
        inst.polling.gitTracker?.tick(gbc, cwd);
        inst.applyBc(gbc);
      },
      sendCwdMissingIfChanged: inst.sendCwdMissingIfChanged,
      sendSessionNameIfChanged: inst.sendSessionNameIfChanged,
      sendModelUpdateIfChanged: inst.sendModelUpdateIfChanged,
      sendPiVersionIfChanged: () => _sendPiVersionIfChanged(inst.syncBc()),
      state: pollState,
    }).catch((err) => console.error("[dashboard] git poll tick failed:", err));
  }, GIT_POLL_INTERVAL);
  inst.shared.timers!.push(inst.gitPollTimer);
}

/** `session_info_changed`: relay a pi-side session rename to the dashboard. */
export function registerSessionInfoChanged(inst: BridgeInstance): void {
  const pi = inst.pi;
  try {
    pi.on("session_info_changed" as any, inst.safe(async (event: any) => {
      if (!inst.isActive() || !inst.sessionReady) return;
      const name = typeof event?.name === "string" ? event.name : pi.getSessionName();
      if (typeof name === "string" && name.length > 0) {
        inst.getAutoNamer().onObservedName(name);
      }
    }));
  } catch { /* older pi: no session_info_changed — poll fallback covers it */ }
}

/** `project_trust`: trust-gate decision for the dashboard-spawned project. */
export function registerProjectTrust(inst: BridgeInstance): void {
  const pi = inst.pi;
  try {
    pi.on("project_trust" as any, inst.safe((event: any, ctx: any) => {
      // Return the pi trust decision. A newer bridge taking over, or any
      // non-match, defers. `remember:false` = trust for THIS run only.
      if (!inst.isActive()) return { trusted: "undecided" };
      const decision = decideProjectTrust({
        dashboardSpawned: inst.dashboardSpawned,
        isHeadless: isHeadlessRpcSession(),
        eventCwd: readEventCwd(event, ctx),
        activationCwd: inst.activationCwd,
      });
      return decision === "trust"
        ? { trusted: "yes", remember: false }
        : { trusted: "undecided" };
    }));
  } catch { /* older pi: no project_trust event — no-op */ }
}

const VAULT_START_REASONS = new Set(["startup", "reload", "new", "resume", "fork"]);

/** `session_start`: register the session, build the PromptBus, patch `ctx.ui`, arm timers. */
export function registerSessionStart(inst: BridgeInstance): void {
  const pi = inst.pi;
  pi.on("session_start", inst.safe(async (_event: any, ctx: any) => {

    // Bail out if a newer bridge instance has taken over
    if (!inst.isActive()) return;
    const newSessionId = ctx.sessionManager.getSessionId();
    inst.pathGate.onSessionStart();
    // Credential vault: resolve the project from THIS session's own cwd (never the
    // launch directory) on every start reason; an unreadable cwd withdraws all.
    // See change: add-credential-vault (D2, D3).
    void inst.vaultDelivery
      .onSessionStart({
        reason: VAULT_START_REASONS.has(_event?.reason) ? _event.reason : "startup",
        getCwd: () => ctx.sessionManager.getCwd(),
      })
      .catch(() => {});
    // Re-arm MCP registration for the (replacement) session; its mint below
    // registers pi-dashboard again. See change: migrate-mcp-to-pi-builtin (D1).
    inst.mcpRegistrar.onSessionStart();

    // On session switch/fork (0.65.0+: event.reason replaces session_switch/session_fork events),
    // unregister the old session before re-registering the new one.
    const reason = _event?.reason;
    // Synchronous compare-and-set BEFORE any await: this instance was loaded
    // by a dashboard-requested reload → it owns the `/reload` `completed`,
    // emitted after `replay_complete` below.
    // See change: fix-terminal-session-dashboard-reload (D4).
    const reloadDelivered = consumePendingReloadOnSessionStart(reason, newSessionId);
    // Baseline + seed from ONE snapshot, before any register goes out: the
    // drain forwards only entries appended after this point, and the register
    // carries this snapshot's full totals. Undefined on a failed read.
    // See change: count-non-message-usage.
    let usageSeed: ReturnType<UsageDrain["baseline"]> | undefined;
    try {
      usageSeed = inst.usageDrain.baseline(ctx.sessionManager);
    } catch (err) {
      console.error("[dashboard] usage baseline failed:", err);
    }
    const sessionChanged =
      (reason === "new" || reason === "fork" || reason === "resume") && !!inst.sessionId && inst.sessionId !== newSessionId;
    if (sessionChanged) {
      // Clear any latched abort for the OUTGOING session id. Otherwise a
      // latched old session that is resumed later would have its first
      // legitimate turn aborted by the agent_start/message_start latch hooks.
      // See change: unify-error-retry-lifecycle.
      inst.abortLatch.clear(inst.sessionId);
      handleSessionChange(inst, ctx, usageSeed);
    }

    inst.cachedHasUI = ctx.hasUI;
    inst.cachedCtx = ctx;
    inst.sessionId = newSessionId;

    // Provision the openspec CLI: drop a shim on process.env.PATH so the
    // generated openspec-* skills' bare `openspec` resolves in-session. Runs on
    // init AND /reload (re-points the shim on extension upgrade); the PATH
    // prepend is idempotent. Fail-soft: on hard failure, surface a
    // dashboard-visible missing-tool signal. See change:
    // provision-openspec-cli-in-sessions.
    provisionOpenspecCli({
      onMissingTool: (reason) => {
        inst.connection.send({
          type: "event_forward",
          sessionId: inst.sessionId,
          event: {
            eventType: "bash_output",
            timestamp: Date.now(),
            data: {
              command: "openspec (session provisioning)",
              output: reason,
              exitCode: 127,
              excludeFromContext: true,
              missingTool: { kind: "missing-tool", toolName: "openspec" },
            },
          },
        });
      },
    });

    // Wrap sessionManager.appendMessage so that future message_end events can
    // recover the just-generated entry id, even when their setTimeout(0)
    // fires before pi has finished mutating event.message in place. The
    // helper is idempotent and re-wraps on session replacement.
    // See change: fix-per-message-fork.
    inst.appendMessageWrapped = false;
    inst.lastWrappedSm = null;
    inst.wrapAppendMessageForCtx(ctx);
    // Wrap the custom-persistence chokepoint BEFORE any events flow, so an
    // extension appending at session_start is still forwarded. See change:
    // render-inline-reasoning-and-custom-entries (D2).
    inst.customPersistenceWrapped = false;
    inst.customWrappedSm = null;
    inst.wrapCustomPersistenceForCtx(ctx);

    // Register ask_user at runtime (not at load time) to avoid static
    // tool-name conflicts with other extensions like pi-flows.
    registerAskUserTool(pi);

    // Register the canvas declare-tool (change: auto-canvas). Fire-and-forget
    // UI intent; the server observes the forwarded tool call and drives the
    // canvas. Runtime registration for the same conflict-avoidance reason.
    registerCanvasTool(pi);

    // Register the agent-facing role/model tools (list_models, list_roles,
    // update_roles). list_models reads the in-process session registry via a
    // live getter so its refs match the human Model Selector exactly.
    // See change: add-agent-role-model-tools.
    registerRoleModelTools(pi, {
      getRegistry: () => inst.cachedModelRegistry,
      // Live scope read at call time from the latest captured ctx (dynamic via
      // Ctrl+P cycling). Absent on older pi / empty when unscoped → no filter.
      // See change: update-pi-core-0-83-adopt-apis.
      getScopedModels: () => (inst.cachedCtx as any)?.scopedModels,
    });

    // Extract session file/dir early — needed for source detection and UI proxy
    const sessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;
    const sessionDir = ctx.sessionManager.getSessionDir?.() ?? undefined;
    inst.lastSessionFile = sessionFile;
    inst.lastSessionDir = sessionDir;

    // ── PromptBus setup ──
    // Create bus with dashboard connection wiring.
    // Replaces the old ui-proxy race pattern.
    // Convert seconds → milliseconds for PromptBus.
    // Values <= 0 (e.g. -1) are passed through as-is to signal infinite wait.
    // A per-session env override (set by plugin spawns) wins over config.
    // See change: add-pending-question-stack (D11).
    const askUserTimeoutMs = resolveAskUserTimeoutMs(inst.config.askUserPromptTimeoutSeconds);
    inst.promptBus = new PromptBus({
      timeoutMs: askUserTimeoutMs,
      onDashboardRequest: (prompt, component, placement) => {
        inst.connection.send({
          type: "prompt_request" as any,
          sessionId: inst.sessionId,
          promptId: prompt.id,
          prompt: {
            question: prompt.question,
            type: prompt.type,
            options: prompt.options,
            defaultValue: prompt.defaultValue,
            pipeline: prompt.pipeline,
            metadata: prompt.metadata,
          },
          component,
          placement,
        });
      },
      onDashboardDismiss: (id) => {
        inst.connection.send({ type: "prompt_dismiss" as any, sessionId: inst.sessionId, promptId: id });
      },
      onDashboardCancel: (id) => {
        inst.connection.send({ type: "prompt_cancel" as any, sessionId: inst.sessionId, promptId: id });
      },
    });

    // Register built-in default adapter (always present, works without pi-flows)
    inst.promptBus.registerAdapter(new DashboardDefaultAdapter());

    patchUiForPromptBus(inst, ctx, inst.promptBus);

    // Flip ctx.hasUI=true now that ctx.ui.* has been patched to route
    // through PromptBus → dashboard. `cachedHasUI` (captured earlier at
    // line ~1287) retains the pi-supplied original value, so
    // `detectSessionSource` continues to classify dashboard-spawned RPC
    // vs tmux correctly. Extensions that branch on `ctx.hasUI`
    // (context-mode `/ctx-stats` / `/ctx-doctor`, pi-agent-browser auto-install)
    // now take their UI-present branch and render output via the proxied
    // `ctx.ui.notify`. See change: fix-bridge-hasui-for-headless-rpc.
    flipHasUI(ctx);

    // Listen for adapter registrations from other extensions (e.g. pi-flows)
    if (pi.events) {
      pi.events.on("prompt:register-adapter", (adapter: any) => {
        if (inst.promptBus && adapter && typeof adapter.name === "string") {
          inst.promptBus.registerAdapter(adapter);
          // Inject respond/cancel functions so cross-package adapters can talk back
          if (typeof adapter.setRespond === "function") {
            adapter.setRespond((response: any) => inst.promptBus!.respond(response));
          }
          if (typeof adapter.setCancel === "function") {
            adapter.setCancel((id: string) => inst.promptBus!.cancel(id));
          }
        }
      });

      // Expose bus request function for pi-flows to use via emitPromptAndAwait
      pi.events.emit("prompt:set-bus-request", {
        request: (options: any) => inst.promptBus!.request(options),
      });

      // Generic system-follow-up channel: any plugin bridge entry can request
      // a system-originated continuation through the single drain path by
      // emitting `dashboard:enqueue-followup`. Inert when no plugin emits it.
      // See change: add-goal-continuation-plugin (Decision 2).
      pi.events.on("dashboard:enqueue-followup", (payload: any) => {
        if (payload && typeof payload.text === "string") {
          inst.enqueueSystemFollowup(payload.text);
        }
      });

      // Generic plugin bridge→server channel: a plugin bridge entry emits
      // `dashboard:plugin-message` and the main bridge wraps it in a
      // `plugin_pi_message` envelope over the extension WS. The server
      // dispatches to handlers registered via
      // `ServerPluginContext.registerPiHandler(messageType, handler)`.
      // See change: add-goal-continuation-plugin.
      pi.events.on("dashboard:plugin-message", (payload: any) => {
        if (
          payload &&
          typeof payload.pluginId === "string" &&
          typeof payload.messageType === "string"
        ) {
          inst.connection.send({
            type: "plugin_pi_message",
            sessionId: inst.sessionId,
            pluginId: payload.pluginId,
            messageType: payload.messageType,
            payload: payload.payload ?? null,
          });
        }
      });
    }

    // Connect first, then auto-start if needed.
    // session_register must be buffered before any event_forward messages.
    //
    // (tasks 7.2/7.3) A REMOTE endpoint is challenged BEFORE the connection
    // opens: across a network an address proves nothing, so the pinned Ed25519
    // identity is the only thing that answers "is this my dashboard?" (D8).
    // Local endpoints are unaffected — the socket/loopback token already
    // authorises them — so this adds no latency to the common path.
    if (isRemoteEndpoint(inst.dashboardUrl)) {
      const pinsFile = serverPinsPath();
      const connectIfIdentityVerifies = async () => {
        const verdict = await gateRemoteRegistration({
          endpoint: inst.dashboardUrl,
          store: loadServerPins(pinsFile),
        });
        // Task 10.3: the cause is distinguishable in the log, not folded into
        // a generic connection failure.
        const line = `[dashboard] remote identity ${verdict.cause}: ${verdict.reason}`;
        if (!verdict.allow) {
          console.error(`${line} — not registering`);
          return;
        }
        console.log(line);
        // Only a VERIFIED identity gets its address remembered.
        if (verdict.fingerprint) notePinEndpoint(pinsFile, verdict.fingerprint, inst.dashboardUrl);
        inst.connection.connect();
      };
      // Guarded discard: a failure here must be OBSERVED, never take the host
      // pi agent down.
      void connectIfIdentityVerifies().catch((err) => console.error("[dashboard]", err));
    } else {
      inst.connection.connect();
    }
    // Drain the buffered transport diagnostics through the live connection
    // (task 10.5). `send()` buffers while the socket is down, which is the
    // right behaviour here: the detail is self-describing, so a late delivery
    // is still a true one.
    inst.transportDiagnostics.attach({
      send: (m) => inst.connection.send(m),
      getSessionId: () => inst.sessionId,
    });

    // (task 3.8) Verify the instance answering at the recorded endpoint really
    // is the one the record named. The socket's mode and the local token are
    // both per-HOME, so a same-HOME impostor passes them — only the published
    // `instanceId` distinguishes instances. Refusal is loud and does NOT fall
    // back to a discovered substitute: that substitution is the bug.
    if (
      inst.endpointChoice.available &&
      inst.endpointChoice.source === "rendezvous-record" &&
      inst.rendezvous?.instanceId
    ) {
      // Alias: property narrowing on `inst.rendezvous` does not survive into the closure.
      const rendezvous = inst.rendezvous;
      const verifyRecordedInstance = async () => {
        const verdict = await verifyInstanceIdentity({
          healthUrl: healthUrlForInstance(rendezvous.httpPort),
          expectedInstanceId: rendezvous.instanceId,
        });
        if (verdict.adopt) {
          inst.registeredInstanceId = rendezvous.instanceId;
          return;
        }
        // Only a CONFLICT justifies tearing the connection down. `disconnect()`
        // sets `intentionalClose`, so nothing rearms the backoff loop and the
        // session is dead until pi itself restarts — right for an impostor,
        // catastrophic for an outage. `/api/health` is unreachable for seconds
        // on every `POST /api/restart` while the gateway socket stays healthy,
        // so treating silence as refusal would kill every bridge on the host on
        // every rebuild. Unverified means we simply do not claim an identity.
        if (!verdict.conflict) {
          console.error(
            `[dashboard] instance verification ${verdict.reason} — keeping the connection, identity unclaimed`,
          );
          inst.registeredInstanceId = undefined;
          return;
        }
        console.error(`[dashboard] instance verification ${verdict.reason} — disconnecting`);
        inst.registeredInstanceId = undefined;
        try {
          inst.connection.disconnect();
        } catch {
          /* already down */
        }
      };
      // Guarded discard: the verification runs alongside the connection and
      // must never take the host pi agent down, but its failure must still be
      // OBSERVED rather than dropped on the floor.
      void verifyRecordedInstance().catch((err) => console.error("[dashboard]", err));
    }

    // Extract first message (sessionFile/sessionDir already extracted above)
    const firstMessage = extractFirstMessage(ctx);
    inst.lastFirstMessage = firstMessage;

    // Register session with initial model/thinkingLevel
    inst.lastSessionName = pi.getSessionName() ?? "";
    const initialModel = getCurrentModelString(inst.syncBc());
    const initialThinkingLevel = (pi as any).getThinkingLevel?.() ?? undefined;
    inst.lastModel = initialModel;
    inst.lastThinkingLevel = initialThinkingLevel;

    // Include eventCount so server can skip event wipe on reconnect
    let eventCount: number | undefined;
    try {
      const entries = ctx.sessionManager?.getBranch?.();
      if (entries) eventCount = entries.length;
    } catch { /* ignore */ }

    // See change: fix-dashboard-source-mislabelling — sent on every
    // register so server can re-stamp source after restart. Derived from the
    // capture-once boolean (token may already be scrubbed). See change:
    // fix-spawn-token-env-leak.
    // ctx.cwd is the guarded getter that throws once the session is replaced.
    // Read it once, defensively — a throw here would skip session_register +
    // the heartbeat/git timers, leaving a resumed session dead in the UI.
    // See change: fix-bridge-resume-disconnect.
    const startCwd = safeCwd(ctx);
    const spawnToken = consumeSpawnToken();
    inst.connection.send({
      type: "session_register",
      extensionIdentity: bridgeExtensionIdentity(),
      sessionId: inst.sessionId,
      cwd: startCwd,
      name: inst.lastSessionName || undefined,
      source: detectSessionSource(inst.cachedHasUI, sessionFile),
      model: initialModel,
      thinkingLevel: initialThinkingLevel,
      sessionFile,
      sessionDir,
      firstMessage,
      eventCount,
      // The ONLY channel by which the server learns this session's process for a
      // non-headless spawn: `tmux new-window` returns tmux's own pid, not pi's,
      // so without this the server's record has no `pid` and shutdown has
      // nothing to escalate to — the session was unregistered while a ~127 MB
      // pi kept running (#452). The two `session_register` sends in
      // session-sync.ts already carry it; this one, the FIRST register of a
      // fresh session, did not.
      // See change: fix-tmux-session-shutdown-leak (D6).
      pid: process.pid,
      // The spawn correlation token, echoed back so the server can match THIS
      // register to the spawn that produced it. This is a fresh session's FIRST
      // register, and it omitted the token entirely: tier-1 correlation never
      // fired for a dashboard spawn, so the spawn watchdog could only match by
      // cwd and reported false register-timeouts for concurrent spawns into one
      // directory. Single-use — `consumeSpawnToken` scrubs the env.
      // See change: fix-tmux-session-shutdown-leak (D5).
      ...(spawnToken ? { spawnToken } : {}),
      ...(inst.dashboardSpawned ? { dashboardSpawned: true } : {}),
      // Tri-state git-repo signal, computed at register time (authority).
      // See change: gate-session-worktree-button-on-git.
      isGitRepo: detectIsGitRepo(startCwd),
      // Fact-forwarding: server decides auto-hide. See change:
      // auto-hide-headless-worker-sessions.
      ...buildVisibilityRegisterFields(inst.cachedHasUI, process.env),
      // Applied server-side only for an id it has no record of.
      // See change: count-non-message-usage.
      ...(usageSeed ? { usageSeed } : {}),
    });

    // The register above just went out (live socket, or buffered for the
    // open — either way the manager learns its last-registered endpoint for
    // the migration gate's reversal target).
    // See change: fix-bridge-mdns-migration-hijack (task 2.1).
    inst.connection.noteRegistered();

    // Allow event forwarding now that session_register is buffered
    inst.sessionReady = true;

    // D3: mint-on-registration. Ask the mcp-server plugin for this session's
    // /mcp credential now that the socket is (re)registered — the reply
    // arrives on the session-private lane (mcp_token_minted) and registers
    // pi-dashboard with pi's built-in MCP, and re-registers after every
    // reconnect, which is what makes a dashboard restart self-heal. Ordered
    // after session_register on the SAME socket, so the server's
    // connection-key attribution is already established when it arrives.
    // See change: wire-mcp-session-token (D3/D5).
    inst.connection.send({
      type: "plugin_pi_message",
      sessionId: inst.sessionId,
      pluginId: "mcp-server",
      messageType: "mcp/mint-token",
      payload: {},
    });

    // Flush any subagent frames buffered during the not-ready window (D1) so a
    // reconnect/discovery/reload gap self-heals instead of leaving a running
    // subagent's detail empty. See change: fix-subagent-live-detail-reliability.
    inst.flushPendingSubagentFrames();

    // Replay full session history so the dashboard has all messages. A turn
    // still running across a `/reload` keeps its in-flight calls open instead
    // of getting a fabricated `session_ended` end. See change:
    // fix-replay-fabricates-orphan-end-for-live-calls (D3).
    inst.replaySessionEntries({ liveTailOpen: isLive(ctx, inst.shared.isAgentStreaming) });
    inst.connection.send({ type: "replay_complete", sessionId: inst.sessionId });
    // After replay_complete: inside the replay window the server may drop
    // forwarded events without insert or broadcast (`skipReplayInsert`).
    // See change: fix-terminal-session-dashboard-reload (D4).
    if (reloadDelivered) inst.connection.send(reloadCompletedFeedback(inst.sessionId));
    // If agent is mid-turn (e.g. reload during streaming), send synthetic agent_start
    if (inst.shared.isAgentStreaming) {
      // `synthetic` lets the server's end-of-session open-call scan see past
      // this re-announcement. See change: fix-replay-fabricates-orphan-end-for-live-calls (D4).
      inst.connection.send(mapEventToProtocol(inst.sessionId, { type: "agent_start", synthetic: true }));
    }

    // Send initial commands list
    const commands = filterHiddenCommands(pi.getCommands());
    inst.connection.send({
      type: "commands_list",
      sessionId: inst.sessionId,
      commands,
    });

    // Send initial flows list
    inst.sendFlowsList();

    // Send available models
    inst.cachedModelRegistry = (ctx as any).modelRegistry;
    if (inst.cachedModelRegistry) {
      try {
        const models = filterByEnabledModels(inst.cachedModelRegistry.getAvailable().map(toModelInfo));
        inst.connection.send({ type: "models_list", sessionId: inst.sessionId, models });
        // See change: replace-hardcoded-provider-lists.
        inst.connection.send({ type: "providers_list", sessionId: inst.sessionId, providers: buildProviderCatalogue() });
      } catch { /* modelRegistry not available */ }
    }

    // Apply default model only on brand-new sessions (no prior message history)
    // that were NOT launched with an explicit --model flag. Resume (--session) and
    // fork (--fork) both load parent messages, so messageCount > 0 and we keep their
    // existing model. Mirrors pi's own !hasExistingSession gate (sdk.js:106 —
    // `existingSession.messages.length > 0`). NOT the raw getEntries() count: pi's
    // sdk.js auto-appends model_change + thinking_level_change setup entries to a
    // brand-new session BEFORE emitting session_start, so getEntries() is ≥ 2 even
    // for a session with no user history. Only message entries count.
    // The bridge runs inside the pi process, so process.argv is pi's argv — an
    // explicit --model there is the spawner's resolved choice and the default
    // never overrides it. The deferred retry below needs no separate guard: when
    // the gate is false this never sets pendingDefaultModel, so onProviderChanged
    // has nothing to re-apply.
    // See changes: fix-resume-keeps-session-model,
    //              fix-default-model-new-session-entry-count,
    //              fix-default-model-clobbers-explicit-model (issue #595).
    const entryCount = ctx.sessionManager.buildSessionContext?.()?.messages?.length ?? 0;
    const freshConfig = loadConfig();
    if (shouldApplyDefaultModel({
      reason: _event?.reason,
      entryCount,
      hasModelRegistry: Boolean(inst.cachedModelRegistry),
      hasDefaultModel: Boolean(freshConfig.defaultModel),
      hasExplicitModel: hasExplicitModelArg(process.argv),
    })) {
      inst.pendingDefaultModel = inst.applyDefaultModel();
    }

    // Send initial roles
    if (pi.events) {
      const rolesData: any = {};
      pi.events.emit("roles:get-all", rolesData);
      if (rolesData.roles) {
        inst.connection.send({
          type: "roles_list",
          sessionId: inst.sessionId,
          roles: rolesData.roles ?? {},
          presets: rolesData.presets ?? [],
          activePreset: rolesData.activePreset ?? null,
          builtinRoleNames: rolesData.builtinRoleNames ?? [],
        });
      }
    }

    // Discover or auto-start server (non-blocking — connection will reconnect)
    //
    // When a real launchServer() is about to run (not on mDNS/health-check
    // paths), mount an animated TUI widget above the editor using pi-tui's
    // Loader (a real Component, self-animating at 80ms, like pi-flows'
    // architect-widget). The previous implementation used
    // ctx.ui.setStatus(...) which only writes a footer string and relies on
    // the TUI render loop being ticked elsewhere — on the cold-start path
    // nothing else requests renders, so the spinner never animated and often
    // never appeared. setWidget(key, factory, {placement:"aboveEditor"}) gives
    // us a managed component that owns its own render loop and is always
    // visible while the launch is in flight.
    let spinnerTimer: NodeJS.Timeout | null = null;
    let spinnerStart = 0;
    let activeLoader: Loader | null = null;
    const stopSpinner = () => {
      // Release the interval BEFORE the guarded ctx.ui call, so a stale ctx
      // still stops the 1s label refresh instead of leaking it.
      if (spinnerTimer) {
        clearInterval(spinnerTimer);
        spinnerTimer = null;
      }
      activeLoader = null;
      // This runs from `onLaunchEnd` AND from the terminal .then()/.catch()
      // below, either of which can land after a session replacement/reload has
      // invalidated `ctx`. See ui-stale-guard.ts.
      runUiSafely(() => ctx.ui.setWidget("pi-dashboard-launch", undefined));
    };
    // Resolve the ports the auto-start chain uses (health check + launch)
    // with the shared env → config.json → default precedence, so a session
    // whose environment names the dashboard's real ports attaches to (or
    // launches on) THOSE ports instead of a stale config/default — this is
    // the split-brain fix: without it, a harness/container session with
    // DASHBOARD_PORT in its env health-checked 8000, found nothing, and
    // launched a competing dashboard on 8000. `config` is not mutated;
    // `loadConfig()` stays untouched (design D1/D2).
    // See change: fix-bridge-autostart-port-resolution.
    autoStartServer({ ...inst.config, ...resolveDashboardPorts(process.env, inst.config) }, {
      discoverDashboard,
      isDashboardRunning,
      launchServer,
      notify: (msg, level) => runUiSafely(() => ctx.ui.notify(msg, level)),
      onLaunchStart: () => {
        spinnerStart = Date.now();
        const buildMessage = () => {
          const elapsed = Math.floor((Date.now() - spinnerStart) / 1000);
          return `starting dashboard server … (${elapsed}s)`;
        };
        runUiSafely(() =>
          ctx.ui.setWidget(
          "pi-dashboard-launch",
          (tui: unknown, theme: { fg: (role: string, s: string) => string }) => {
            const loader = new Loader(
              tui as ConstructorParameters<typeof Loader>[0],
              (s: string) => theme.fg("accent", s),
              (s: string) => theme.fg("muted", s),
              buildMessage(),
            );
            activeLoader = loader;
            // Loader has stop() but no dispose(); wire dispose so that
            // setExtensionWidget's teardown stops the 80ms animation interval.
            (loader as Loader & { dispose?: () => void }).dispose = () => loader.stop();
            return loader;
          },
          { placement: "aboveEditor" },
          ),
        );
        // Refresh the elapsed-seconds label every second. Frame animation is
        // driven by the Loader's own 80ms interval.
        spinnerTimer = setInterval(() => {
          activeLoader?.setMessage(buildMessage());
        }, 1000);
      },
      onLaunchEnd: () => {
        stopSpinner();
      },
      // Register the spawned dashboard-server PID into `selfSpawnedPgids`
      // synchronously, before the next 5 s process-scan tick. Keeps the
      // dashboard's own `node` infrastructure out of the session-card
      // process list. See change: tighten-process-list-ux.
      onServerSpawned: (childPid: number) => {
        inst.selfSpawnedPgids.add(childPid);
      },
      // Honor the server's `server_restarting` quiesce window. While a
      // deliberate restart/shutdown is in flight, skip the spawn step so we
      // don't race the orchestrator. Discovery + reconnection still run.
      // See change: fix-restart-bridge-auto-start-race.
      shouldSuppressAutoStart: () => inst.connection.shouldSuppressAutoStart(),
    }).then((result) => {
      stopSpinner(); // safety net — covers onLaunchEnd not firing
      if (result.server && result.server.piPort !== inst.config.piPort) {
        const candidateUrl = `ws://${formatHostPort(result.server.host, result.server.piPort)}`;
        // fix-bridge-mdns-migration-hijack: a DISCOVERED candidate only
        // SUGGESTS. Whether the connection follows it is decided — and
        // recorded — by `ConnectionManager.retargetTo`, which refuses to
        // drop an established, registered connection until the candidate has
        // PROVEN reachable (`GET /api/health` → `{ok:true}`, D1), honours
        // localhost preference against a remote candidate (D3), and returns
        // to the last registered endpoint if the candidate dies after
        // adoption (D2). The blanket refusal this replaces also blocked
        // every LEGITIMATE migration (a server that really moved).
        if (inst.endpointPinned) {
          // D3 (add-pi-gateway-transport-identity): a pinned endpoint
          // refuses every re-target. The refusal stays on the record (10.2).
          const decision = decideRetarget({
            current: { endpoint: inst.dashboardUrl, instanceId: inst.registeredInstanceId },
            candidate: { endpoint: candidateUrl },
            pinned: true,
            failed: false,
            identityVerified: false,
          });
          const refusedDetail = `${inst.dashboardUrl} -> ${candidateUrl}: ${decision.reason}`;
          console.log(`[dashboard] re-target ${refusedDetail}`);
          inst.transportDiagnostics.record({ event: "retarget_refused", detail: refusedDetail });
          return;
        }
        const trigger = `mdns discovery (${result.server.host}:${result.server.port}, gateway ${result.server.piPort})`;
        // The health probe runs on the candidate's HTTP port — the record's
        // `port`, not the gateway port — and completes BEFORE the incumbent
        // is dropped (retargetTo owns that ordering).
        const healthUrl = `http://${formatHostPort(result.server.host, result.server.port)}/api/health`;
        inst.connection
          .retargetTo(candidateUrl, {
            trigger,
            verify: () => probeEndpointReachability({ healthUrl }),
          })
          .then((accepted) => {
            console.log(`[dashboard] re-target ${inst.dashboardUrl} -> ${candidateUrl}: ${accepted ? "accepted" : "refused by migration gate"}`);
          })
          .catch((err: unknown) => console.error("[dashboard] re-target decision failed:", err));
      }
    }).catch(() => { stopSpinner(); });

    // Send initial git info + the session's pi version. A session change already
    // ran the first evaluation (and renewed the tracker) in handleSessionChange;
    // doing it again would double the synchronous git work.
    if (!sessionChanged) {
      const gbc = inst.syncBc();
      inst.renewGitTracker().evaluateFirst(gbc, startCwd);
      inst.applyBc(gbc);
    }
    inst.sendCwdMissingIfChanged(startCwd);
    inst.sendPiVersionIfChanged();

    // Start metrics monitor and heartbeat
    startMetricsMonitor();
    inst.heartbeatTimer = setInterval(() => {
      if (!inst.isActive()) return;
      inst.vaultDelivery.tick();
      inst.connection.send({
        type: "session_heartbeat",
        sessionId: inst.sessionId,
        // Liveness truth for the server's status reconcile: `streaming` is
        // otherwise a one-way latch and a single dropped `agent_end` sticks
        // the card on `Thinking…` forever.
        // `=== true` because the flag is optional and is `undefined` before
        // the first turn: sent raw it would serialize away and read as "old
        // bridge, no liveness truth" instead of "idle".
        // See change: fix-stuck-streaming-status-latch.
        agentRunning: inst.shared.isAgentStreaming === true,
        // Fold the bridge→server ring-buffer eviction count into the heartbeat
        // so it reaches `/api/health`. See change:
        // fix-stuck-tool-card-on-dropped-event.
        metrics: {
          ...collectMetrics(),
          droppedBufferedFrames: inst.connection.getDroppedBufferedCount(),
          refusedInboundFrames: inst.connection.getDroppedInboundCount(),
          // Subagent-tick throttle counters ride the same transport, so the
          // throttle's two information-loss modes are observable in production
          // instead of only at L1. See change: reduce-bridge-tick-bandwidth (D6).
          ...inst.subagentTickThrottle.stats,
          // Plugin event-forward registry counters. See change:
          // add-plugin-bridge-contributions.
          pluginForwardDeclared: inst.pluginForwardRegistry.stats.declared,
          pluginForwardRejected:
            inst.pluginForwardRegistry.stats.rejected + inst.pluginForwardRegistry.stats.rejectedDeclarations,
          pluginForwardConflicts: inst.pluginForwardRegistry.stats.conflicts,
          pluginForwardRetained: inst.pluginForwardRegistry.stats.buffer.retained,
          pluginForwardDropped:
            inst.pluginForwardRegistry.stats.buffer.dropped + inst.pluginForwardRegistry.stats.buffer.keyRejected,
          // Subagent fan-out admission counters ride the same transport, so a
          // narrowed fan-out is observable instead of looking like a model that
          // chose not to parallelize. See change:
          // bound-subagent-fanout-under-host-pressure (D7).
          ...inst.fanoutAdmission.counters,
          // Agent path gate counters (in-root decisions are counted, not logged).
          pathGateInRoot: inst.pathGate.counters.inRoot,
          pathGateAsked: inst.pathGate.counters.asked,
          pathGateBlocked: inst.pathGate.counters.blocked,
          pathGateYoloAllowed: inst.pathGate.counters.yoloAllowed,
          // Poll-cost counters (summed across sessions on /api/health).
          // See change: optimize-polling-hot-paths.
          ...pollCost,
        },
      });
    }, HEARTBEAT_INTERVAL);
    inst.shared.timers!.push(inst.heartbeatTimer);

    // Start git + name/model polling
    startGitPollTimer(inst, ctx);

    // Start the adaptive process scanner (detect stalled child processes).
    // One async `ps -A` per scan; fast while the agent/tools run, idle
    // otherwise. session_start re-runs: dispose the previous scheduler first so
    // schedules never stack. See change: optimize-polling-hot-paths.
    inst.ensurePollingDisposable();
    const scheduler = createProcessScanScheduler({
      platform: process.platform,
      setTimer: inst.setRegisteredTimeout,
      clearTimer: inst.clearRegisteredTimeout,
      scan: async () => {
        if (!inst.isActive()) return { changed: false };
        const processes = await scanChildProcessesAsync(
          process.pid,
          inst.trackedPgids,
          PROCESS_MIN_ELAPSED_MS,
          { excludedPgids: inst.selfSpawnedPgids },
        );
        if (!inst.isActive() || inst.polling.processScan !== scheduler) return { changed: false };
        const currentPids = JSON.stringify(processes.map((p) => p.pid).sort());
        if (currentPids === inst.previousProcessPids) return { changed: false };
        inst.previousProcessPids = currentPids;
        inst.connection.send({
          type: "process_list",
          sessionId: inst.sessionId,
          processes: processes.map((p) => ({ pid: p.pid, pgid: p.pgid, command: p.command, elapsedMs: p.elapsedMs })),
        });
        return { changed: true };
      },
    });
    inst.polling.replaceProcessScan(scheduler);
    scheduler.start();

    // Register flow event listeners (pi-flows emits these via pi.events)
    registerFlowEventListeners(inst.syncBc(), () => inst.sessionReady, inst.getFlowsList);

    // Extension UI System (Phase 1): subscribe to invalidate once per
    // session, then run the discovery probe. The probe is synchronous
    // and re-runs on every reconnect (see `onReconnect` callback above).
    // See change: add-extension-ui-modal.
    subscribeUiInvalidate(inst.uiModulesBridgeCtx);
    refreshUiModules(inst.uiModulesBridgeCtx);
  }));
}

/** `turn_end`: stop-after-turn latch, auto-name, usage drain. */
export function registerTurnEnd(inst: BridgeInstance): void {
  const pi = inst.pi;
  pi.on("turn_end", inst.safe(async (event: any, ctx: any) => {
    if (!inst.isActive()) return;
    inst.cachedCtx = ctx;
    if (!inst.sessionReady) return;
    // Drain point: compaction / usage entries recorded during the turn.
    // See change: count-non-message-usage.
    inst.drainUsage(ctx);

    // Send firstMessage update after first turn if not previously sent
    if (!inst.lastFirstMessage) {
      const firstMsg = extractFirstMessage(ctx);
      if (firstMsg) {
        inst.lastFirstMessage = firstMsg;
        inst.connection.send({
          type: "first_message_update",
          sessionId: inst.sessionId,
          firstMessage: firstMsg,
        });
      }
    }

  }));
}

/** `session_shutdown`: disconnect and clean up this incarnation. */
export function registerSessionShutdown(inst: BridgeInstance): void {
  const pi = inst.pi;
  pi.on("session_shutdown", inst.safe(async (event: any, ctx: any) => {
    if (!inst.isActive()) return;
    // Let the reloaded instance (fresh ExtensionAPI) pass the re-entry guard.
    // See change: fix-terminal-session-dashboard-reload (D4).
    releaseBridgeOwnerOnShutdown(inst.shared, event?.reason);
    // Remove this session's pi-dashboard MCP registration (a reloaded
    // instance re-registers on its own mint). See change: migrate-mcp-to-pi-builtin (D1).
    inst.mcpRegistrar.onSessionShutdown();
    inst.shared.isAgentStreaming = false;
    stopMetricsMonitor();
    if (inst.heartbeatTimer) {
      clearInterval(inst.heartbeatTimer);
      inst.heartbeatTimer = null;
    }
    if (inst.gitPollTimer) {
      clearInterval(inst.gitPollTimer);
      inst.gitPollTimer = null;
    }
    drainDisposables(inst.shared);
    // Flush undrained entry usage BEFORE session_unregister (which ends the
    // session server-side), on every shutdown reason: quit, reload and
    // session replacement (new/resume/fork). See change: count-non-message-usage.
    sendShutdownUsageThenUnregister(
      () => inst.drainUsage(ctx),
      () => inst.connection.send({
        type: "session_unregister",
        sessionId: inst.sessionId,
      }),
    );

    // Drop retained subagent frames/snapshots on shutdown.
    // See change: fix-subagent-live-detail-reliability.
    inst.subagentFrameBuffer.reset();
    // See change: reduce-bridge-tick-bandwidth (D3).
    inst.subagentTickThrottle.reset();
    // A shutdown is a session boundary: discard parked text, cancel the window.
    // See change: coalesce-bridge-message-update-snapshots (D8).
    inst.coalescer.clear();

    // Best-effort: remove this session's pasted ask_user attachments.
    // See change: add-ask-user-input-multiline-paste.
    cleanupAttachmentsForSession(inst.sessionId);

    // Give time for the unregister to send
    await new Promise((resolve) => setTimeout(resolve, 100));
    inst.connection.disconnect();
  }));
}
