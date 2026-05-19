/**
 * Handles server→extension messages by dispatching to pi API.
 */
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  ServerToExtensionMessage,
  ExtensionToServerMessage,
} from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { killProcessByPgid } from "./process-scanner.js";
import type { FileEntry, ImageContent, PiSessionInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { filterHiddenCommands } from "./bridge-context.js";
import { expandPromptTemplateFromDisk } from "./prompt-expander.js";
import { tryDispatchExtensionCommand } from "./slash-dispatch.js";
import { buildProviderCatalogue } from "./provider-register.js";

const IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".cache", "__pycache__", ".venv"]);
const MAX_RESULTS = 20;

function searchFiles(cwd: string, query: string): FileEntry[] {
  const results: FileEntry[] = [];
  const lowerQuery = query?.toLowerCase() ?? "";

  function walk(dir: string, depth: number): void {
    if (results.length >= MAX_RESULTS || depth > 6) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      const relPath = relative(cwd, fullPath).replace(/\\/g, "/") + (entry.isDirectory() ? "/" : "");
      if (!lowerQuery || relPath.toLowerCase().includes(lowerQuery)) {
        results.push({ path: relPath, isDirectory: entry.isDirectory() });
      }
      if (entry.isDirectory()) walk(fullPath, depth + 1);
    }
  }

  walk(cwd, 0);
  return results;
}

/** Parsed result from parseSendPrompt */
export type ParsedPrompt =
  | { type: "bash"; command: string; excludeFromContext: boolean }
  | { type: "compact"; customInstructions: string | undefined }
  | { type: "model"; provider: string; modelId: string }
  | { type: "shutdown" }
  | { type: "reload" }
  | { type: "new" }
  | { type: "mgmt"; event: string; data: Record<string, unknown> }
  | { type: "slash"; text: string }
  | { type: "passthrough"; text: string };

/** pi-flows management commands with known event mappings.
 *  These are dispatched via pi.events instead of flow:run.
 *  Flow management commands (flows:new, flows:edit, flows:delete) are
 *  handled in bridge.ts sessionPrompt callback which passes cachedCtx
 *  as fallback context for headless sessions. */
const MANAGEMENT_COMMAND_EVENTS: Record<string, {
  event: string;
  dataFn: (args: string) => Record<string, unknown>;
}> = {};

/** Parse input text to detect pi internal command prefixes */
export function parseSendPrompt(text: string): ParsedPrompt {
  // 1. Check !! (must check before !)
  if (text.startsWith("!!")) {
    const command = text.slice(2).trim();
    if (!command) return { type: "passthrough", text };
    return { type: "bash", command, excludeFromContext: true };
  }

  // 2. Check !
  if (text.startsWith("!")) {
    const command = text.slice(1).trim();
    if (!command) return { type: "passthrough", text };
    return { type: "bash", command, excludeFromContext: false };
  }

  // 3. Check /compact
  if (text === "/compact" || text.startsWith("/compact ")) {
    const args = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
    return { type: "compact", customInstructions: args || undefined };
  }

  // 4. Check /quit and /exit
  if (text === "/quit" || text === "/exit") {
    return { type: "shutdown" };
  }

  // 4b. Check /reload
  if (text === "/reload") {
    return { type: "reload" };
  }

  // 4c. Check /new
  if (text === "/new") {
    return { type: "new" };
  }

  // 4d. Check /model <provider/id>
  if (text.startsWith("/model ")) {
    const modelStr = text.slice(7).trim();
    const slashIdx = modelStr.indexOf("/");
    if (slashIdx > 0) {
      return { type: "model", provider: modelStr.slice(0, slashIdx), modelId: modelStr.slice(slashIdx + 1) };
    }
  }

  // 5. Check management commands (/flows:new, etc.) with known event mappings
  if (text.startsWith("/") && !text.includes("\n")) {
    const cmdText = text.slice(1);
    const spaceIdx = cmdText.indexOf(" ");
    const cmdName = spaceIdx === -1 ? cmdText : cmdText.slice(0, spaceIdx);
    const cmdArgs = spaceIdx === -1 ? "" : cmdText.slice(spaceIdx + 1);
    const mgmt = MANAGEMENT_COMMAND_EVENTS[cmdName];
    if (mgmt) {
      return { type: "mgmt", event: mgmt.event, data: mgmt.dataFn(cmdArgs) };
    }
  }

  // 6. Check / prefix (generic slash command)
  if (text.startsWith("/") && !text.includes("\n")) {
    return { type: "slash", text };
  }

  // 5. Passthrough
  return { type: "passthrough", text };
}

