/**
 * AcpSessionAdapter — the transport-agnostic translation core.
 *
 * Exchanges ONLY bridge-protocol messages with its host (`send` out,
 * `handle(ServerToExtensionMessage)` in) and ACP JSON-RPC with the agent child.
 * No sockets, no gateway, no keeper: host A (in-process, `local-host.ts`) and
 * host B (out-of-process, `main.ts`) mount the same core, so browser-visible
 * behaviour is identical for both.
 *
 * Pipeline (D6): agent stdout → bounded line splitter → JSON-RPC peer →
 * (v1: normaliser) → v2 update → pi-shaped dashboard events → `event_forward`
 * (+ durable event log on host B). The agent's own ACP session id stays in
 * memory; the dashboard session id is a UUID minted by the host.
 *
 * See change: add-acp-session-driver (D1, D4–D11, D13).
 */
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import type { AcpAgentConfig, AcpSettings } from "@blackbelt-technology/pi-dashboard-shared/acp/acp-config.js";
import { createV1Normalizer } from "@blackbelt-technology/pi-dashboard-shared/acp/normalize-v1.js";
import {
  createDashboardEventAdapter,
  userMessageEvents,
} from "@blackbelt-technology/pi-dashboard-shared/acp/to-dashboard-events.js";
import { type AcpUpdate, parseSessionUpdate } from "@blackbelt-technology/pi-dashboard-shared/acp/update-model.js";
import type { ExtensionToServerMessage, ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { type AcpConnection, createAcpConnection } from "./acp-connection.js";
import { launchAgentProcess } from "./child-env.js";
import type { EventLog } from "./event-log.js";
import { currentModel, findOption, modelInfos } from "./models.js";
import { createPermissionBridge } from "./permission-bridge.js";
import { handleServerMessage } from "./server-requests.js";
import { EchoGuard, PromptQueue, type QueuedPrompt } from "./session-state.js";

/** The slice of `ChildProcess` the core uses (tests pass a stub). */
export interface AgentHandle {
  stdin: Writable;
  stdout: Readable;
  stderr?: Readable | null;
  pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
}

export interface AcpSessionAdapterOptions {
  agent: AcpAgentConfig;
  settings: AcpSettings;
  cwd: string;
  /** Dashboard session id (UUID, minted by the host). */
  sessionId: string;
  spawnToken?: string;
  /** Registered as `sessionFile` (meta-persistence key). */
  sessionFile?: string;
  /** pid reported in `session_register` (host B: adapter pid; host A: omit — it is the server's). */
  reportPid?: number;
  send: (m: ExtensionToServerMessage) => void;
  log: (line: string) => void;
  /** Durable event log (host B). */
  eventLog?: EventLog;
  launchAgent?: (cwd: string) => AgentHandle;
  /** Fires once when the session is over (`0` clean stop, non-zero failure). */
  onExit: (code: number) => void;
  now?: () => number;
}

export interface AcpSessionAdapter {
  start(): Promise<void>;
  handle(m: ServerToExtensionMessage): void;
  /** Gateway connection lost: stop forwarding events (they stay in the log). */
  disconnected(): void;
  /** Gateway connection re-established: re-register, replay, re-send pending prompts. */
  reconnected(): Promise<void>;
  stop(): Promise<void>;
}

const HEARTBEAT_MS = 15_000;
const COUNTER_REPORT_MS = 60_000;
const KILL_ESCALATE_MS = 3_000;
const CLIENT_INFO = { name: "pi-dashboard", title: "Pi Dashboard" };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createAcpSessionAdapter(opts: AcpSessionAdapterOptions): AcpSessionAdapter {
  const { agent, settings, sessionId } = opts;
  const now = opts.now ?? Date.now;

  const dash = createDashboardEventAdapter({ agentId: agent.id, now });
  const v1 = createV1Normalizer();
  const echo = new EchoGuard();
  const queue = new PromptQueue();

  let proc: AgentHandle | undefined;
  let conn: AcpConnection | undefined;
  let acpSessionId = "";
  let protocol: 1 | 2 = 1;
  let ready = false;
  let finished = false;
  let connected = true;
  let turnActive = false;
  let replaying = false;
  let heldWhileReplaying: ExtensionToServerMessage[] = [];
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let counterTimer: ReturnType<typeof setInterval> | undefined;
  let lastCounterSig = "";
  let startTimer: ReturnType<typeof setTimeout> | undefined;

  // ── outbound ───────────────────────────────────────────────────────────

  const send = (m: ExtensionToServerMessage): void => {
    if (finished && m.type !== "session_unregister") return;
    if (replaying) heldWhileReplaying.push(m);
    else opts.send(m);
  };

  const emit = (events: DashboardEvent[]): void => {
    for (const event of events) {
      opts.eventLog?.append(event);
      if (connected) send({ type: "event_forward", sessionId, event });
    }
  };

  const notify = (message: string): void =>
    send({ type: "notify", sessionId, notifyId: randomUUID(), message, level: "error", ts: now() });

  const diagnostic = (detail: string): void => {
    opts.log(`[acp:${agent.id}] ${detail}`);
    send({ type: "bridge_diagnostic", sessionId, event: "acp", detail });
  };

  const registerMessage = (reason: "spawn" | "reattach"): ExtensionToServerMessage => ({
    type: "session_register",
    sessionId,
    cwd: opts.cwd,
    source: "dashboard",
    ...(opts.reportPid !== undefined ? { pid: opts.reportPid } : {}),
    hasUI: false,
    dashboardSpawned: true,
    ...(opts.spawnToken ? { spawnToken: opts.spawnToken } : {}),
    registerReason: reason,
    ...(reason === "spawn" ? { isNew: true } : {}),
    driver: "acp",
    acpAgentId: agent.id,
    ...(opts.sessionFile ? { sessionFile: opts.sessionFile } : {}),
  });

  const options = () => dash.getState().configOptions.values();

  const publishModels = (): void => send({ type: "models_list", sessionId, models: modelInfos(options(), agent.id) });
  const publishCommands = (): void =>
    send({
      type: "commands_list",
      sessionId,
      commands: dash.getState().commands.map((c) => ({ name: c.name, description: c.description, source: "acp" as const })),
    });
  const publishQueue = (): void => send({ type: "queue_update", sessionId, steering: [], followUp: queue.view() });
  const publishModelState = (): void => {
    const model = currentModel(options(), agent.id);
    const level = findOption(options(), "thought_level")?.currentValue;
    if (model) send({ type: "model_update", sessionId, model, ...(typeof level === "string" ? { thinkingLevel: level } : {}) });
  };

  // ── permission bridge ──────────────────────────────────────────────────

  const permissions = createPermissionBridge(sessionId, send, {
    onAnswered: () => {
      if (protocol === 1) ingest(v1.permissionAnswered());
    },
  });

  // ── inbound updates ────────────────────────────────────────────────────

  function sideEffects(u: AcpUpdate): void {
    switch (u.kind) {
      case "available_commands_update":
        return publishCommands();
      case "session_info_update":
        if (u.title) send({ type: "session_name_update", sessionId, name: u.title, nameSource: "auto" });
        return;
      case "config_option_update":
        publishModels();
        return publishModelState();
      case "state_update":
        if (u.state === "running") turnActive = true;
        if (u.state === "idle") turnActive = false;
        return;
      default:
    }
  }

  /** Echo guard for user updates. Returns false when the update is held back. */
  function admitUser(u: Extract<AcpUpdate, { kind: "user_message" | "user_message_chunk" }>): boolean {
    const route = echo.route(u);
    if (route === "suppress") dash.suppressUserMessage(u.messageId);
    return route !== "hold";
  }

  function ingest(updates: AcpUpdate[]): void {
    let idle = false;
    for (const u of updates) {
      if ((u.kind === "user_message" || u.kind === "user_message_chunk") && !admitUser(u)) continue;
      emit(dash.push(u));
      sideEffects(u);
      idle ||= u.kind === "state_update" && u.state === "idle";
    }
    if (idle) drainQueue();
  }

  function onSessionUpdate(params: unknown): void {
    const raw = isRec(params) ? params.update : undefined;
    ingest(protocol === 1 ? v1.update(raw) : [parseSessionUpdate(raw)]);
  }

  // ── prompts ────────────────────────────────────────────────────────────

  const promptBlocks = (p: QueuedPrompt): Array<Record<string, unknown>> => [
    { type: "text", text: p.text },
    ...(p.images ?? []).map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType })),
  ];

  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

  function onPromptResult(result: unknown, promptId: string | undefined, ack: boolean): void {
    const res = isRec(result) ? result : {};
    if (protocol === 1) {
      ingest(echo.resolved());
      ingest(v1.promptResolved(str(res.stopReason) ?? null));
      return;
    }
    ingest(echo.accepted(str(res.messageId)));
    if (ack) send({ type: "prompt_received", sessionId, fresh: true, ...(promptId ? { promptId } : {}) });
  }

  function onPromptRejected(err: unknown): void {
    ingest(echo.resolved());
    const message = errText(err);
    if (protocol === 1) {
      // v1 already emitted "running"; end the turn with an error.
      ingest([{ kind: "state_update", state: "idle", stopReason: "error", error: { message } }]);
    } else {
      ingest([
        { kind: "state_update", state: "running" },
        { kind: "state_update", state: "idle", stopReason: "error", error: { message } },
      ]);
    }
  }

  function dispatchPrompt(p: QueuedPrompt, ack: boolean): void {
    if (!conn) return;
    turnActive = true;
    emit(userMessageEvents(p.images?.length ? [{ type: "text", text: p.text }, ...p.images.map((i) => ({ type: "image", data: i.data, mimeType: i.mimeType }))] : p.text, now()));
    echo.begin(protocol);
    if (protocol === 1) {
      ingest(v1.promptDispatched());
      if (ack) send({ type: "prompt_received", sessionId, fresh: true, ...(p.promptId ? { promptId: p.promptId } : {}) });
    }
    conn
      .request("session/prompt", { sessionId: acpSessionId, prompt: promptBlocks(p) }, 0)
      .then((r) => onPromptResult(r, p.promptId, ack))
      .catch(onPromptRejected);
  }

  function drainQueue(): void {
    if (!ready || finished || turnActive || queue.length === 0) return;
    const next = queue.shift();
    publishQueue();
    if (next) dispatchPrompt(next, false);
  }

  function sendPrompt(m: Extract<ServerToExtensionMessage, { type: "send_prompt" }>): void {
    const p: QueuedPrompt = { text: m.text, images: m.images, promptId: m.promptId };
    // The browser sends delivery "steer" by default, also when idle (pi runs it
    // at once). ACP has no steering, so a steer sent mid-turn queues as a follow-up.
    if (!ready || turnActive) {
      queue.enqueue(p);
      send({ type: "prompt_received", sessionId, fresh: false, ...(m.promptId ? { promptId: m.promptId } : {}) });
      publishQueue();
      return;
    }
    dispatchPrompt(p, true);
  }

  function abort(): void {
    conn?.notify("session/cancel", { sessionId: acpSessionId });
    permissions.cancelAll();
  }

  // ── config options ─────────────────────────────────────────────────────

  function setConfig(category: "model" | "thought_level", value: string, label: string): void {
    const opt = findOption(options(), category);
    if (!opt || !conn) return notify(`This agent does not expose ${label} selection`);
    conn
      .request("session/set_config_option", { sessionId: acpSessionId, configId: opt.configId, value })
      .then((res) => {
        if (isRec(res) && Array.isArray(res.configOptions)) ingest([parseSessionUpdate({ sessionUpdate: "config_option_update", configOptions: res.configOptions })]);
      })
      .catch((err) => notify(`Could not change ${label}: ${errText(err)}`));
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  function killAgent(): void {
    const p = proc;
    if (!p) return;
    try {
      p.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    const t = setTimeout(() => {
      try {
        p.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, KILL_ESCALATE_MS);
    t.unref?.();
  }

  function finish(code: number): void {
    if (finished) return;
    finished = true;
    if (heartbeat) clearInterval(heartbeat);
    if (counterTimer) clearInterval(counterTimer);
    if (startTimer) clearTimeout(startTimer);
    conn?.close(new Error("ACP session ended"));
    killAgent();
    Promise.resolve(opts.eventLog?.flush())
      .catch(() => {})
      .finally(() => opts.onExit(code));
  }

  /** Surface a failure in the session, unregister and end. */
  function fail(cause: string, code = 1): void {
    if (finished) return;
    permissions.cancelAll();
    queue.clearAll();
    ingest([
      { kind: "state_update", state: "running" },
      { kind: "state_update", state: "idle", stopReason: "error", error: { message: cause } },
    ]);
    diagnostic(`failed: ${cause}`);
    send({ type: "session_unregister", sessionId });
    finish(code);
  }

  function wireAgent(handle: AgentHandle): void {
    proc = handle;
    handle.on("error", (err) => fail(`ACP agent failed to start: ${errText(err)}`));
    handle.on("exit", (code, signal) => fail(`ACP agent exited (${signal ? `signal ${signal}` : `code ${code}`})`));
    // A dead agent makes writes to its stdin fail with EPIPE; an unhandled stream
    // 'error' would crash the process (the SERVER, for host A). The exit/close
    // handlers own the failure.
    handle.stdin.on("error", (err) => opts.log(`[acp:${agent.id}] agent stdin error: ${errText(err)}`));
    handle.stdout.on("error", (err) => opts.log(`[acp:${agent.id}] agent stdout error: ${errText(err)}`));
    let stderrLines = 0;
    handle.stderr?.on("data", (c: Buffer) => {
      if (stderrLines++ < 200) opts.log(`[acp:${agent.id}] stderr: ${c.toString("utf8").slice(0, 2000).trimEnd()}`);
    });
    conn = createAcpConnection({
      input: handle.stdout,
      output: handle.stdin,
      maxLineBytes: settings.maxLineBytes,
      requestTimeoutMs: settings.requestTimeoutMs,
      requestHandlers: { "session/request_permission": handlePermission },
      onNotification: (method, params) => {
        if (method === "session/update") onSessionUpdate(params);
      },
      onClose: () => fail("ACP agent closed its output"),
    });
  }

  function handlePermission(params: unknown): Promise<unknown> {
    if (protocol === 1) ingest(v1.permissionRequested());
    return permissions.request(params).then((outcome) => ({ outcome }));
  }

  async function handshake(): Promise<void> {
    const connection = conn as AcpConnection;
    const requested: 1 | 2 = settings.protocolV2 ? 2 : 1;
    const init = await connection.request(
      "initialize",
      {
        protocolVersion: requested,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: CLIENT_INFO,
      },
      0,
    );
    const version = isRec(init) ? init.protocolVersion : undefined;
    if (version !== 1 && !(version === 2 && requested === 2)) {
      throw new Error(`unsupported ACP protocol version ${String(version)}`);
    }
    protocol = version;
    const created = await connection.request("session/new", { cwd: opts.cwd, mcpServers: [] }, 0);
    if (!isRec(created) || typeof created.sessionId !== "string") throw new Error("session/new returned no sessionId");
    acpSessionId = created.sessionId;
    if (Array.isArray(created.configOptions)) {
      ingest([parseSessionUpdate({ sessionUpdate: "config_option_update", configOptions: created.configOptions })]);
    }
  }

  function startWatchdogs(): void {
    heartbeat = setInterval(() => {
      if (connected) send({ type: "session_heartbeat", sessionId, agentRunning: turnActive });
    }, HEARTBEAT_MS);
    heartbeat.unref?.();
    counterTimer = setInterval(reportCounters, COUNTER_REPORT_MS);
    counterTimer.unref?.();
  }

  function reportCounters(): void {
    const c = { ...conn?.counters(), ...dash.counters() };
    const sig = JSON.stringify(c);
    if (sig === lastCounterSig) return;
    lastCounterSig = sig;
    const nonZero = Object.entries(c).filter(([, v]) => v > 0);
    if (nonZero.length > 0) diagnostic(`counters ${nonZero.map(([k, v]) => `${k}=${v}`).join(" ")}`);
  }

  async function start(): Promise<void> {
    send(registerMessage("spawn"));
    // A fresh session has nothing to replay. The server holds every event back
    // (replayingSessions) after a register until `replay_complete`, or for 5 s —
    // without this the first turn of a new session would stay invisible.
    send({ type: "replay_complete", sessionId });
    startWatchdogs();
    const timedOut = new Promise<never>((_, reject) => {
      startTimer = setTimeout(
        () => reject(new Error(`timeout: ACP agent did not become ready within ${settings.spawnTimeoutMs} ms`)),
        settings.spawnTimeoutMs,
      );
    });
    try {
      wireAgent(
        (opts.launchAgent ?? ((cwd) => launchAgentProcess({ agent, cwd, warn: (w) => opts.log(`[acp:${agent.id}] ${w}`) }) as unknown as AgentHandle))(opts.cwd),
      );
      await Promise.race([handshake(), timedOut]);
    } catch (err) {
      fail(errText(err));
      return;
    }
    if (finished) return;
    if (startTimer) clearTimeout(startTimer);
    ready = true;
    diagnostic(`agent=${agent.id} protocol=v${protocol} started`);
    publishModels();
    publishCommands();
    drainQueue();
  }

  async function reconnected(): Promise<void> {
    if (finished) return;
    replaying = true;
    heldWhileReplaying = [];
    connected = true;
    opts.send(registerMessage("reattach"));
    publishModelsRaw();
    const snapshot = opts.eventLog ? (await opts.eventLog.flush(), opts.eventLog.size()) : 0;
    if (opts.eventLog) {
      await opts.eventLog.replay((event) => opts.send({ type: "event_forward", sessionId, event }), snapshot);
    }
    opts.send({ type: "replay_complete", sessionId });
    replaying = false;
    for (const m of heldWhileReplaying) opts.send(m);
    heldWhileReplaying = [];
    permissions.resend();
    if (queue.length > 0) publishQueue();
  }

  /** `models_list` / `commands_list` / model state straight to the host (bypasses the replay hold). */
  function publishModelsRaw(): void {
    opts.send({ type: "models_list", sessionId, models: modelInfos(options(), agent.id) });
    opts.send({
      type: "commands_list",
      sessionId,
      commands: dash.getState().commands.map((c) => ({ name: c.name, description: c.description, source: "acp" as const })),
    });
    const model = currentModel(options(), agent.id);
    const level = findOption(options(), "thought_level")?.currentValue;
    if (model) opts.send({ type: "model_update", sessionId, model, ...(typeof level === "string" ? { thinkingLevel: level } : {}) });
  }

  async function stop(): Promise<void> {
    if (finished) return;
    permissions.cancelAll();
    queue.clearAll();
    send({ type: "session_unregister", sessionId });
    finish(0);
  }

  return {
    start,
    handle: (m) =>
      handleServerMessage(m, {
        sessionId,
        send,
        sendPrompt,
        abort,
        setModel: (_provider, modelId) => setConfig("model", modelId, "model"),
        setThinkingLevel: (level) => setConfig("thought_level", level, "thinking level"),
        promptResponse: (r) => {
          permissions.respond(r.promptId, r.answer, r.cancelled);
        },
        clearFollowups: (i) => {
          queue.clear(i);
          publishQueue();
        },
        editFollowup: (i, text) => {
          if (queue.edit(i, text)) publishQueue();
        },
        removeFollowup: (i) => {
          if (queue.remove(i)) publishQueue();
        },
        promoteFollowup: (i) => {
          if (queue.promote(i)) publishQueue();
        },
        resyncState: () => {
          send(registerMessage("reattach"));
          publishModels();
          publishCommands();
          publishModelState();
          if (queue.length > 0) publishQueue();
        },
        publishModels,
        publishCommands,
        resyncPrompts: (id) => permissions.resend(id),
        stop: (reason, code) => {
          opts.log(`[acp:${agent.id}] stopping: ${reason}`);
          if (code === 0) stop().catch(() => {});
          else fail(reason, code);
        },
        ignored: () => {},
      }),
    disconnected: () => {
      connected = false;
    },
    reconnected,
    stop,
  };
}
