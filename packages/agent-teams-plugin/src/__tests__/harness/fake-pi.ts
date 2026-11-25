/**
 * Fake pi extension API for bridge tests: records tools, the active-tool list,
 * `sendMessage` calls and event handlers, and lets a test fire pi events. Plus
 * `linkBridge`, which activates the REAL bridge entry against the REAL server
 * request-lane handlers of a `TeamsEnv` (no process boundary) and turns the
 * host's `emitEventToSession` into `pi.events` events for that session.
 * See change: add-agent-teams-core.
 */
import { createBridge } from "../../bridge/index.js";
import { createLaneClient } from "../../bridge/lane.js";
import type { TeamToolDef } from "../../bridge/tools.js";
import type { TeamsEnv } from "./teams-env.js";

interface SentMessage {
  message: { customType: string; content: string; display: boolean; details?: Record<string, unknown> };
  options: { deliverAs?: string; triggerTurn?: boolean } | undefined;
}

type Handler = (event: unknown, ctx: unknown) => unknown;

class FakePi {
  readonly tools = new Map<string, TeamToolDef>();
  readonly registerOrder: string[] = [];
  active: string[] = ["read", "bash", "edit", "write"];
  readonly sent: SentMessage[] = [];
  readonly handlers = new Map<string, Handler[]>();
  private readonly busHandlers = new Map<string, Array<(payload: unknown) => void>>();
  /** Script `sendMessage` to throw (a failing steer). */
  throwOnSend = false;
  /** What `ctx.isIdle()` answers. */
  idle = true;
  sessionFile: string | undefined = "/sessions/fake.jsonl";
  /**
   * Like real pi: action methods throw "Extension runtime not initialized" until the
   * first event fires (`session_start`); only `registerTool`/`on`/`events` are load-safe.
   */
  private runtimeReady = false;

  private requireRuntime(): void {
    if (!this.runtimeReady) {
      throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
    }
  }

  readonly events = {
    on: (name: string, handler: (payload: unknown) => void): void => {
      this.busHandlers.set(name, [...(this.busHandlers.get(name) ?? []), handler]);
    },
    emit: (name: string, payload: unknown): void => {
      for (const h of this.busHandlers.get(name) ?? []) h(payload);
    },
  };

  on(event: string, handler: Handler): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }

  registerTool(def: TeamToolDef): void {
    this.tools.set(def.name, def);
    this.registerOrder.push(def.name);
    if (!this.active.includes(def.name)) this.active.push(def.name);
  }

  getActiveTools(): string[] {
    this.requireRuntime();
    return [...this.active];
  }

  setActiveTools(names: string[]): void {
    this.requireRuntime();
    this.active = [...names];
  }

  sendMessage(message: SentMessage["message"], options?: SentMessage["options"]): void {
    this.requireRuntime();
    if (this.throwOnSend) throw new Error("sendMessage failed");
    this.sent.push({ message, options });
  }

  get ctx(): { isIdle: () => boolean; sessionManager: { getSessionFile: () => string | undefined } } {
    return { isIdle: () => this.idle, sessionManager: { getSessionFile: () => this.sessionFile } };
  }

  /** Fire a pi event at every registered handler; returns the handlers' results. */
  async fire(event: string, payload: unknown = {}): Promise<unknown[]> {
    this.runtimeReady = true;
    const out: unknown[] = [];
    for (const h of this.handlers.get(event) ?? []) out.push(await h(payload, this.ctx));
    return out;
  }

  /** Active team tools among the registered ones. */
  get activeTeamTools(): string[] {
    return this.active.filter((n) => this.tools.has(n));
  }
}

/** Let the bridge's fire-and-forget lane work (hello/busy/idle/ack) finish. */
export const flushAsync = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

export interface LinkOptions {
  /** `process.env` as the bridge sees it (the spawn-time hint). */
  env?: Record<string, string | undefined>;
  /** Make lane requests fail at the transport level. */
  laneDown?: () => boolean;
  /** Reconnect watch: whether the host request lane is open, and how often to sample it. */
  laneUp?: () => boolean;
  laneWatchMs?: number;
}

/** Activate the real bridge for `who` against the real server handlers of `env`. */
export function linkBridge(env: TeamsEnv, who: string, opts: LinkOptions = {}) {
  const sid = env.sid(who);
  const pi = new FakePi();
  const requests: Array<{ type: string; payload: unknown }> = [];
  const lane = createLaneClient(async (_plugin, type, payload) => {
    requests.push({ type, payload });
    if (opts.laneDown?.()) return { ok: false, error: "unavailable" };
    return { ok: true, result: await env.fake.lane(sid, type, payload) };
  });
  env.fake.base.onEmit((e) => {
    if (e.sessionId === sid && e.delivered) pi.events.emit(e.eventType, e.data);
  });
  const bridge = createBridge(pi, {
    env: opts.env ?? {},
    lane,
    sleep: async () => undefined,
    // Default: never "up" so the watcher stays inert unless a test drives it.
    laneUp: opts.laneUp ?? (() => false),
    ...(opts.laneWatchMs !== undefined ? { laneWatchMs: opts.laneWatchMs } : {}),
  });
  return { pi, bridge, sid, requests, lane };
}