const BASH_TIMEOUT = 30_000;

export interface CommandHandler {
  handle(msg: ServerToExtensionMessage): ExtensionToServerMessage | undefined | Promise<ExtensionToServerMessage | undefined>;
}

export function createCommandHandler(
  pi: ExtensionAPI,
  sessionIdOrGetter: string | (() => string),
  options?: {
    getModelRegistry?: () => any;
    setThinkingLevel?: (level: string) => void;
    getThinkingLevel?: () => string | undefined;
    shutdown?: () => void;
    abort?: () => void;
    /**
     * Probe agent idleness for the persistent-abort scheduler.
     * See change: fix-provider-retry-infinite-loop.
     */
    isIdle?: () => boolean;
    getCwd?: () => string;
    /** Callback to send events (e.g., bash_output, command_feedback) back to server */
    eventSink?: (msg: ExtensionToServerMessage) => void;
    /** Trigger context compaction */
    compact?: (options: { customInstructions?: string }) => void;
    /** Trigger session reload (extensions, settings, skills, etc.) */
    reload?: () => void;
    /** Spawn a new session in the same cwd */
    spawnNew?: () => void;
    /** Switch model via pi.setModel() */
    setModel?: (provider: string, modelId: string) => Promise<void>;
    /**
     * Route slash commands through pi's command system. May be sync or async.
     * In bridge wiring this also runs the extension-command dispatch branch
     * (see slash-dispatch.ts). The handler awaits the result so command_feedback
     * events emitted by the dispatch path arrive before this turn returns.
     * See change: fix-extension-slash-commands-in-dashboard.
     */
    sessionPrompt?: (text: string, delivery?: "steer" | "followUp") => void | Promise<void>;
    /**
     * If the agent is currently streaming, enqueue the user prompt into the
     * bridge-owned mid-turn queue and return `true`. The command handler then
     * skips its own `pi.sendUserMessage` call. Returns `false` when the agent
     * is idle so the handler delivers the prompt normally.
     *
     * Only applies to the passthrough branch (regular user text and
     * image-bearing messages). Slash commands, !bash, /compact, /reload,
     * /new, /model, and mgmt commands bypass the queue (they run synchronously
     * in the bridge or are dispatched as pi events, never enter pi's user-
     * message turn loop). See capability `mid-turn-prompt-queue`.
     */
    enqueueIfStreaming?: (text: string, images?: ImageContent[]) => boolean;
    /**
     * Drop any bridge-owned mid-turn queue entries for the current session.
     * Invoked on user-initiated `abort` so a Stop click does NOT leave
     * queued messages to be flushed by the upcoming `agent_end` drain.
     * See change: surface-mid-turn-prompt-queue.
     */
    clearQueueOnAbort?: () => void;
  },
): CommandHandler {
  const getSessionId = typeof sessionIdOrGetter === "function" ? sessionIdOrGetter : () => sessionIdOrGetter;

  /**
   * Persistent-abort scheduler. Re-invokes `options.abort()` at 200ms
   * intervals for up to 2 seconds, breaking early when `options.isIdle()`
   * returns true. Closes the retry race window in pi-coding-agent.
   * See change: fix-provider-retry-infinite-loop.
   */
  const PERSISTENT_ABORT_INTERVAL_MS = 200;
  const PERSISTENT_ABORT_MAX_MS = 2000;
  function schedulePersistentAbort(opts: NonNullable<typeof options>): void {
    if (!opts.abort) return;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - startedAt >= PERSISTENT_ABORT_MAX_MS) {
        clearInterval(interval);
        return;
      }
      try {
        if (opts.isIdle?.()) {
          clearInterval(interval);
          return;
        }
      } catch { /* probe failure — keep trying */ }
      try { opts.abort?.(); } catch { /* idempotent */ }
    }, PERSISTENT_ABORT_INTERVAL_MS);
  }

  return {
    async handle(msg: ServerToExtensionMessage): Promise<ExtensionToServerMessage | undefined> {
      const sessionId = getSessionId();

      // Ignore messages for other sessions (skip session-less messages like heartbeat_ack)
      if ((msg as any).sessionId !== undefined && (msg as any).sessionId !== sessionId) {
        console.error(`[dashboard] Ignoring message type=${msg.type} for session ${(msg as any).sessionId}, current session is ${sessionId}`);
        return undefined;
      }

      switch (msg.type) {
        case "send_prompt": {
          const parsed = parseSendPrompt(msg.text);

          // Route based on parsed command type
          if (parsed.type === "bash") {
            await handleBashCommand(pi, sessionId, parsed.command, parsed.excludeFromContext, options?.eventSink);
            return undefined;
          }

          if (parsed.type === "compact") {
            await handleCompactCommand(sessionId, parsed.customInstructions, options?.compact, options?.eventSink);
            return undefined;
          }

          if (parsed.type === "shutdown") {
            if (options?.shutdown) {
              options.shutdown();
            }
            return undefined;
          }

          if (parsed.type === "reload") {
            if (options?.reload) {
              options.reload();
            }
            options?.eventSink?.({
              type: "event_forward",
              sessionId,
              event: {
                eventType: "command_feedback",
                timestamp: Date.now(),
                data: { command: "/reload", status: "completed" },
              },
            });
            return undefined;
          }

          if (parsed.type === "new") {
            if (options?.spawnNew) {
              options.spawnNew();
            }
            options?.eventSink?.({
              type: "event_forward",
              sessionId,
              event: {
                eventType: "command_feedback",
                timestamp: Date.now(),
                data: { command: "/new", status: "completed" },
              },
            });
            return undefined;
          }

          if (parsed.type === "model") {
            if (options?.setModel) {
              await options.setModel(parsed.provider, parsed.modelId);
            }
            options?.eventSink?.({
              type: "event_forward",
              sessionId,
              event: {
                eventType: "command_feedback",
                timestamp: Date.now(),
                data: { command: `/model ${parsed.provider}/${parsed.modelId}`, status: "completed" },
              },
            });
            return undefined;
          }

          if (parsed.type === "mgmt") {
            // Dispatch management command via pi.events (e.g. flows:new-request)
            if ((pi as any).events) {
              (pi as any).events.emit(parsed.event, parsed.data);
            }
            options?.eventSink?.({
              type: "event_forward",
              sessionId,
              event: {
                eventType: "command_feedback",
                timestamp: Date.now(),
                data: { command: parsed.event, status: "completed" },
              },
            });
            return undefined;
          }

          if (parsed.type === "slash") {
            if (options?.sessionPrompt) {
              // sessionPrompt (bridge) owns slash-dispatch + flow fast-path +
              // template expansion. It also owns command_feedback emission for
              // extension-command dispatch. Do NOT emit completed here — would
              // duplicate the dispatch path's terminal event.
              // See change: fix-extension-slash-commands-in-dashboard.
              await options.sessionPrompt(parsed.text, msg.delivery);
            } else {
              // Test / non-bridge callers: apply the extension-command dispatch
              // branch inline before falling through to sendUserMessage. Keeps
              // both call sites in lockstep per spec routing-step 9.
              const handled = await tryDispatchExtensionCommand(
                pi,
                parsed.text,
                sessionId,
                options?.eventSink,
                undefined, // connection — absent in non-bridge path
                msg.delivery,
              );
              if (!handled) {
                // sendUserMessage exempt from gating: only typed single-line
                // slashes that are NOT extension commands reach this — i.e.
                // skills, prompt templates, unrecognized slashes.
                // Forward delivery so steering on slash fallback honors the
                // dashboard's keyboard contract. See change: add-steering-message.
                const deliverAs = msg.delivery ?? ("followUp" as const);
                (pi.sendUserMessage as any)(parsed.text, { deliverAs });
              }
            }
            return undefined;
          }

          // Passthrough: send as regular user message (with image handling).
          // Multi-line slash commands (e.g. "/skill:foo\nuser text") are classified as
          // passthrough by parseSendPrompt to preserve images (the slash route strips them),
          // so we expand prompt templates / skills here before sending.
          //
          // sendUserMessage exempt from extension-dispatch gating: this path handles
          // multi-line slashes and image-bearing messages. Per spec, only typed
          // single-line slash text gates through extension dispatch — multi-line and
          // image-bearing messages go raw to the LLM as before.
          // See change: fix-extension-slash-commands-in-dashboard.
          let outgoing = msg.text;
          if (outgoing.startsWith("/")) {
            outgoing = expandPromptTemplateFromDisk(outgoing, process.cwd(), pi);
          }
          // Bridge-owned mid-turn prompt queue: if the agent is streaming, push
          // to the bridge queue instead of forwarding to pi. The bridge drains
          // on `agent_end` (see bridge.ts), so messages run after the current
          // turn completes. Cancel via `clear_queue`.
          // Steering messages (delivery: "steer") bypass the bridge queue —
          // pi handles its own internal steering queue, delivering after the
          // current turn finishes its tool calls. See change: add-steering-message.
          // See capability `mid-turn-prompt-queue`.
          const isSteering = msg.delivery === "steer";
          if (!isSteering && options?.enqueueIfStreaming?.(outgoing, msg.images)) {
            return undefined;
          }
          sendUserMessageWithImages(pi, outgoing, msg.images, msg.delivery);
          return undefined;
        }

        case "abort":
          // Drop any queued mid-turn entries BEFORE invoking pi.abort().
          // Pi will fire `agent_end` in response to the abort, which would
          // normally trigger the bridge queue drain. Clearing first means
          // Stop genuinely stops everything — including messages the user
          // typed during the now-aborted turn. See change:
          // surface-mid-turn-prompt-queue.
          if (options?.clearQueueOnAbort) {
            options.clearQueueOnAbort();
          }
          if (options?.abort) {
            options.abort();
          }
          // Synthesize an immediate auto_retry_end so the dashboard clears
          // any in-flight retry banner without waiting for pi's natural
          // auto_retry_end (which is delayed by the abortable-sleep cancel
          // window AND, on extension API, never reaches us at all — see
          // https://github.com/badlogic/pi-mono/discussions/2073). The
          // reducer no-ops auto_retry_end when retryState is undefined,
          // so this is idempotent against later events.
          if (options?.eventSink) {
            options.eventSink({
              type: "event_forward",
              sessionId,
              event: {
                eventType: "auto_retry_end",
                timestamp: Date.now(),
                data: { success: false, attempt: -1, finalError: "Aborted by user" },
              },
            });
          }
          // Persistent-abort scheduler: pi-coding-agent's _retryAbortController
          // is briefly `undefined` between sleep-end and the next
          // agent.continue() call. An abort that arrives in that window is
          // a no-op against the retry. Re-invoke abort every 200ms for up
          // to 2s, breaking early when the agent is idle.
          // See change: fix-provider-retry-infinite-loop.
          if (options) schedulePersistentAbort(options);
          return undefined;

        case "request_commands": {
          const commands = filterHiddenCommands(pi.getCommands());
          // Also send flows list alongside commands
          if (options?.eventSink) {
            const probe: any = {};
            try { pi.events?.emit("flow:list-flows", probe); } catch { /* ignore */ }
            options.eventSink({ type: "flows_list", sessionId, flows: probe.flows ?? [] });
          }
          return {
            type: "commands_list",
            sessionId,
            commands,
          };
        }

        case "list_files": {
          const files = searchFiles(process.cwd(), msg.query);
          return {
            type: "files_list",
            sessionId,
            query: msg.query,
            files,
          };
        }

        // openspec_refresh removed — server handles directly via DirectoryService

        case "rename_session":
          pi.setSessionName(msg.name);
          return {
            type: "session_name_update",
            sessionId,
            name: msg.name,
          };

        case "request_models": {
          const registry = options?.getModelRegistry?.();
          if (registry) {
            try {
              registry.authStorage?.reload?.();
              registry.refresh();
              const models = registry.getAvailable().map((m: any) => ({
                provider: m.provider,
                id: m.id,
              }));
              return { type: "models_list", sessionId, models };
            } catch { /* ignore */ }
          }
          return { type: "models_list", sessionId, models: [] };
        }

        case "request_providers": {
          // See change: replace-hardcoded-provider-lists.
          return { type: "providers_list", sessionId, providers: buildProviderCatalogue() };
        }

        case "set_thinking_level":
          if (options?.setThinkingLevel) {
            options.setThinkingLevel(msg.level);
          }
          return undefined;

        case "set_model":
          if (options?.setModel) {
            await options.setModel(msg.provider, msg.modelId);
          }
          return undefined;

        case "kill_process": {
          const pgid = (msg as { pgid: number }).pgid;
          if (pgid) {
            const killed = killProcessByPgid(pgid);
            console.error(`[dashboard] kill_process pgid=${pgid} result=${killed}`);
          }
          return undefined;
        }

        case "shutdown":
          if (options?.shutdown) {
            options.shutdown();
          }
          return undefined;

        case "request_state_sync":
          // State sync is handled by the bridge on reconnect
          return undefined;

        case "request_flows_refresh": {
          // Re-query pi-flows and send updated list
          if (options?.eventSink) {
            const probe: any = {};
            try { pi.events?.emit("flow:list-flows", probe); } catch { /* ignore */ }
            options.eventSink({ type: "flows_list", sessionId, flows: probe.flows ?? [] });
          }
          return undefined;
        }

        case "list_sessions": {
          try {
            // Dynamic import to avoid hard dependency at module load
            const { SessionManager } = await import("@earendil-works/pi-coding-agent") as any;
            const cwd = msg.cwd || options?.getCwd?.() || process.cwd();
            const sessionInfos = await SessionManager.list(cwd);
            const sessions: PiSessionInfo[] = (sessionInfos || []).map((s: any) => ({
              id: s.id,
              path: s.path,
              cwd: s.cwd,
              name: s.name,
              parentSessionPath: s.parentSessionPath,
              created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
              modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
              messageCount: s.messageCount ?? 0,
              firstMessage: s.firstMessage,
            }));
            return { type: "sessions_list", sessionId, cwd, sessions };
          } catch {
            return { type: "sessions_list", sessionId, cwd: msg.cwd || process.cwd(), sessions: [] };
          }
        }

        default:
          return undefined;
      }
    },
  };
}

