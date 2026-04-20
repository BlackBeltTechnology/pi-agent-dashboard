/**
 * PI Dashboard Bridge Extension
 *
 * Global extension that connects to the dashboard server,
 * forwards all pi events, and relays commands back.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ConnectionManager } from "./connection.js";
import { detectSessionSource } from "./source-detector.js";
import { mapEventToProtocol } from "./event-forwarder.js";
import { createCommandHandler } from "./command-handler.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, ensureConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { runDevBuild } from "./dev-build.js";
import { isDashboardRunning } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { discoverDashboard } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { launchServer } from "./server-launcher.js";
import { autoStartServer } from "./server-auto-start.js";
import type { ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { expandPromptTemplateFromDisk } from "./prompt-expander.js";

import { PromptBus } from "./prompt-bus.js";
import { DashboardDefaultAdapter } from "./dashboard-default-adapter.js";
import { registerAskUserTool } from "./ask-user-tool.js";
import { activate as activateProviderRegister, onProviderChanged } from "./provider-register.js";
import type { FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { startMetricsMonitor, stopMetricsMonitor, collectMetrics } from "./process-metrics.js";
import { scanChildProcesses } from "./process-scanner.js";
import type { BridgeContext } from "./bridge-context.js";
import { filterHiddenCommands, extractFirstMessage, getCurrentModelString } from "./bridge-context.js";
import { sendStateSync as _sendStateSync, replaySessionEntries as _replaySessionEntries, handleSessionChange as _handleSessionChange } from "./session-sync.js";
import { sendModelUpdateIfChanged as _sendModelUpdateIfChanged, sendSessionNameIfChanged as _sendSessionNameIfChanged, sendGitInfoIfChanged as _sendGitInfoIfChanged } from "./model-tracker.js";
import { registerFlowEventListeners, FLOW_EVENT_MAP, SUBAGENT_EVENT_MAP } from "./flow-event-wiring.js";

const HEARTBEAT_INTERVAL = 15_000;
const GIT_POLL_INTERVAL = 30_000;
const PROCESS_SCAN_INTERVAL = 10_000;



// Use `process` (not `globalThis`) to survive jiti module cache invalidation
// AND to share state across isolated extension contexts (vm sandboxes).
const BRIDGE_KEY = "__pi_dashboard_bridge__";
interface BridgeState {
  cleanup?: () => void;
  sessionId?: string;
  ctx?: any;
  modelRegistry?: any;
  hasUI?: boolean;
  /** Monotonic generation counter — stale listeners bail out when mismatched */
  generation?: number;
  /** The pi instance that owns the bridge (used to detect subagent re-entry) */
  pi?: ExtensionAPI;
  /** All connection instances from any bridge incarnation (for cleanup) */
  connections?: ConnectionManager[];
  /** All interval timers from any bridge incarnation (for cleanup) */
  timers?: ReturnType<typeof setInterval>[];
  /** True when the agent is currently in a turn (between agent_start and agent_end) */
  isAgentStreaming?: boolean;
}
function getBridgeState(): BridgeState {
  if (!(process as any)[BRIDGE_KEY]) {
    (process as any)[BRIDGE_KEY] = {};
  }
  return (process as any)[BRIDGE_KEY];
}

export default function (pi: ExtensionAPI) {
  try {
    // Activate provider management before bridge init so providers are
    // registered before session_start fires and models_list is sent.
    activateProviderRegister(pi);

    // Anthropic-messages payload transforms (system prompt rewrite + tool
    // filter/remap) are handled by the installed @benvargas/pi-claude-code-use
    // package when present. No local duplication here.

    initBridge(pi);
  } catch (err) {
    // Never crash the host pi agent — dashboard is non-essential
    console.error("[dashboard] Bridge init failed:", err);
  }
}





