/**
 * Handles server→extension messages by dispatching to pi API.
 */
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type {
  ServerToExtensionMessage,
  ExtensionToServerMessage,
} from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { killProcessByPgid } from "./process-scanner.js";
import type { FileEntry, PiSessionInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { filterHiddenCommands } from "./bridge-context.js";
import { expandPromptTemplateFromDisk } from "./prompt-expander.js";

const IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".cache", "__pycache__", ".venv"]);
const MAX_RESULTS = 20;

function emitUiRefresh(
  pi: ExtensionAPI,
  sessionId: string,
  eventSink?: (msg: ExtensionToServerMessage) => void,
): void {
  if (!eventSink || !pi.events) return;

  const modulesProbe: any = { modules: [] };
  try {
    pi.events.emit("ui:list-modules", modulesProbe);
  } catch {
    return;
  }

  const modules = (modulesProbe.modules as any[]) ?? [];
  eventSink({ type: "ui_modules_list", sessionId, modules });

  for (const module of modules) {
    for (const view of module.views ?? []) {
      if (!view.dataEvent) continue;
      const dataProbe: any = { event: view.dataEvent, action: "list" };
      try {
        pi.events.emit("ui:get-data", dataProbe);
      } catch {
        continue;
      }
      if (Array.isArray(dataProbe.items)) {
        eventSink({
          type: "ui_data_list",
          sessionId,
          event: view.dataEvent,
          items: dataProbe.items,
        });
      }
    }
  }
}

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
    /** Route slash commands through session.prompt() */
    sessionPrompt?: (text: string) => void;
  },
): CommandHandler {
  const getSessionId = typeof sessionIdOrGetter === "function" ? sessionIdOrGetter : () => sessionIdOrGetter;
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
              options.sessionPrompt(parsed.text);
            } else {
              pi.sendUserMessage(parsed.text);
            }
            options?.eventSink?.({
              type: "event_forward",
              sessionId,
              event: {
                eventType: "command_feedback",
                timestamp: Date.now(),
                data: { command: parsed.text, status: "completed" },
              },
            });
            return undefined;
          }

          // Passthrough: send as regular user message (with image handling).
          // Multi-line slash commands (e.g. "/skill:foo\nuser text") are classified as
          // passthrough by parseSendPrompt to preserve images (the slash route strips them),
          // so we expand prompt templates / skills here before sending.
          let outgoing = msg.text;
          if (outgoing.startsWith("/")) {
            outgoing = expandPromptTemplateFromDisk(outgoing, process.cwd(), pi);
          }
          sendUserMessageWithImages(pi, outgoing, msg.images);
          return undefined;
        }

        case "abort":
          if (options?.abort) {
            options.abort();
          }
          return undefined;

        case "request_commands": {
          const commands = filterHiddenCommands(pi.getCommands());
          emitUiRefresh(pi, sessionId, options?.eventSink);
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
          emitUiRefresh(pi, sessionId, options?.eventSink);
          return undefined;
        }

        case "list_sessions": {
          try {
            // Dynamic import to avoid hard dependency at module load
            const { SessionManager } = await import("@mariozechner/pi-coding-agent") as any;
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
 * Uses deliverAs: "followUp" so messages queue properly when the agent is streaming. */
function sendUserMessageWithImages(
  pi: ExtensionAPI,
  text: string,
  images?: Array<{ type: string; data: string; mimeType: string }>,
): void {
  const sendOptions = { deliverAs: "followUp" as const };
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