/** Send a user message with optional image validation.
 * Uses deliverAs: "followUp" by default so messages queue properly when the agent is streaming.
 * Pass deliverAs: "steer" for steering messages (delivered after current turn).
 * See change: add-steering-message. */
function sendUserMessageWithImages(
  pi: ExtensionAPI,
  text: string,
  images?: Array<{ type: string; data: string; mimeType: string }>,
  delivery?: "steer" | "followUp",
): void {
  const deliverAs = delivery ?? ("followUp" as const);
  const sendOptions = { deliverAs };
  if (images && images.length > 0) {
    const validMimeTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
    const validImages = images.filter((img) => {
      if (!img || typeof img !== "object") {
        console.error("[dashboard] Dropping non-object image entry");
        return false;
      }
      if (!img.mimeType || typeof img.mimeType !== "string" || !validMimeTypes.has(img.mimeType)) {
        console.error(`[dashboard] Dropping image with invalid mimeType: "${img.mimeType}" (type: ${typeof img.mimeType})`);
        return false;
      }
      if (!img.data || typeof img.data !== "string") {
        console.error(`[dashboard] Dropping image with invalid data (type: ${typeof img.data}, length: ${img.data?.length ?? 0})`);
        return false;
      }
      return true;
    });
    if (validImages.length > 0) {
      const content = [
        { type: "text" as const, text },
        ...validImages.map((img) => ({
          type: "image" as const,
          data: img.data,
          mimeType: img.mimeType,
        })),
      ];
      console.error(`[dashboard] Sending message with ${validImages.length} image(s), mimeTypes: ${validImages.map(i => i.mimeType).join(", ")}`);
      (pi.sendUserMessage as any)(content, sendOptions);
    } else {
      (pi.sendUserMessage as any)(text, sendOptions);
    }
  } else {
    (pi.sendUserMessage as any)(text, sendOptions);
  }
}

