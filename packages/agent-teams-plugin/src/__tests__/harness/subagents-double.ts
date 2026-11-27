/**
 * Recorded contract double of `@blackbelt-technology/pi-dashboard-subagents` (task 2.2): a tiny event bus plus an
 * installable fake extension that answers `subagents:capabilities`, `subagents:spawn`, `subagents:steer_request`,
 * `subagents:interrupt_request` and `subagents:stop` exactly as the contract in
 * `shared/subagents-contract.ts` records them — synchronous `out` for query/spawn, a `Promise` for steer/interrupt,
 * the CLAIM RULE (act only while `out` is unset, set it before returning; id-addressed requests answered only by the
 * activation that holds the id), managed children, a shared slot pool (`maxConcurrent`, 1-based queue positions),
 * and the event sequences incl. progress `started` emissions during a run and the SAME-TICK `completed|failed` + `idle`
 * of one run. `RECORDED_TRACES` is the data both this double and the live upstream (task 2.6 drift test) must produce.
 * No pi, no timers except via the injected fake clock.
 * See change: add-agent-teams-in-process.
 */

import type { Clock } from "../../shared/clock.js";
import type { CapabilitiesOut, InterruptRequest, SpawnOut, SpawnRequest, SteerRequest, SubagentsFeature } from "../../shared/subagents-contract.js";
import { REQUIRED_API_VERSION, REQUIRED_FEATURES, SUBAGENTS_CHANNEL } from "../../shared/subagents-contract.js";

type Listener = (payload: any) => void;

export interface DoubleBus {
  emit(channel: string, payload: unknown): void;
  on(channel: string, fn: Listener): () => void;
}

export function createDoubleBus(): DoubleBus {
  const handlers = new Map<string, Listener[]>();
  return {
    emit(channel, payload) {
      for (const fn of [...(handlers.get(channel) ?? [])]) fn(payload);
    },
    on(channel, fn) {
      handlers.set(channel, [...(handlers.get(channel) ?? []), fn]);
      return () => handlers.set(channel, (handlers.get(channel) ?? []).filter((h) => h !== fn));
    },
  };
}

/** A valid capabilities answer (all features, `maxConcurrent` 4); `over` replaces fields. */
export function validCapabilities(over: Partial<Extract<CapabilitiesOut, { apiVersion: number }>> & { features?: string[] } = {}): Extract<CapabilitiesOut, { apiVersion: number }> {
  return {
    apiVersion: REQUIRED_API_VERSION,
    features: [...REQUIRED_FEATURES, "loader_skills", "interrupt", "cwd_scope"],
    limits: { maxConcurrent: 4, maxBackgroundPending: 4, maxIdleBackground: 4, cwdScope: "repo" },
    ...over,
  };
}

type CapabilitiesMode = "sync" | "absent" | "never" | { delayMs: number };

export interface DoubleOptions {
  /** Timer source: the harness `FakeClock` in tests, `systemClock` in the qa fake extension (`qa/fixtures/fake-subagents.ext.ts`). */
  clock: Clock;
  /** Raw answer of the capabilities query (default `validCapabilities()`); may be anything (malformed answers). */
  answer?: unknown;
  capabilities?: CapabilitiesMode;
  /** Slot pool size for children (defaults to the answer's `limits.maxConcurrent`, else 4). */
  maxConcurrent?: number;
  /** Optional features the double implements for requests (default: all). */
  features?: readonly SubagentsFeature[];
  /** Label of this activation (two activations on one bus). */
  activation?: string;
}

type ChildState = "queued" | "running" | "idle";
interface Child {
  id: string;
  agentId: string;
  state: ChildState;
  run: number;
  managed: boolean;
  activation: string;
}

interface RecordedEvent {
  channel: string;
  payload: Record<string, unknown>;
}

export interface SubagentsDouble {
  readonly children: Map<string, Child>;
  /** Every event this activation emitted, in order. */
  readonly events: RecordedEvent[];
  /** Spawn requests the double saw (for whitelist assertions). */
  readonly spawnRequests: SpawnRequest["request"][];
  /** Replace the next spawn reply (consumed once); `undefined` ⇒ default behaviour. */
  nextSpawnReply(reply: SpawnOut | "empty"): void;
  /** Script the next steer result for any child (consumed once). */
  nextSteerResult(result: string | "empty" | "reject" | "pending" | { afterMs: number; result: string }): void;
  /** Script the next interrupt result (consumed once); the child is left untouched (a race with natural completion). */
  nextInterruptResult(result: "interrupted" | "not_running" | "not_alive" | "not_found" | "empty"): void;
  /** `subagents:started` while running (a progress emission when the child is already running). */
  emitStarted(agentId: string): void;
  /** One run ends: `completed {result}` (or `failed {error}`) then `idle {run}` in the SAME tick. */
  finishRun(agentId: string, outcome: { result?: string; error?: string; aborted?: boolean }): void;
  /** A queued child gets a slot and starts. */
  startQueued(agentId: string): void;
  dispose(agentId: string, reason: string): void;
  /** The capabilities answer actually served (after delay). */
  setAnswer(answer: unknown): void;
  /** Change how the capabilities query is answered from now on. */
  setCapabilities(mode: Exclude<CapabilitiesMode, "absent">): void;
  uninstall(): void;
}

