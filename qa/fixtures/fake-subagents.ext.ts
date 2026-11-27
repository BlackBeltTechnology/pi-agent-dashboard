/**
 * pi extension fixture: FAKE `pi-dashboard-subagents` (test-only, opt-in).
 *
 * Implements the RECORDED `agent-teams-subagents-contract` on the shared pi event bus so the agent-teams in-process
 * mode can be driven end to end (real lead `pi`, real dashboard server, real bridge host) before the upstream release
 * of task 1.11 exists (decision B105, task 2.7). It REUSES the recorded contract double of the plugin harness
 * (`installSubagentsDouble`: capability answer, spawn replies, claim rule, slot pool + 1-based queue positions, steer,
 * interrupt, stop, the created/started/completed|failed+idle/disposed sequences incl. progress `started` emissions)
 * and only adds what a real child would do by itself: a SCRIPT per child that ends its runs on a timer.
 *
 * Loading (never installed for normal runs):
 *   - qa L2 : `pi --mode rpc -e qa/fixtures/fake-subagents.ext.ts ...` on the LEAD only.
 *   - docker harness: `PI_FAKE_SUBAGENTS=1` makes `docker/test-entrypoint.sh` stage a re-export wrapper under
 *     `~/.pi/agent/extensions/fake-subagents/` and skip the real subagents package (the two must never coexist:
 *     the claim rule gives the first activation the answer).
 *
 * Child script, from a sentinel in the spawn prompt (default `FAKE_SUBAGENTS_RUN_MS`, 1500 ms per run):
 *   `[[fake-run:<ms>]]`   each run ends `<ms>` after it starts (completed + idle in the same tick)
 *   `[[fake-run:forever]]` the run never ends by itself (stop / interrupt / steer / lead end only)
 *   `[[fake-run:fail:<ms>]]` each run ends with `failed` + idle
 *   `[[fake-block:<ms>]]`  the LEAD event loop is blocked for `<ms>` when the child starts (design Risks: shared
 *                          crash/CPU domain, test-plan S101). `FAKE_SUBAGENTS_BLOCK_MS` does it once, for the first child.
 *
 * Environment (all optional):
 *   FAKE_SUBAGENTS_RUN_MS         default run length (ms)
 *   FAKE_SUBAGENTS_MAX_CONCURRENT slot pool size and the answered `limits.maxConcurrent` (default 4)
 *   FAKE_SUBAGENTS_PROGRESS_MS    progress `started` emission cadence while a run is active (default 0 = off)
 *   FAKE_SUBAGENTS_BLOCK_MS       one-shot event-loop block at the first child start (default 0 = off)
 *   FAKE_SUBAGENTS_LAG_PROBE_MS   event-loop lag probe interval (default 0 = off); max gap lands in the state file
 *   FAKE_SUBAGENTS_STATE_FILE     JSON state (children, event counters, loop gap, activation count) rewritten on change,
 *                                 so a qa script can observe the "upstream list" without a bus.
 *
 * FIDELITY BOUNDARY: proves the dashboard side (lead bridge host, command channel, server mode, snapshot) against the
 * RECORDED contract. It does NOT prove that the real package behaves like the recording (task 2.6 drift test / gate
 * 1.11) and has no child boot cost, token use or per-child heap.
 *
 * See change: add-agent-teams-in-process (test-plan "Fake subagents fixture", decision B105).
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DoubleBus, SubagentsDouble } from "../../packages/agent-teams-plugin/src/__tests__/harness/subagents-double.js";
import { installSubagentsDouble, validCapabilities } from "../../packages/agent-teams-plugin/src/__tests__/harness/subagents-double.js";
import { type Clock, systemClock } from "../../packages/agent-teams-plugin/src/shared/clock.js";
import { SUBAGENTS_CHANNEL } from "../../packages/agent-teams-plugin/src/shared/subagents-contract.js";

export interface FakeSubagentsConfig {
  runMs: number;
  maxConcurrent: number;
  progressMs: number;
  blockMs: number;
  lagProbeMs: number;
  stateFile?: string;
}

export type ChildScript = { kind: "run"; ms: number } | { kind: "fail"; ms: number } | { kind: "forever" };

const num = (v: string | undefined, fallback: number, min = 0): number => {
  const n = v === undefined || v === "" ? Number.NaN : Number(v);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
};

export function configFromEnv(env: Record<string, string | undefined> = process.env): FakeSubagentsConfig {
  return {
    runMs: num(env.FAKE_SUBAGENTS_RUN_MS, 1500),
    maxConcurrent: num(env.FAKE_SUBAGENTS_MAX_CONCURRENT, 4, 1),
    progressMs: num(env.FAKE_SUBAGENTS_PROGRESS_MS, 0),
    blockMs: num(env.FAKE_SUBAGENTS_BLOCK_MS, 0),
    lagProbeMs: num(env.FAKE_SUBAGENTS_LAG_PROBE_MS, 0),
    ...(env.FAKE_SUBAGENTS_STATE_FILE ? { stateFile: env.FAKE_SUBAGENTS_STATE_FILE } : {}),
  };
}

const RUN_SENTINEL = /\[\[fake-run:(?:(forever)|(fail):(\d+)|(\d+))\]\]/;
const BLOCK_SENTINEL = /\[\[fake-block:(\d+)\]\]/;

/** The script of a child from its spawn prompt (pure; an absent / malformed sentinel is the default run). */
export function parseChildScript(prompt: string | undefined, defaultRunMs: number): { run: ChildScript; blockMs?: number } {
  const text = typeof prompt === "string" ? prompt : "";
  const r = RUN_SENTINEL.exec(text);
  const run: ChildScript = r ? (r[1] ? { kind: "forever" } : r[2] ? { kind: "fail", ms: Number(r[3]) } : { kind: "run", ms: Number(r[4]) }) : { kind: "run", ms: defaultRunMs };
  const b = BLOCK_SENTINEL.exec(text);
  return { run, ...(b ? { blockMs: Number(b[1]) } : {}) };
}

