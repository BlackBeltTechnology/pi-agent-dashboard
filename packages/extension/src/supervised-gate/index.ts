/**
 * Assembles the supervised-mode gate for the bridge: the mode store (over the
 * process-global `BridgeState` maps), a config reader that re-parses only when
 * the config file's change signature moves, the PromptBus transport and the
 * durable decision sink. Returns the `tool_call` handler plus `clearSession`
 * (called on `session_shutdown`).
 * See change: add-supervised-tool-approval.
 */
import * as fs from "node:fs";
import {
  CONFIG_FILE,
  DEFAULT_SUPERVISED_MODE,
  type SupervisedModeConfig,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { ToolGateOwner } from "@blackbelt-technology/pi-dashboard-shared/tool-gate/owner.js";
import { toolGateOwner } from "@blackbelt-technology/pi-dashboard-shared/tool-gate/owner.js";
import type { PromptBus } from "../prompt-bus.js";
import { createSupervisedGate, type SupervisedPrompter } from "./handler.js";
import { createSupervisedModeControl, type SupervisedModeControlDeps } from "./mode-control.js";
import { createModeStore, type ModeStoreBacking } from "./mode-store.js";

export interface SupervisedGateOptions {
  getSessionId: () => string;
  getPromptBus: () => PromptBus | undefined;
  /** Raw config read (e.g. `loadConfig().supervisedMode`). */
  readConfig: () => SupervisedModeConfig;
  /** Config file whose change signature gates re-reads (default: the dashboard `config.json`). */
  configFile?: string;
  /** Process-global maps (`BridgeState`) holding per-session mode + rev. */
  state: ModeStoreBacking;
  /** Secret redaction for operator-visible / logged action text. */
  redact: (text: string) => string;
  /** `pi.appendEntry(type, data)` — `supervised-tool-decision` records and `supervised-mode` entries. */
  appendEntry: (type: string, data: unknown) => void;
  /** Bridge → server frames (`supervised_state`); default: dropped. */
  send?: SupervisedModeControlDeps["send"];
  /** Owner slot read (default: the shared `toolGateOwner`). */
  getOwner?: (sessionId: string) => ToolGateOwner | undefined;
  log: (line: string) => void;
  /** Path-gate hand-off consume (B2); default: never hands off. */
  consumeHandoff?: (sessionId: string, toolCallId: string) => boolean;
}

export function createSupervisedGateForBridge(opts: SupervisedGateOptions) {
  const configFile = opts.configFile ?? CONFIG_FILE;
  let cfgSig = "\u0000never";
  let cfg: SupervisedModeConfig = DEFAULT_SUPERVISED_MODE;
  const signature = (): string => {
    try {
      const st = fs.statSync(configFile);
      return `${st.mtimeMs}:${st.size}:${st.ino}:${st.ctimeMs}`;
    } catch {
      return "missing";
    }
  };
  const getConfig = (): SupervisedModeConfig => {
    const sig = signature();
    if (sig !== cfgSig) {
      cfgSig = sig;
      try {
        cfg = opts.readConfig();
      } catch {
        cfg = DEFAULT_SUPERVISED_MODE;
      }
    }
    return cfg;
  };

  const modes = createModeStore(opts.state, () => getConfig().default === "supervised");

  const prompter: SupervisedPrompter = {
    request: async ({ id, question, options, metadata }) => {
      const bus = opts.getPromptBus();
      if (!bus) throw new Error("no prompt bus"); // fail closed: no prompt channel
      const r = await bus.requestWithId(id, { pipeline: "command", type: "select", question, options, metadata });
      return { answer: r.answer, cancelled: r.cancelled, source: r.source };
    },
    cancel: (id) => opts.getPromptBus()?.cancel(id),
  };

  const gate = createSupervisedGate({
    sessionId: opts.getSessionId,
    getMode: (sid) => modes.get(sid),
    getConfig,
    getBusTimeoutMs: () => opts.getPromptBus()?.getTimeoutMs(),
    prompter,
    consumeHandoff: opts.consumeHandoff,
    getOwner: opts.getOwner,
    redact: opts.redact,
    record: (entry) => opts.appendEntry("supervised-tool-decision", entry),
    log: opts.log,
  });

  const getOwner = opts.getOwner ?? toolGateOwner;
  const control = createSupervisedModeControl({
    modes,
    getSessionId: opts.getSessionId,
    appendEntry: opts.appendEntry,
    send: opts.send ?? (() => {}),
    getOwner,
    log: opts.log,
  });

  return {
    handler: gate.handler,
    modes,
    /** Restore / `set_supervised` / registration fields / `supervised_state` re-report. */
    control,
    /**
     * Narrow accessor for the agent path gate (design D14): the session is Supervised, its tool gate
     * is not owned by the chat-gateway guard, and `toolName` is in the configured risky set
     * (case-insensitive). Never throws on a missing session.
     */
    inEffect(sessionId: string, toolName: string): boolean {
      if (!modes.get(sessionId) || getOwner(sessionId) === "chat-gateway") return false;
      const t = String(toolName).toLowerCase();
      return getConfig().tools.some((x) => String(x).toLowerCase() === t);
    },
    /** `session_shutdown`: drop the session's mode, rev, mutex chain, unclassified-log set and report memo. */
    clearSession(sessionId: string): void {
      modes.clear(sessionId);
      control.clear(sessionId);
      gate.clearSession(sessionId);
    },
    hasSessionState(sessionId: string) {
      return { mode: modes.has(sessionId), ...gate.hasSessionState(sessionId) };
    },
  };
}
