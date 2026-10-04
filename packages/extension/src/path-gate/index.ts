/**
 * Assembles the agent path gate for the bridge: handler + roots + grant cache +
 * grant link, and the small lifecycle hooks the bridge calls
 * (`onSessionStart`, `onBeforeAgentStart`, `onServerMessage`, `reset`).
 * See change: ask-agent-file-access-in-chat.
 */
import os from "node:os";
import nodePath from "node:path";
import {
  type AgentPathGateConfig,
  DEFAULT_AGENT_PATH_GATE,
  resolveAgentPathGate,
} from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { forbiddenGrantSubjects, isUngrantableSubject } from "@blackbelt-technology/pi-dashboard-shared/forbidden-subjects.js";
import type { PromptBus } from "../prompt-bus.js";
import { GrantCache } from "./grant-cache.js";
import { createGrantLink } from "./grant-link.js";
import { createPathGateHandler, type GatePrompter } from "./handler.js";
import { type PiResources, RootsProvider } from "./roots.js";

export interface PathGateOptions {
  getSessionId: () => string;
  getPromptBus: () => PromptBus | undefined;
  /** Non-buffering send on the OPEN bridge socket. */
  send: (msg: unknown) => boolean;
  /** Raw config read (e.g. `loadConfig().agentPathGate`); env override applied here. */
  readConfig: () => AgentPathGateConfig;
  getCwd: () => string;
  getSessionDir: () => string | undefined;
  log: (line: string) => void;
  notify?: (message: string) => void;
}

const CONFIG_TTL_MS = 1_000;

export function createPathGate(opts: PathGateOptions) {
  const counters = { inRoot: 0, asked: 0, blocked: 0 };
  const resources: PiResources = {
    agentDir: process.env.PI_CODING_AGENT_DIR || nodePath.join(os.homedir(), ".pi", "agent"),
    skillDirs: [],
    contextFiles: [],
  };
  const roots = new RootsProvider({
    getCwd: opts.getCwd,
    getSessionDir: opts.getSessionDir,
    getPiResources: () => resources,
  });
  const grants = new GrantCache();
  const link = createGrantLink({ send: opts.send, sessionId: opts.getSessionId });

  // Config is re-read at most once per CONFIG_TTL_MS so a toggle applies from the
  // next tool call without a per-call file read.
  let cfg: AgentPathGateConfig = DEFAULT_AGENT_PATH_GATE;
  let cfgAt = 0;
  const getConfig = (): AgentPathGateConfig => {
    const t = Date.now();
    if (t - cfgAt > CONFIG_TTL_MS || cfgAt === 0) {
      cfgAt = t;
      try {
        cfg = resolveAgentPathGate(opts.readConfig());
      } catch {
        cfg = resolveAgentPathGate(DEFAULT_AGENT_PATH_GATE);
      }
    }
    return cfg;
  };

  const prompter: GatePrompter = {
    select: async ({ id, title, options, metadata }) => {
      const bus = opts.getPromptBus();
      if (!bus) return undefined; // fail closed: no prompt channel
      const r = await bus.requestWithId(id, { pipeline: "command", type: "select", question: title, options, metadata });
      return r.cancelled ? undefined : r.answer;
    },
    confirm: async ({ id, title, message, metadata }) => {
      const bus = opts.getPromptBus();
      if (!bus) return false;
      const r = await bus.requestWithId(id, { pipeline: "command", type: "confirm", question: title, metadata: { ...metadata, message } });
      return !r.cancelled && r.answer === "true";
    },
    cancel: (id) => opts.getPromptBus()?.cancel(id),
  };

  const handler = createPathGateHandler({
    getConfig,
    getRoots: (g, needsCheckout, cwd) => roots.roots(g, needsCheckout, cwd),
    getGrants: () => grants.get(),
    getSensitiveDirs: () => forbiddenGrantSubjects().sensitive,
    isUngrantable: (s) => isUngrantableSubject(s),
    prompter,
    grantStoreMatch: () => link.storeMatches(),
    requestGrant: (r) => link.requestGrant(r),
    notify: opts.notify,
    log: opts.log,
    counters,
    sessionId: opts.getSessionId,
  });

  return {
    handler,
    counters,
    /** Start the bounded checkout probe + resolve pi's own dirs (best effort). */
    onSessionStart(): void {
      roots.startProbe();
      void import("@earendil-works/pi-coding-agent")
        .then((m: any) => {
          if (m.getAgentDir) resources.agentDir = m.getAgentDir();
          if (m.getDocsPath) resources.docsDir = m.getDocsPath();
        })
        .catch(() => undefined);
    },
    /** Capture loaded skills + context files from `before_agent_start`. */
    onBeforeAgentStart(event: { systemPromptOptions?: { skills?: Array<{ baseDir?: string }>; contextFiles?: Array<{ path?: string }> } }): void {
      const o = event?.systemPromptOptions;
      if (!o) return;
      resources.skillDirs = (o.skills ?? []).map((s) => s.baseDir).filter((x): x is string => !!x);
      resources.contextFiles = (o.contextFiles ?? []).map((f) => f.path).filter((x): x is string => !!x);
    },
    /** Returns true when the frame was consumed. */
    onServerMessage(msg: { type?: string }): boolean {
      if (msg?.type === "dashboard_identity") {
        link.handleIdentity(msg as { grantStoreId?: unknown });
        return true;
      }
      if (msg?.type === "path_grant_result") {
        link.handleResult(msg as { requestId?: unknown });
        return true;
      }
      return false;
    },
    reset(): void {
      link.reset();
    },
  };
}