/** Execute a bash command and forward results */
async function handleBashCommand(
  pi: ExtensionAPI,
  sessionId: string,
  command: string,
  excludeFromContext: boolean,
  eventSink?: (msg: ExtensionToServerMessage) => void,
): Promise<void> {
  let output = "";
  let exitCode = 0;
  try {
    const result = await pi.exec("sh", ["-c", command], { timeout: BASH_TIMEOUT });
    output = (result.stdout || "") + (result.stderr || "");
    exitCode = result.exitCode ?? 0;
  } catch (err: any) {
    output = err?.message ?? "Command execution failed";
    exitCode = 1;
  }

  // Forward bash output event
  eventSink?.({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "bash_output",
      timestamp: Date.now(),
      data: { command, output, exitCode, excludeFromContext },
    },
  });

  // For ! (not !!), also send to LLM
  if (!excludeFromContext) {
    const message = `$ ${command}\n${output}`;
    pi.sendUserMessage(message);
  }
}

/** Handle /compact command */
async function handleCompactCommand(
  sessionId: string,
  customInstructions: string | undefined,
  compact?: (options: { customInstructions?: string }) => void,
  eventSink?: (msg: ExtensionToServerMessage) => void,
): Promise<void> {
  eventSink?.({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "command_feedback",
      timestamp: Date.now(),
      data: { command: "/compact", status: "started" },
    },
  });

  try {
    if (compact) {
      compact({ customInstructions });
    }
  } catch (err: any) {
    eventSink?.({
      type: "event_forward",
      sessionId,
      event: {
        eventType: "command_feedback",
        timestamp: Date.now(),
        data: { command: "/compact", status: "error", message: err?.message ?? "Compaction failed" },
      },
    });
  }
}

// handleLoadSessionEvents removed — server loads sessions directly via DirectoryService