/** Busy-wait: the shared-process starvation of test-plan S101 (blocks timers, sockets and the bridge heartbeat alike). */
export function busyWait(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

export interface FakeSubagentsOptions {
  clock?: Clock;
  /** Event-loop blocker (default `busyWait`); a unit test stubs it. */
  block?: (ms: number) => void;
}

export interface FakeSubagentsState {
  activation: number;
  pid: number;
  updatedAt: number;
  maxConcurrent: number;
  /** Children the "upstream" currently holds, by agent id. */
  children: Record<string, { id: string; state: string; run: number; managed: boolean }>;
  /** Events this activation emitted, per channel. */
  events: Record<string, number>;
  /** Event-loop probe (only with `lagProbeMs`): the largest gap beyond the interval, and the tick count. */
  loop?: { probeMs: number; maxGapMs: number; ticks: number };
  shutdown?: boolean;
}

export interface FakeSubagents {
  readonly double: SubagentsDouble;
  state(): FakeSubagentsState;
  /** Dispose every child (`disposed: shutdown`), stop timers and handlers, flush the state file. */
  shutdown(): void;
}

const EVENT_CHANNELS = [
  SUBAGENTS_CHANNEL.created,
  SUBAGENTS_CHANNEL.started,
  SUBAGENTS_CHANNEL.completed,
  SUBAGENTS_CHANNEL.failed,
  SUBAGENTS_CHANNEL.idle,
  SUBAGENTS_CHANNEL.disposed,
] as const;

/** Install the fake on `bus`: the contract double plus per-child scripts, slot promotion, state file and lag probe. */
export function installFakeSubagents(bus: DoubleBus, cfg: FakeSubagentsConfig, activation = 1, opts: FakeSubagentsOptions = {}): FakeSubagents {
  const clock = opts.clock ?? systemClock;
  const block = opts.block ?? busyWait;
  const double = installSubagentsDouble(bus, {
    clock,
    maxConcurrent: cfg.maxConcurrent,
    answer: validCapabilities({ limits: { maxConcurrent: cfg.maxConcurrent, maxBackgroundPending: 4, maxIdleBackground: 4, cwdScope: "repo" } }),
  });
  const scripts = new Map<string, ChildScript>();
  const blocks = new Map<string, number>();
  const armedRun = new Map<string, number>();
  const counts: Record<string, number> = {};
  let blockOnce = cfg.blockMs > 0;
  let down = false;
  let loop: FakeSubagentsState["loop"];
  let writeTimer: unknown;
  const off: Array<() => void> = [];

  const state = (): FakeSubagentsState => ({
    activation,
    pid: process.pid,
    updatedAt: Date.now(),
    maxConcurrent: cfg.maxConcurrent,
    children: Object.fromEntries([...double.children.values()].map((c) => [c.agentId, { id: c.id, state: c.state, run: c.run, managed: c.managed }])),
    events: { ...counts },
    ...(loop ? { loop: { ...loop } } : {}),
    ...(down ? { shutdown: true } : {}),
  });

  const flush = (): void => {
    writeTimer = undefined;
    if (!cfg.stateFile) return;
    try {
      const tmp = `${cfg.stateFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(state()));
      renameSync(tmp, cfg.stateFile);
    } catch {
      /* the state file is an observation aid: never break the lead */
    }
  };
  const touch = (): void => {
    if (!cfg.stateFile || writeTimer !== undefined) return;
    writeTimer = clock.setTimeout(flush, 100);
    (writeTimer as { unref?: () => void } | undefined)?.unref?.();
  };

  const later = (fn: () => void, ms: number): void => {
    const h = clock.setTimeout(() => {
      if (!down) fn();
    }, ms);
    (h as { unref?: () => void } | undefined)?.unref?.();
  };

  /** Give every queued child a slot while one is free (a finished / stopped / disposed child frees it). */
  const promote = (): void => {
    for (const c of [...double.children.values()]) {
      if ([...double.children.values()].filter((x) => x.state === "running").length >= cfg.maxConcurrent) return;
      if (c.state === "queued") double.startQueued(c.agentId);
    }
  };

  const arm = (agentId: string, run: number): void => {
    const child = double.children.get(agentId);
    if (child?.state !== "running" || child.run !== run || armedRun.get(agentId) === run) return;
    armedRun.set(agentId, run);
    const script = scripts.get(agentId) ?? { kind: "run", ms: cfg.runMs };
    const live = (): boolean => double.children.get(agentId)?.state === "running" && double.children.get(agentId)?.run === run;
    if (cfg.progressMs > 0) {
      const tick = (): void => {
        if (!live()) return;
        double.emitStarted(agentId); // a progress emission: the bridge must NOT count it as a new run
        later(tick, cfg.progressMs);
      };
      later(tick, cfg.progressMs);
    }
    if (script.kind !== "forever") {
      later(() => {
        if (!live()) return;
        if (script.kind === "fail") double.finishRun(agentId, { error: `FAKE_CHILD_FAILED ${agentId} run ${run}` });
        else double.finishRun(agentId, { result: `FAKE_CHILD_DONE ${agentId} run ${run}` });
      }, script.ms);
    }
    const blockMs = blocks.get(agentId) ?? (blockOnce ? cfg.blockMs : 0);
    if (blockMs > 0) {
      blockOnce = false;
      blocks.delete(agentId);
      later(() => block(blockMs), 0); // after the spawn reply and `started` have returned
    }
  };

  off.push(
    bus.on(SUBAGENTS_CHANNEL.spawn, (req: { request: { prompt?: string }; out?: { ok?: boolean; agentId?: string } }) => {
      // Registered after the double's handler: `out` is set by now when the double (or nobody else) claimed it.
      if (req.out?.ok !== true || typeof req.out.agentId !== "string") return;
      const parsed = parseChildScript(req.request.prompt, cfg.runMs);
      scripts.set(req.out.agentId, parsed.run);
      if (parsed.blockMs) blocks.set(req.out.agentId, parsed.blockMs);
    }),
  );
  for (const channel of EVENT_CHANNELS) {
    off.push(
      bus.on(channel, (ev: { agentId?: string; run?: number }) => {
        counts[channel] = (counts[channel] ?? 0) + 1;
        if (channel === SUBAGENTS_CHANNEL.started && typeof ev.agentId === "string" && typeof ev.run === "number") {
          const { agentId, run } = ev;
          later(() => arm(agentId, run), 0); // the script of a child is stored right after the double's spawn handler returned
        }
        if (channel !== SUBAGENTS_CHANNEL.created && channel !== SUBAGENTS_CHANNEL.started) later(promote, 0);
        touch();
      }),
    );
  }

  if (cfg.lagProbeMs > 0) {
    loop = { probeMs: cfg.lagProbeMs, maxGapMs: 0, ticks: 0 };
    let last = Date.now();
    const probe = (): void => {
      const now = Date.now();
      if (loop) {
        loop.ticks++;
        loop.maxGapMs = Math.max(loop.maxGapMs, now - last - cfg.lagProbeMs);
      }
      last = now;
      touch();
      later(probe, cfg.lagProbeMs);
    };
    later(probe, cfg.lagProbeMs);
  }
  touch();

  return {
    double,
    state,
    shutdown() {
      if (down) return;
      for (const id of [...double.children.keys()]) double.dispose(id, "shutdown");
      down = true;
      for (const o of off.splice(0)) o();
      double.uninstall();
      flush();
    },
  };
}

/** Activation counter that survives a `/reload` (a fresh extension runtime): read from the previous state file. */
function nextActivation(stateFile: string | undefined): number {
  if (!stateFile) return 1;
  try {
    const prev = JSON.parse(readFileSync(stateFile, "utf8")) as { activation?: unknown };
    return typeof prev.activation === "number" ? prev.activation + 1 : 1;
  } catch {
    return 1;
  }
}

export default function fakeSubagents(pi: ExtensionAPI): void {
  const bus = pi.events;
  if (!bus) return;
  const cfg = configFromEnv();
  const fake = installFakeSubagents(bus as unknown as DoubleBus, cfg, nextActivation(cfg.stateFile));
  // Children are in-memory sessions of the lead: they never outlive its runtime (reload, /new, shutdown).
  pi.on("session_shutdown", () => fake.shutdown());
}