function initBridge(pi: ExtensionAPI) {
  const prev = getBridgeState();

  // If bridge is already active for a different pi instance (e.g. a subagent
  // loading extensions in the same process), skip initialization to avoid
  // invalidating the parent session's bridge connection and event forwarding.
  if (prev.generation && prev.generation > 0 && prev.pi && prev.pi !== pi) {
    return;
  }

  prev.cleanup?.();
  prev.cleanup = undefined;

  // Disconnect ALL orphaned connections from previous bridge incarnations
  if (prev.connections) {
    for (const conn of prev.connections) {
      conn.disconnect();
    }
  }
  prev.connections = [];
  // Clear ALL orphaned timers
  if (prev.timers) {
    for (const t of prev.timers) {
      clearInterval(t);
    }
  }
  prev.timers = [];

  // Bump generation so stale listeners from previous initBridge calls bail out
  const generation = (prev.generation ?? 0) + 1;
  prev.generation = generation;
  prev.pi = pi;
  /** Return true if this bridge instance is still the active one */
  function isActive(): boolean {
    return getBridgeState().generation === generation;
  }

  let sessionId: string = prev.sessionId ?? crypto.randomUUID();
  let sessionReady = false; // true after session_start has run
  let lastSessionFile: string | undefined;
  let lastSessionDir: string | undefined;
  let lastFirstMessage: string | undefined;
  let pendingDefaultModel: string | null = null; // non-null if default model not yet applied (custom provider not ready)

  /** Try to apply the default model from config. Returns the model string if not found (pending), null if applied or no default. */
  function applyDefaultModel(): string | null {
    const freshConfig = loadConfig();
    if (!freshConfig.defaultModel || !cachedModelRegistry) return null;
    const slashIdx = freshConfig.defaultModel.indexOf("/");
    if (slashIdx <= 0) return null;
    const provider = freshConfig.defaultModel.slice(0, slashIdx);
    const modelId = freshConfig.defaultModel.slice(slashIdx + 1);
    try {
      const found = cachedModelRegistry.find(provider, modelId);
      if (found) {
        (pi as any).setModel(found).then(() => {
          setTimeout(() => sendModelUpdateIfChanged(), 50);
        }).catch(() => {});
        return null; // applied
      }
    } catch { /* ignore */ }
    return freshConfig.defaultModel; // not found yet — pending
  }

  /** Query pi-flows for available flows via synchronous event RPC */
  function getFlowsList(): FlowInfo[] {
    const probe: any = {};
    try {
      pi.events?.emit("flow:list-flows", probe);
    } catch { /* ignore */ }
    return (probe.flows as FlowInfo[] | undefined) ?? [];
  }

  /** Send flows_list message to the dashboard server */
  function sendFlowsList() {
    const flows = getFlowsList();
    console.error(`[dashboard] sendFlowsList: ${flows.length} flows, sessionId=${sessionId.slice(0,8)}`);
    connection.send({ type: "flows_list", sessionId, flows });
  }


  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let gitPollTimer: ReturnType<typeof setInterval> | null = null;
  let processScanTimer: ReturnType<typeof setInterval> | null = null;
  let previousProcessPids: string = ""; // JSON-stringified PID set for diff
  const trackedPgids = new Set<number>(); // PGIDs captured during bash tool calls
  let lastGitBranch: string | undefined;
  let lastGitPrNumber: number | undefined;
  let lastSessionName: string | undefined;
  let cachedHasUI: boolean | undefined = prev.hasUI;
  let cachedModelRegistry: any | undefined = prev.modelRegistry;
  let cachedCtx: any | undefined = prev.ctx;
  let lastModel: string | undefined;
  let lastThinkingLevel: string | undefined;
  let promptBus: PromptBus | undefined;

  /** Wrap a callback so errors log instead of crashing the host pi agent. */
  function safe<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
      try {
        const result = fn(...args);
        if (result && typeof result.catch === "function") {
          return result.catch((err: unknown) => {
            console.error("[dashboard]", err);
          });
        }
        return result;
      } catch (err) {
        console.error("[dashboard]", err);
      }
    }) as T;
  }

  // Load config to determine WebSocket URL
  ensureConfig();
  const config = loadConfig();
  const dashboardUrl = process.env.PI_DASHBOARD_URL ?? `ws://localhost:${config.piPort}`;

  const connection = new ConnectionManager({
    url: dashboardUrl,
    onMessage: safe(async (data: unknown) => {
      if (!isActive()) return; // Stale listener guard
      const msg = data as ServerToExtensionMessage;
      // Legacy extension_ui_response removed — now handled by prompt_response → promptBus.respond()
      // Reload auth credentials when dashboard notifies of changes
      if (msg.type === "credentials_updated") {
        try {
          cachedModelRegistry?.authStorage?.reload?.();
          cachedModelRegistry?.refresh?.();
        } catch (err) { console.error("[dashboard] credentials reload failed:", err); }
        // Push updated models list to dashboard client
        if (cachedModelRegistry && sessionReady) {
          try {
            const models = cachedModelRegistry.getAvailable().map((m: any) => ({
              provider: m.provider,
              id: m.id,
            }));
            connection.send({ type: "models_list", sessionId, models });
          } catch (err) { console.error("[dashboard] models_list push failed:", err); }
        }
        return;
      }
      // Route flow management actions from dashboard buttons
      if (msg.type === "flow_management" && pi.events) {
        if (msg.action === "run") {
          pi.events.emit("flow:run", { flowName: msg.flowName, task: msg.task || undefined });
        } else if (msg.action === "new") {
          pi.events.emit("flows:new-request", { description: msg.description || "" });
        } else if (msg.action === "edit") {
          const editFlows = getFlowsList() as Array<{ name: string; source?: string }>;
          const editMatch = editFlows.find(f => f.name === msg.flowName);
          const resolvedPath = editMatch?.source || "";
          if (!resolvedPath) {
            console.error(`[dashboard] flow_management edit: could not resolve path for "${msg.flowName}" (${editFlows.length} flows)`);
          }
          pi.events.emit("flows:edit-request", { flowName: msg.flowName || "", flowPath: resolvedPath, modificationRequest: msg.description || "" });
        } else if (msg.action === "delete") {
          // Dashboard already confirmed upfront — delete directly
          pi.events.emit("flow:delete-request", { flowName: msg.flowName });
          pi.events.emit("flow:notify", { message: `Flow "${msg.flowName}" deleted.`, level: "info" });
        }
        return;
      }
      // Route role management from dashboard
      if (msg.type === "role_set" && pi.events) {
        const data: any = { role: (msg as any).role, modelId: (msg as any).modelId };
        pi.events.emit("flow:role-set", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("flow:role-get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
          });
        }
        return;
      }
      if (msg.type === "role_preset_load" && pi.events) {
        const data: any = { name: (msg as any).presetName };
        pi.events.emit("flow:role-preset-load", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("flow:role-get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
          });
        }
        return;
      }
      if (msg.type === "role_preset_save" && pi.events) {
        const data: any = { name: (msg as any).presetName };
        pi.events.emit("flow:role-preset-save", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("flow:role-get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
          });
        }
        return;
      }
      if (msg.type === "role_preset_delete" && pi.events) {
        const data: any = { name: (msg as any).presetName };
        pi.events.emit("flow:role-preset-delete", data);
        if (data.success) {
          const rolesData: any = {};
          pi.events.emit("flow:role-get-all", rolesData);
          connection.send({
            type: "roles_list",
            sessionId,
            roles: rolesData.roles ?? {},
            presets: rolesData.presets ?? [],
            activePreset: rolesData.activePreset ?? null,
          });
        }
        return;
      }
      if (msg.type === "request_roles" && pi.events) {
        const rolesData: any = {};
        pi.events.emit("flow:role-get-all", rolesData);
        connection.send({
          type: "roles_list",
          sessionId,
          roles: rolesData.roles ?? {},
          presets: rolesData.presets ?? [],
          activePreset: rolesData.activePreset ?? null,
        });
        return;
      }
      // Route PromptBus responses from dashboard client
      if (msg.type === "prompt_response" && promptBus) {
        promptBus.respond({
          id: (msg as any).promptId,
          answer: (msg as any).answer,
          cancelled: (msg as any).cancelled,
          source: (msg as any).source ?? "dashboard-default",
        });
        return;
      }
      // Legacy architect_prompt_response routing REMOVED.
      // Previously routed to flow:prompt-response + cancelAllPending().
      // Now handled by PromptBus: dashboard sends prompt_response,
      // bus calls respond(), adapters get onResponse() for cross-cancellation.
      // Route flow control messages to pi-flows via pi.events
      if (msg.type === "flow_control" && pi.events) {
        if (msg.action === "abort") {
          pi.events.emit("flow:abort", {});
          // Also abort architect if running (mutually exclusive with flow execution;
          // the irrelevant emit is a no-op due to guard checks on both listeners)
          pi.events.emit("flow:architect-abort", {});
        } else if (msg.action === "toggle_autonomous") {
          pi.events.emit("flow:toggle-autonomous", {});
        } else if (msg.action === "dismiss_summary") {
          pi.events.emit("flow:summary-dismissed", {});
        }
        return;
      }
      const response = await commandHandler.handle(msg);
      if (response) connection.send(response);
      // Immediately send model/thinking update after handling set_thinking_level
      if (msg.type === "set_thinking_level") {
        // Small delay to let pi process the level change
        setTimeout(() => sendModelUpdateIfChanged(), 50);
      }
    }),
    onReconnect: safe(() => {
      if (!isActive()) return; // Stale listener guard
      sendStateSync();
      replaySessionEntries();
      // Re-send pending PromptBus requests so dashboard dialogs survive browser refresh.
      // Synchronous within this tick to prevent TUI respond() from interleaving.
      // Client-side dedup by requestId prevents double-rendering.
      if (promptBus) {
        for (const { request, component, placement } of promptBus.getPendingRequests()) {
          connection.send({
            type: "prompt_request" as any,
            sessionId,
            promptId: request.id,
            prompt: {
              type: request.type,
              question: request.question,
              options: request.options,
              defaultValue: request.defaultValue,
              pipeline: request.pipeline,
              metadata: request.metadata,
            },
            component,
            placement,
          });
        }
      }
      connection.send({ type: "replay_complete", sessionId });
      // If agent is mid-turn, send synthetic agent_start so server sets status to "streaming"
      if (getBridgeState().isAgentStreaming) {
        connection.send(mapEventToProtocol(sessionId, { type: "agent_start" }));
      }
    }),
  });

  // Track connection so future bridge incarnations can disconnect it
  getBridgeState().connections!.push(connection);

  const commandHandler = createCommandHandler(pi, () => sessionId, {
    getModelRegistry: () => cachedModelRegistry,
    setThinkingLevel: (level: string) => (pi as any).setThinkingLevel?.(level),
    getThinkingLevel: () => (pi as any).getThinkingLevel?.(),
    setModel: async (provider: string, modelId: string) => {
      const registry = cachedModelRegistry;
      if (!registry) return;
      const model = registry.find(provider, modelId);
      if (!model) return;
      try {
        await (pi as any).setModel(model);
      } catch {
        return;
      }
      // model_select event updates cachedCtx; small delay lets it propagate
      setTimeout(() => sendModelUpdateIfChanged(), 50);
    },
    shutdown: () => {
      if (cachedCtx?.shutdown) {
        cachedCtx.shutdown();
      }
      // Safety net: force exit after a short delay in case ctx.shutdown()
      // doesn't terminate (e.g. in RPC mode headless sessions)
      setTimeout(() => process.exit(0), 500);
    },
    abort: () => {
      if (cachedCtx?.abort) {
        cachedCtx.abort();
      }
    },
    eventSink: (msg) => connection.send(msg),
    compact: (opts) => {
      if (cachedCtx?.compact) {
        cachedCtx.compact(opts);
      }
    },
    reload: () => {
      const reloadFn = (globalThis as any)[RELOAD_KEY] as (() => Promise<void>) | undefined;
      if (reloadFn) {
        reloadFn().catch((err: any) => {
          console.error("[dashboard] reload failed:", err);
        });
      } else {
        console.error("[dashboard] reload not available — type /__dashboard_reload in pi TUI once to bootstrap");
      }
    },
    spawnNew: () => {
      connection.send({ type: "spawn_new_session", sessionId, cwd: process.cwd() });
    },
    sessionPrompt: (text) => {
      // Route slash commands: management events, flow:run, then fallback
      if (text.startsWith("/") && pi.events) {
        const cmdText = text.slice(1);
        const spaceIdx = cmdText.indexOf(" ");
        const cmdName = spaceIdx === -1 ? cmdText : cmdText.slice(0, spaceIdx);
        const cmdArgs = spaceIdx === -1 ? "" : cmdText.slice(spaceIdx + 1);

        // Flow management commands from buttons use flow_management message type.
        // Typed /flows:new, /flows:edit, /flows:delete in chat input fall through
        // to the slash command handler below, which invokes pi's command system
        // via pi.sendUserMessage (with ui-proxy handling ctx.ui calls).

        // Check if it's a user-defined flow via flow:list-flows
        const flowsList = getFlowsList();
        if (flowsList.some(f => f.name === cmdName)) {
          pi.events.emit("flow:run", { flowName: cmdName, task: cmdArgs.trim() || undefined });
          return;
        }
      }
      // Fallback: send as user message (template-expanded).
      // Uses deliverAs:followUp so it queues properly when agent is streaming.
      // expandPromptTemplateFromDisk handles skill commands (/skill:xxx) and
      // prompt templates by reading the file content from disk.
      const expanded = expandPromptTemplateFromDisk(text, process.cwd(), pi);
      (pi.sendUserMessage as any)(expanded, { deliverAs: "followUp" });
    },
  });

  // Reload support: extension events only provide ExtensionContext (no reload).
  // ExtensionCommandContext (with reload()) is only available in command handlers.
  // We register __dashboard_reload command; invoking /__dashboard_reload from pi TUI
  // captures ctx.reload(). After first capture, dashboard-triggered reloads work.
  // The captured fn is stored in globalThis to survive module reloads.
  const RELOAD_KEY = "__pi_dashboard_reload_fn__";

  pi.registerCommand("__dashboard_reload", {
    handler: async (_args: string, ctx: any) => {
      if (ctx?.reload) {
        (globalThis as any)[RELOAD_KEY] = () => ctx.reload();
        await ctx.reload();
      }
    },
  });

  /** Sync local variables into BridgeContext for extracted module calls */
  function syncBc(): BridgeContext {
    return {
      pi, connection, sessionId,
      cachedCtx, cachedModelRegistry, cachedHasUI,
      lastModel, lastThinkingLevel,
      lastSessionFile, lastSessionDir, lastFirstMessage,
      lastGitBranch, lastGitPrNumber, lastSessionName,
    };
  }
  /** Sync BridgeContext mutations back to local variables */
  function applyBc(bc: BridgeContext): void {
    sessionId = bc.sessionId;
    cachedCtx = bc.cachedCtx;
    cachedModelRegistry = bc.cachedModelRegistry;
    cachedHasUI = bc.cachedHasUI;
    lastModel = bc.lastModel;
    lastThinkingLevel = bc.lastThinkingLevel;
    lastSessionFile = bc.lastSessionFile;
    lastSessionDir = bc.lastSessionDir;
    lastFirstMessage = bc.lastFirstMessage;
    lastGitBranch = bc.lastGitBranch;
    lastGitPrNumber = bc.lastGitPrNumber;
    lastSessionName = bc.lastSessionName;
  }

  // Local wrappers that sync bc around extracted module calls
  function sendStateSync() { const bc = syncBc(); _sendStateSync(bc, getFlowsList); applyBc(bc); }
  function replaySessionEntries() { _replaySessionEntries(syncBc()); }
  function sendModelUpdateIfChanged() { const bc = syncBc(); _sendModelUpdateIfChanged(bc); applyBc(bc); }
  function sendSessionNameIfChanged() { const bc = syncBc(); _sendSessionNameIfChanged(bc); applyBc(bc); }
  function sendGitInfoIfChanged(cwd: string) { const bc = syncBc(); _sendGitInfoIfChanged(bc, cwd); applyBc(bc); }

  // Forward all pi core events to the dashboard.
  // Events with special enrichment logic:
  const enrichedEventTypes = [
    "agent_start",
    "agent_end",
    "turn_start",
    "turn_end",
    "message_start",
    "message_update",
    "message_end",
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "session_compact",
    "model_select",
  ] as const;
  // Pass-through events: forwarded as-is with no special handling.
  // Unrecognized types render as expandable JSON cards in the dashboard.
  const passThroughEventTypes = [
    "tool_call",
    "tool_result",
    "user_bash",
    "input",
    "before_agent_start",
    "resources_discover",
    "session_before_switch",
    "session_before_fork",
    "session_before_compact",
    "session_before_tree",
    "session_tree",
  ] as const;
  // Excluded from subscription (not forwarded):
  // - `context`: carries full message arrays (very large)
  // - `before_provider_request`: carries raw API payloads (very large)
  // - `session_start`: dedicated handler → session_register protocol message
  // - session change (new/fork/resume): handled inside session_start via event.reason
  // - `session_shutdown`: dedicated handler → disconnect/cleanup

  // Unified EventBus rename map for the emit intercept (flow + subagent events)
  const EVENT_BUS_MAP: Record<string, string> = { ...FLOW_EVENT_MAP, ...SUBAGENT_EVENT_MAP };

  for (const eventType of enrichedEventTypes) {
    pi.on(eventType as any, safe(async (event: any, ctx: any) => {
      // Bail out if a newer bridge instance has taken over
      if (!isActive()) return;
      // Always keep latest context for abort/shutdown
      cachedCtx = ctx;
      // Don't send events before session_start has established the correct session ID
      if (!sessionReady) return;
      // Track agent streaming state (survives reconnect/reload)
      if (eventType === "agent_start") getBridgeState().isAgentStreaming = true;
      if (eventType === "agent_end") getBridgeState().isAgentStreaming = false;
      // For model_select, enrich the event data with thinkingLevel
      if (eventType === "model_select") {
        const enriched = { ...event, thinkingLevel: (pi as any).getThinkingLevel?.() };
        const msg = mapEventToProtocol(sessionId, enriched);
        connection.send(msg);
        return;
      }

      // For turn_end, enrich with contextUsage (pi-only API) so server can extract stats
      if (eventType === "turn_end") {
        const contextUsage = ctx.getContextUsage?.();
        if (contextUsage) {
          const enriched = { ...event, contextUsage };
          const msg = mapEventToProtocol(sessionId, enriched);
          connection.send(msg);
          return;
        }
      }

      // For message_start, enrich with entryId immediately (current leaf)
      if (eventType === "message_start") {
        const entryId = ctx.sessionManager?.getLeafId?.();
        if (entryId) {
          const enriched = { ...event, entryId };
          const msg = mapEventToProtocol(sessionId, enriched);
          connection.send(msg);
          return;
        }
      }

      // For message_end, defer getLeafId() so it runs after pi core persists the entry.
      // Pi core calls _emit (which invokes this handler) BEFORE appendMessage (which updates leafId).
      // Since _emit doesn't await async handlers, yielding via queueMicrotask lets appendMessage
      // run first, so getLeafId() returns the correct entry ID for the just-persisted message.
      if (eventType === "message_end") {
        await new Promise<void>(resolve => queueMicrotask(resolve));
        const entryId = ctx.sessionManager?.getLeafId?.();
        if (entryId) {
          const enriched = { ...event, entryId };
          const msg = mapEventToProtocol(sessionId, enriched);
          connection.send(msg);
          return;
        }
      }

      const msg = mapEventToProtocol(sessionId, event);
      connection.send(msg);
    }));
  }

  // Pass-through events: forward with no enrichment
  for (const eventType of passThroughEventTypes) {
    pi.on(eventType as any, safe(async (event: any, ctx: any) => {
      if (!isActive()) return;
      cachedCtx = ctx;
      if (!sessionReady) return;
      const msg = mapEventToProtocol(sessionId, event);
      connection.send(msg);
    }));
  }

  // EventBus catch-all: intercept pi.events.emit to forward all EventBus
  // traffic (flow events, subagent events, custom extension events).
  // Known channels get renamed via EVENT_BUS_MAP; unknown channels use the
  // channel name directly as the eventType.
  let origEventsEmit: ((channel: string, data: unknown) => void) | undefined;
  if (pi.events) {
    origEventsEmit = pi.events.emit.bind(pi.events);
    pi.events.emit = (channel: string, data: unknown) => {
      if (sessionReady && isActive()) {
        try {
          const eventType = EVENT_BUS_MAP[channel] ?? channel;
          const eventData = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
          connection.send({
            type: "event_forward",
            sessionId,
            event: { eventType, timestamp: Date.now(), data: eventData },
          });
        } catch { /* forwarding failure must never break the original emit */ }
      }
      origEventsEmit!(channel, data);
    };
  }

  pi.on("session_start", safe(async (_event: any, ctx: any) => {

    // Bail out if a newer bridge instance has taken over
    if (!isActive()) return;
    const newSessionId = ctx.sessionManager.getSessionId();

    // On session switch/fork (0.65.0+: event.reason replaces session_switch/session_fork events),
    // unregister the old session before re-registering the new one.
    const reason = _event?.reason;
    if ((reason === "new" || reason === "fork" || reason === "resume") && sessionId && sessionId !== newSessionId) {
      handleSessionChange(ctx);
    }

    cachedHasUI = ctx.hasUI;
    cachedCtx = ctx;
    sessionId = newSessionId;

    // Register ask_user at runtime (not at load time) to avoid static
    // tool-name conflicts with other extensions like pi-flows.
    registerAskUserTool(pi);

    // Extract session file/dir early — needed for source detection and UI proxy
    const sessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;
    const sessionDir = ctx.sessionManager.getSessionDir?.() ?? undefined;
    lastSessionFile = sessionFile;
    lastSessionDir = sessionDir;

    // ── PromptBus setup ──
    // Create bus with dashboard connection wiring.
    // Replaces the old ui-proxy race pattern.
    promptBus = new PromptBus({
      onDashboardRequest: (prompt, component, placement) => {
        connection.send({
          type: "prompt_request" as any,
          sessionId,
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
        connection.send({ type: "prompt_dismiss" as any, sessionId, promptId: id });
      },
      onDashboardCancel: (id) => {
        connection.send({ type: "prompt_cancel" as any, sessionId, promptId: id });
      },
    });

    // Register built-in default adapter (always present, works without pi-flows)
    promptBus.registerAdapter(new DashboardDefaultAdapter());

    // Capture original ctx.ui method references BEFORE patching
    const originalNotify = ctx.ui.notify?.bind(ctx.ui);
    const originals = {
      select: ctx.ui.select?.bind(ctx.ui) as ((q: string, opts: string[], extra?: any) => Promise<string | undefined>) | undefined,
      input: ctx.ui.input?.bind(ctx.ui) as ((q: string, placeholder?: string, extra?: any) => Promise<string | undefined>) | undefined,
      confirm: ctx.ui.confirm?.bind(ctx.ui) as ((q: string, msg: string, extra?: any) => Promise<boolean>) | undefined,
      editor: ctx.ui.editor?.bind(ctx.ui) as ((q: string, prefill?: string, extra?: any) => Promise<string | undefined>) | undefined,
    };

    // Register TUI adapter — presents prompts in the terminal using original
    // (unpatched) ctx.ui methods. Must be registered BEFORE patching ctx.ui.
    if (ctx.hasUI) {
      const activeControllers = new Map<string, AbortController>();
      const bus = promptBus;

      bus.registerAdapter({
        name: "tui",

        onRequest(prompt: any) {
          const ac = new AbortController();
          activeControllers.set(prompt.id, ac);

          const present = async () => {
            try {
              let answer: string | boolean | undefined;

              if (prompt.type === "select" && prompt.options && originals.select) {
                answer = await originals.select(prompt.question, prompt.options, { signal: ac.signal });
              } else if (prompt.type === "input" && originals.input) {
                answer = await originals.input(prompt.question, prompt.defaultValue || "", { signal: ac.signal });
              } else if (prompt.type === "confirm" && originals.confirm) {
                answer = await originals.confirm(prompt.question, "", { signal: ac.signal });
              } else if (prompt.type === "editor" && originals.editor) {
                answer = await originals.editor(prompt.question, prompt.defaultValue || "", { signal: ac.signal });
              } else {
                return;
              }

              if (!ac.signal.aborted) {
                const answerStr = typeof answer === "boolean" ? (answer ? "true" : "false") : answer;
                bus.respond({
                  id: prompt.id,
                  answer: answerStr ?? undefined,
                  cancelled: answerStr == null,
                  source: "tui",
                });
              }
            } catch {
              if (!ac.signal.aborted) {
                bus.respond({ id: prompt.id, cancelled: true, source: "tui" });
              }
            } finally {
              activeControllers.delete(prompt.id);
            }
          };

          present();
          return {}; // Claim without component (TUI-only)
        },

        onResponse(response: any) {
          if (response.source !== "tui") {
            const ac = activeControllers.get(response.id);
            if (ac) {
              ac.abort();
              activeControllers.delete(response.id);
            }
          }
        },

        onCancel(id: string) {
          const ac = activeControllers.get(id);
          if (ac) {
            ac.abort();
            activeControllers.delete(id);
          }
        },
      });
    }

    // Replace ctx.ui dialog methods with PromptBus wrappers.
    // All extension commands that call ctx.ui.select/input/confirm/editor
    // now route through the bus, which distributes to all registered adapters.
    {
      const bus = promptBus;
      (ctx.ui as any).select = (title: string, options: string[], opts?: any) =>
        bus.request({ pipeline: "command", type: "select", question: title, options, metadata: opts?.message ? { message: opts.message } : undefined })
          .then(r => r.cancelled ? undefined : r.answer);

      (ctx.ui as any).input = (title: string, placeholder?: string, opts?: any) =>
        bus.request({ pipeline: "command", type: "input", question: title, defaultValue: placeholder, metadata: opts?.message ? { message: opts.message } : undefined })
          .then(r => r.cancelled ? undefined : r.answer);

      (ctx.ui as any).confirm = (title: string, message?: string, opts?: any) =>
        bus.request({ pipeline: "command", type: "confirm", question: title, metadata: (message || opts?.message) ? { message: message || opts?.message } : undefined })
          .then(r => !r.cancelled && r.answer === "true");

      (ctx.ui as any).editor = (title: string, prefill?: string, opts?: any) =>
        bus.request({ pipeline: "command", type: "editor", question: title, defaultValue: prefill, metadata: opts?.message ? { message: opts.message } : undefined })
          .then(r => r.cancelled ? undefined : r.answer);

      // Notify is fire-and-forget: call original + forward to dashboard
      (ctx.ui as any).notify = (message: string, level?: string) => {
        originalNotify?.(message, level);
        connection.send({
          type: "prompt_request" as any,
          sessionId,
          promptId: crypto.randomUUID(),
          prompt: { question: message, type: "notify" },
          component: { type: "notify", props: { message, level } },
          placement: "inline",
        });
      };
    }

    // Listen for adapter registrations from other extensions (e.g. pi-flows)
    if (pi.events) {
      pi.events.on("prompt:register-adapter", (adapter: any) => {
        if (promptBus && adapter && typeof adapter.name === "string") {
          promptBus.registerAdapter(adapter);
          // Inject respond/cancel functions so cross-package adapters can talk back
          if (typeof adapter.setRespond === "function") {
            adapter.setRespond((response: any) => promptBus!.respond(response));
          }
          if (typeof adapter.setCancel === "function") {
            adapter.setCancel((id: string) => promptBus!.cancel(id));
          }
        }
      });

      // Expose bus request function for pi-flows to use via emitPromptAndAwait
      pi.events.emit("prompt:set-bus-request", {
        request: (options: any) => promptBus!.request(options),
      });
    }

    // Connect first, then auto-start if needed.
    // session_register must be buffered before any event_forward messages.
    connection.connect();

    // Extract first message (sessionFile/sessionDir already extracted above)
    const firstMessage = extractFirstMessage(ctx);
    lastFirstMessage = firstMessage;

    // Register session with initial model/thinkingLevel
    lastSessionName = pi.getSessionName() ?? "";
    const initialModel = getCurrentModelString(syncBc());
    const initialThinkingLevel = (pi as any).getThinkingLevel?.() ?? undefined;
    lastModel = initialModel;
    lastThinkingLevel = initialThinkingLevel;

    // Include eventCount so server can skip event wipe on reconnect
    let eventCount: number | undefined;
    try {
      const entries = ctx.sessionManager?.getBranch?.();
      if (entries) eventCount = entries.length;
    } catch { /* ignore */ }

    connection.send({
      type: "session_register",
      sessionId,
      cwd: ctx.cwd,
      name: lastSessionName || undefined,
      source: detectSessionSource(cachedHasUI, sessionFile),
      model: initialModel,
      thinkingLevel: initialThinkingLevel,
      sessionFile,
      sessionDir,
      firstMessage,
      eventCount,
    });

    // Allow event forwarding now that session_register is buffered
    sessionReady = true;

    // Replay full session history so the dashboard has all messages
    replaySessionEntries();
    connection.send({ type: "replay_complete", sessionId });
    // If agent is mid-turn (e.g. reload during streaming), send synthetic agent_start
    if (getBridgeState().isAgentStreaming) {
      connection.send(mapEventToProtocol(sessionId, { type: "agent_start" }));
    }

    // Send initial commands list
    const commands = filterHiddenCommands(pi.getCommands());
    connection.send({
      type: "commands_list",
      sessionId,
      commands,
    });

    // Send initial flows list
    sendFlowsList();

    // Send available models
    cachedModelRegistry = (ctx as any).modelRegistry;
    if (cachedModelRegistry) {
      try {
        const models = cachedModelRegistry.getAvailable().map((m: any) => ({
          provider: m.provider,
          id: m.id,
        }));
        connection.send({ type: "models_list", sessionId, models });
      } catch { /* modelRegistry not available */ }
    }

    // Apply default model on new sessions only (not reload/resume/fork)
    if (_event?.reason === "startup" && cachedModelRegistry) {
      pendingDefaultModel = applyDefaultModel();
    }

    // Send initial roles
    if (pi.events) {
      const rolesData: any = {};
      pi.events.emit("flow:role-get-all", rolesData);
      if (rolesData.roles) {
        connection.send({
          type: "roles_list",
          sessionId,
          roles: rolesData.roles ?? {},
          presets: rolesData.presets ?? [],
          activePreset: rolesData.activePreset ?? null,
        });
      }
    }

    // Discover or auto-start server (non-blocking — connection will reconnect)
    //
    // When a real launchServer() is about to run (not on mDNS/health-check
    // paths), show an animated TUI status bar with a Braille spinner +
    // elapsed time. The spinner ticks every 250ms and auto-clears when
    // the launch resolves (success or failure). Keeps the user informed
    // during cold-start waits that can run 15–30s on Windows.
    const SPINNER_FRAMES = ["⠇", "⠋", "⠙", "⠸", "⢰", "⣠", "⣄", "⡆"];
    let spinnerTimer: NodeJS.Timeout | null = null;
    let spinnerStart = 0;
    const stopSpinner = () => {
      if (spinnerTimer) {
        clearInterval(spinnerTimer);
        spinnerTimer = null;
      }
      ctx.ui.setStatus("pi-dashboard-launch", undefined);
    };
    autoStartServer(config, {
      discoverDashboard,
      isDashboardRunning,
      launchServer,
      notify: (msg, level) => ctx.ui.notify(msg, level),
      onLaunchStart: () => {
        spinnerStart = Date.now();
        let frame = 0;
        const tick = () => {
          const elapsed = Math.floor((Date.now() - spinnerStart) / 1000);
          ctx.ui.setStatus(
            "pi-dashboard-launch",
            `${SPINNER_FRAMES[frame]} starting dashboard server … (${elapsed}s)`,
          );
          frame = (frame + 1) % SPINNER_FRAMES.length;
        };
        tick(); // immediate, before first interval fires
        spinnerTimer = setInterval(tick, 250);
      },
      onLaunchEnd: () => {
        stopSpinner();
      },
    }).then((result) => {
      stopSpinner(); // safety net — covers onLaunchEnd not firing
      if (result.server && result.server.piPort !== config.piPort) {
        // Server found on a different piPort than configured — update connection URL
        connection.updateUrl(`ws://${result.server.host === 'localhost' ? 'localhost' : result.server.host}:${result.server.piPort}`);
      }
    }).catch(() => { stopSpinner(); });

    // Send initial git info
    sendGitInfoIfChanged(ctx.cwd);

    // Start metrics monitor and heartbeat
    startMetricsMonitor();
    heartbeatTimer = setInterval(() => {
      if (!isActive()) return;
      connection.send({
        type: "session_heartbeat",
        sessionId,
        metrics: collectMetrics(),
      });
    }, HEARTBEAT_INTERVAL);
    getBridgeState().timers!.push(heartbeatTimer);

    // Start git info + name/model polling
    gitPollTimer = setInterval(() => {
      if (!isActive()) return;
      sendGitInfoIfChanged(ctx.cwd);
      sendSessionNameIfChanged();
      sendModelUpdateIfChanged();
    }, GIT_POLL_INTERVAL);
    getBridgeState().timers!.push(gitPollTimer);

    // Start process scanner (detect stalled child processes)
    // Captures new child PGIDs during active bash calls, then checks tracked PGIDs
    processScanTimer = setInterval(() => {
      if (!isActive()) return;
      const processes = scanChildProcesses(process.pid, trackedPgids);
      const currentPids = JSON.stringify(processes.map((p) => p.pid).sort());
      if (currentPids !== previousProcessPids) {
        previousProcessPids = currentPids;
        connection.send({
          type: "process_list",
          sessionId,
          processes: processes.map((p) => ({ pid: p.pid, pgid: p.pgid, command: p.command, elapsedMs: p.elapsedMs })),
        });
      }
    }, PROCESS_SCAN_INTERVAL);
    getBridgeState().timers!.push(processScanTimer);

    // Register flow event listeners (pi-flows emits these via pi.events)
    registerFlowEventListeners(syncBc(), () => sessionReady, getFlowsList);
  }));

  // Shared handler for session changes (new/fork/resume)
  function handleSessionChange(ctx: any) {
    const bc = syncBc();
    _handleSessionChange(bc, ctx, getFlowsList);
    applyBc(bc);

    // Restart polling timers
    if (gitPollTimer) clearInterval(gitPollTimer);
    gitPollTimer = setInterval(() => {
      sendGitInfoIfChanged(ctx.cwd);
    }, GIT_POLL_INTERVAL);
  }

  // session_switch and session_fork events removed in pi 0.65.0.
  // Now handled via session_start with event.reason ("new"|"fork"|"resume").

  pi.on("turn_end", safe(async (event: any, ctx: any) => {
    if (!isActive()) return;
    cachedCtx = ctx;
    if (!sessionReady) return;

    // Send firstMessage update after first turn if not previously sent
    if (!lastFirstMessage) {
      const firstMsg = extractFirstMessage(ctx);
      if (firstMsg) {
        lastFirstMessage = firstMsg;
        connection.send({
          type: "first_message_update",
          sessionId,
          firstMessage: firstMsg,
        });
      }
    }

  }));

  pi.on("session_shutdown", safe(async () => {
    if (!isActive()) return;
    getBridgeState().isAgentStreaming = false;
    stopMetricsMonitor();
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (gitPollTimer) {
      clearInterval(gitPollTimer);
      gitPollTimer = null;
    }
    connection.send({
      type: "session_unregister",
      sessionId,
    });

    // Give time for the unregister to send
    await new Promise((resolve) => setTimeout(resolve, 100));
    connection.disconnect();
  }));

  // Re-send models list when custom providers finish async discovery
  onProviderChanged(() => {
    if (!isActive()) return;
    if (cachedModelRegistry && sessionReady) {
      try {
        const models = cachedModelRegistry.getAvailable().map((m: any) => ({
          provider: m.provider,
          id: m.id,
        }));
        connection.send({ type: "models_list", sessionId, models });
      } catch { /* ignore */ }

      // Retry pending default model — custom provider may now have its models
      if (pendingDefaultModel) {
        pendingDefaultModel = applyDefaultModel();
      }
    }
  });

  // Register cleanup for /reload — saves state to globalThis and tears down resources
  const state = getBridgeState();
  state.cleanup = () => {
    const s = getBridgeState();
    s.sessionId = sessionId;
    s.ctx = cachedCtx;
    s.modelRegistry = cachedModelRegistry;
    s.hasUI = cachedHasUI;
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (gitPollTimer) { clearInterval(gitPollTimer); gitPollTimer = null; }

    // Dev build & restart: rebuild client and stop server before reload
    if (config.devBuildOnReload) {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const packageRoot = path.resolve(__dirname, "..", "..");
      runDevBuild({ packageRoot, serverPort: config.port });
    }

    // Restore original pi.events.emit (EventBus catch-all cleanup)
    if (origEventsEmit && pi.events) {
      pi.events.emit = origEventsEmit;
    }
    connection.disconnect();
  };

  // Reload is handled by session_start which fires on /reload too
}