let seq = 0;

export function installSubagentsDouble(bus: DoubleBus, opts: DoubleOptions): SubagentsDouble {
  const children = new Map<string, Child>();
  const events: RecordedEvent[] = [];
  const spawnRequests: SpawnRequest["request"][] = [];
  const activation = opts.activation ?? `act-${++seq}`;
  const features = new Set<SubagentsFeature>(opts.features ?? ["loader_skills", "interrupt", "cwd_scope"]);
  let answer: unknown = "answer" in opts ? opts.answer : validCapabilities();
  let mode: CapabilitiesMode = opts.capabilities ?? "sync";
  let pendingSpawnReply: SpawnOut | "empty" | undefined;
  let pendingSteer: string | { afterMs: number; result: string } | undefined;
  let pendingInterrupt: "interrupted" | "not_running" | "not_alive" | "not_found" | "empty" | undefined;
  let n = 0;
  const off: Array<() => void> = [];

  const maxConcurrent = (): number => {
    if (opts.maxConcurrent !== undefined) return opts.maxConcurrent;
    const a = answer as { limits?: { maxConcurrent?: unknown } } | undefined;
    return typeof a?.limits?.maxConcurrent === "number" ? a.limits.maxConcurrent : 4;
  };
  const running = (): number => [...children.values()].filter((c) => c.state === "running").length;
  const emit = (channel: string, payload: Record<string, unknown>): void => {
    events.push({ channel, payload });
    bus.emit(channel, payload);
  };

  if (mode !== "absent") {
    off.push(
      bus.on(SUBAGENTS_CHANNEL.capabilities, (q: { out?: unknown }) => {
        if (q.out !== undefined) return; // claim rule
        const m = mode;
        if (m === "sync" || m === "absent") q.out = answer;
        else if (m === "never") q.out = new Promise(() => {});
        else q.out = new Promise((resolve) => opts.clock.setTimeout(() => resolve(answer), m.delayMs));
      }),
    );
  }

  off.push(
    bus.on(SUBAGENTS_CHANNEL.spawn, (req: SpawnRequest) => {
      if (req.out !== undefined) return; // claim rule: another activation answered
      spawnRequests.push(req.request);
      const scripted = pendingSpawnReply;
      pendingSpawnReply = undefined;
      if (scripted === "empty") return; // handler "absent": no out
      if (scripted) {
        req.out = scripted;
        return;
      }
      const id = `bg-${activation}-${++n}`;
      const agentId = `agent-${activation}-${n}`;
      const free = running() < maxConcurrent();
      const child: Child = { id, agentId, state: free ? "running" : "queued", run: 0, managed: req.request.managed !== undefined, activation };
      children.set(agentId, child);
      const queuePosition = [...children.values()].filter((c) => c.state === "queued").length;
      req.out = { ok: true, id, agentId, status: free ? "running" : "queued", ...(free ? {} : { queuePosition }) };
      emit(SUBAGENTS_CHANNEL.created, { agentId });
      if (free) {
        child.run = 1;
        emit(SUBAGENTS_CHANNEL.started, { agentId, run: 1 });
      }
    }),
  );

  /** The child of this activation addressed by `id` (its `bg-…` id or its agent id). */
  const ownChild = (id: string): Child | undefined => {
    const child = [...children.values()].find((c) => c.id === id || c.agentId === id);
    return child?.activation === activation ? child : undefined;
  };

  /** The scripted answer of a steer (`undefined` ⇒ not scripted; `"empty"` ⇒ nobody answers). */
  const scriptedSteerOut = (scripted: NonNullable<typeof pendingSteer>): Promise<never> | undefined => {
    if (scripted === "reject") return Promise.reject(new Error("steer failed"));
    if (scripted === "pending") return new Promise(() => {});
    if (typeof scripted === "object") {
      // A slow answer (a child inside a long tool): resolved by the fake clock; a run started by it is not simulated.
      return new Promise((resolve) => opts.clock.setTimeout(() => resolve(scripted.result as never), scripted.afterMs));
    }
    return Promise.resolve(scripted as never);
  };

  off.push(
    bus.on(SUBAGENTS_CHANNEL.steerRequest, (req: SteerRequest) => {
      if (req.out !== undefined) return;
      const child = ownChild(req.id); // id-addressed: only the owning activation answers
      if (!child) return;
      const scripted = pendingSteer;
      pendingSteer = undefined;
      if (scripted === "empty") return;
      if (scripted) {
        req.out = scriptedSteerOut(scripted);
        return;
      }
      if (child.state === "running") req.out = Promise.resolve("queued");
      else if (child.state === "queued") req.out = Promise.resolve("not_started");
      else {
        child.state = "running";
        child.run++;
        req.out = Promise.resolve("started");
        emit(SUBAGENTS_CHANNEL.started, { agentId: child.agentId, run: child.run });
      }
    }),
  );

  if (features.has("interrupt")) {
    off.push(
      bus.on(SUBAGENTS_CHANNEL.interruptRequest, (req: InterruptRequest) => {
        if (req.out !== undefined) return;
        const child = ownChild(req.id);
        if (!child) return;
        const scripted = pendingInterrupt;
        pendingInterrupt = undefined;
        if (scripted === "empty") return;
        if (scripted) {
          req.out = Promise.resolve(scripted);
          return;
        }
        if (child.state !== "running") {
          req.out = Promise.resolve("not_running");
          return;
        }
        req.out = Promise.resolve("interrupted");
        child.state = "idle";
        emit(SUBAGENTS_CHANNEL.idle, { agentId: child.agentId, run: child.run, aborted: true });
      }),
    );
  }

  off.push(
    bus.on(SUBAGENTS_CHANNEL.stop, (msg: { agentId?: string }) => {
      const child = msg.agentId ? children.get(msg.agentId) : undefined;
      if (!child || child.activation !== activation) return; // unknown id: no event follows
      const wasRunning = child.state === "running";
      children.delete(child.agentId);
      if (wasRunning) emit(SUBAGENTS_CHANNEL.completed, { agentId: child.agentId, details: { status: "stopped", stoppedBy: "user" } });
      else emit("subagents:disposed", { agentId: child.agentId, reason: "cancel" });
    }),
  );

  const get = (agentId: string): Child => {
    const c = children.get(agentId);
    if (!c) throw new Error(`double: unknown child ${agentId}`);
    return c;
  };

  return {
    children,
    events,
    spawnRequests,
    nextSpawnReply(reply) {
      pendingSpawnReply = reply;
    },
    nextSteerResult(result) {
      pendingSteer = result;
    },
    nextInterruptResult(result) {
      pendingInterrupt = result;
    },
    emitStarted(agentId) {
      const c = get(agentId);
      emit(SUBAGENTS_CHANNEL.started, { agentId, run: c.run });
    },
    finishRun(agentId, outcome) {
      const c = get(agentId);
      c.state = "idle";
      if (outcome.error !== undefined) emit(SUBAGENTS_CHANNEL.failed, { agentId, error: outcome.error });
      else emit(SUBAGENTS_CHANNEL.completed, { agentId, result: outcome.result ?? "" });
      emit(SUBAGENTS_CHANNEL.idle, { agentId, run: c.run, ...(outcome.aborted ? { aborted: true } : {}) });
    },
    startQueued(agentId) {
      const c = get(agentId);
      c.state = "running";
      c.run = Math.max(1, c.run);
      emit(SUBAGENTS_CHANNEL.started, { agentId, run: c.run });
    },
    dispose(agentId, reason) {
      children.delete(agentId);
      emit("subagents:disposed", { agentId, reason });
    },
    setAnswer(next) {
      answer = next;
    },
    setCapabilities(next) {
      mode = next;
    },
    uninstall() {
      for (const o of off.splice(0)) o();
    },
  };
}

/**
 * The recorded contract traces (task 2.6 drift guard): for each scenario the ordered event channels one request
 * produces and the shape of its synchronous reply. The double must reproduce them; the live upstream is compared with
 * the same data when it is installed.
 */
export const RECORDED_TRACES = {
  /** One run ends with an answer: both events of a run arrive in the SAME synchronous emit sequence. */
  completedThenIdleSameTick: ["subagents:completed", "subagents:idle"],
  failedThenIdleSameTick: ["subagents:failed", "subagents:idle"],
  /** A queued child gets its slot, later a progress `started` while running (must not count as a new run). */
  spawnRunning: ["subagents:created", "subagents:started"],
  spawnQueued: ["subagents:created"],
  stopIdle: ["subagents:disposed"],
  stopUnknown: [] as string[],
} as const;
