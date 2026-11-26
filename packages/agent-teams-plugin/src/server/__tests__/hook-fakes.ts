/**
 * Test doubles for the hook modules: a fake process boundary (`FakeProcs`: scripted children on the
 * injected clock, probes for concurrency / kills) and a gate harness that builds the hook gates over
 * minimal fakes of the store, ops and clock — deterministic, no runtime needed.
 * See change: add-agent-teams-templates-hooks.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeClock } from "../../__tests__/harness/index.js";
import { capturingLogger } from "../../__tests__/harness/store-env.js";
import type { Member, Task, Team, TeamHooks } from "../../shared/types.js";
import { createConfigReader } from "../config.js";
import type { OpGateInput } from "../extension-points.js";
import { createHookEngine, type HookEngine } from "../hook-engine.js";
import type { HookIo } from "../hook-run.js";
import { createHookGates, type HookGates } from "../hooks.js";
import { createPluginCounters, type TemplatesHooksDeps } from "../templates-hooks.js";

// ── fake process boundary ───────────────────────────────────────────────────────

class FakeStream extends EventEmitter {
  text = "";
  end(data?: string): void {
    if (typeof data === "string") this.text += data;
  }
}

export class FakeChild extends EventEmitter {
  readonly stdin = new FakeStream();
  readonly stdout = new FakeStream();
  readonly stderr = new FakeStream();
  finished = false;
  readonly pid: number | undefined;
  constructor(pid: number | undefined) {
    super();
    this.pid = pid;
  }
  /** Deliver output, then `exit` + `close` (exactly what node emits for a finished child). */
  finish(code: number | null, out: { stdout?: string | Buffer; stderr?: string | Buffer } = {}): void {
    if (this.finished) return;
    this.finished = true;
    if (out.stdout !== undefined) this.stdout.emit("data", Buffer.from(out.stdout));
    if (out.stderr !== undefined) this.stderr.emit("data", Buffer.from(out.stderr));
    this.emit("exit", code, null);
    this.emit("close", code, null);
  }
}

export interface FakeSpawn {
  command: string;
  args: readonly string[];
  cwd: string | undefined;
  env: Record<string, string>;
  child: FakeChild;
  /** Fake-clock time of the spawn. */
  at: number;
  /** The stdin JSON the hook received. */
  stdin(): string;
}

export interface FakeScript {
  code: number | null;
  stderr?: string | Buffer;
  stdout?: string | Buffer;
  afterMs?: number;
}

export class FakeProcs {
  readonly spawns: FakeSpawn[] = [];
  readonly kills: number[] = [];
  peakAlive = 0;
  /** Called for every new child: schedule its exit on the clock. */
  onSpawn: (s: FakeSpawn) => void = () => {};
  /** Make the next spawn throw this error. */
  throwNext: NodeJS.ErrnoException | undefined;
  /** Make every spawn emit an async `error` instead of starting (ENOENT cwd). */
  errorCode: string | undefined;
  private nextPid = 1000;

  readonly clock: FakeClock;
  private readonly envSource: NodeJS.ProcessEnv;
  constructor(clock: FakeClock, envSource: NodeJS.ProcessEnv = { PATH: "/usr/bin" }) {
    this.clock = clock;
    this.envSource = envSource;
  }

  get alive(): number {
    return this.spawns.filter((s) => !s.child.finished).length;
  }

  /** Script each child by spawn index (the last entry repeats): exit `code` with output after `afterMs` fake ms (0 = next microtask). */
  script(plan: FakeScript[] | ((index: number) => FakeScript)): void {
    this.onSpawn = (s) => {
      const i = this.spawns.indexOf(s);
      const sc = typeof plan === "function" ? plan(i) : (plan[Math.min(i, plan.length - 1)] as FakeScript);
      const fire = () => s.child.finish(sc.code, { ...(sc.stdout !== undefined ? { stdout: sc.stdout } : {}), ...(sc.stderr !== undefined ? { stderr: sc.stderr } : {}) });
      if (sc.afterMs) void this.clock.setTimeout(fire, sc.afterMs);
      else queueMicrotask(fire);
    };
  }

  /** Exit every child after `ms` of fake time with `code` / `stderr`. */
  exitAfter(ms: number, code = 0, stderr?: string): void {
    this.onSpawn = (s) => void this.clock.setTimeout(() => s.child.finish(code, stderr !== undefined ? { stderr } : {}), ms);
  }

  io(): HookIo {
    return {
      env: () => this.envSource,
      spawn: (command, args, options) => {
        if (this.throwNext) {
          const err = this.throwNext;
          this.throwNext = undefined;
          throw err;
        }
        const child = new FakeChild(this.errorCode ? undefined : this.nextPid++);
        const spawn: FakeSpawn = { command, args, cwd: options.cwd as string | undefined, env: options.env as Record<string, string>, child, at: this.clock.now(), stdin: () => child.stdin.text };
        this.spawns.push(spawn);
        this.peakAlive = Math.max(this.peakAlive, this.alive);
        if (this.errorCode) {
          const code = this.errorCode;
          queueMicrotask(() => child.emit("error", Object.assign(new Error(`spawn bash ${code}`), { code })));
        } else this.onSpawn(spawn);
        return child as never;
      },
      killTree: async (pid) => {
        this.kills.push(pid);
        for (const s of this.spawns) if (s.child.pid === pid) s.child.finish(null);
      },
    };
  }
}

// ── gate harness ────────────────────────────────────────────────────────────────

export interface Harness {
  clock: FakeClock;
  deps: TemplatesHooksDeps;
  engine: HookEngine;
  gates: HookGates;
  logs: ReturnType<typeof capturingLogger>["logs"];
  notices: Array<{ teamId: string; text: string; wake: boolean }>;
  mails: Array<{ teamId: string; to: string; kind: string; text: string; wake: boolean }>;
  teams: Map<string, Team>;
  wake: { seq: number };
  makeTeam(over?: Partial<Team> & { hooks?: TeamHooks }): Team;
  input(op: string, team: Team, callerName: string, args?: unknown, extra?: Partial<OpGateInput>): OpGateInput;
  idleInput(team: Team, member: string, idle?: Partial<NonNullable<OpGateInput["idle"]>>): OpGateInput;
}

export function tmpCwd(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-teams-hook-")));
}

export function task(over: Partial<Task> & { id: string }): Task {
  return { title: "t", description: "d", status: "in_progress", owner: "alice", blockedBy: [], createdBy: "lead", createdAt: 0, ...over };
}

export function member(name: string, over: Partial<Member> = {}): Member {
  return { name, spawnToken: `tok-${name}`, cwd: "/work", status: "busy", guardActive: true, noMcp: true, noContextFiles: true, lastSettleId: 0, ...over };
}

export function createHarness(opts: { io: HookIo; clock?: FakeClock; config?: Record<string, unknown>; cwd?: string }): Harness {
  const clock = opts.clock ?? new FakeClock(1_700_000_000_000);
  const { logger, logs } = capturingLogger();
  const config = createConfigReader(() => opts.config, logger);
  const teams = new Map<string, Team>();
  const notices: Harness["notices"] = [];
  const mails: Harness["mails"] = [];
  const wake = { seq: 0 };
  const deps = {
    clock,
    logger,
    config,
    counters: createPluginCounters(),
    store: {
      get: (id: string) => teams.get(id),
      member: (team: Team, name: string) => team.members.find((m) => m.name === name),
    },
    ops: {
      enqueueLeadNotice: (team: Team, i: { text: string; wake: boolean }) => void notices.push({ teamId: team.id, text: i.text, wake: i.wake }),
      sendServerMail: (team: Team, to: string, i: { kind: string; text: string; wake: boolean }) => {
        mails.push({ teamId: team.id, to, kind: i.kind, text: i.text, wake: i.wake });
        return { ok: true as const, data: { mailId: mails.length } };
      },
    },
  } as unknown as TemplatesHooksDeps;
  const engine = createHookEngine(deps, opts.io);
  const gates = createHookGates(deps, engine);
  let n = 0;
  const h: Harness = {
    clock,
    deps,
    engine,
    gates,
    logs,
    notices,
    mails,
    teams,
    wake,
    makeTeam(over = {}) {
      const id = over.id ?? `t${++n}`;
      const team: Team = {
        id,
        name: "alpha",
        leadConnected: true,
        leadCwd: opts.cwd ?? "/work",
        mode: "session",
        status: "active",
        committer: "lead",
        maxTeammates: 4,
        members: [member("alice"), member("bob"), member("carol")],
        tasks: [task({ id: "3", title: "Ship it", description: "do $(touch x)", owner: "alice" })],
        nextTaskId: 4,
        nextMailId: 1,
        createdAt: 0,
        schemaVersion: 1,
        ...over,
      };
      teams.set(id, team);
      return team;
    },
    input(op, team, callerName, args = {}, extra = {}) {
      return { op, team, callerName, args, ...extra };
    },
    idleInput(team, who, idle = {}) {
      return { op: "TeammateIdle", team, callerName: who, args: {}, idle: { settleId: 1, ...idle }, wakeSeq: { at: wake.seq, read: () => wake.seq } };
    },
  };
  return h;
}

/** Let promise continuations (several turns) run. */
export async function flush(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

/** Real wait (real bash children report on real time). */
export const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** An io that forwards to `get()` lazily (the runtime is created before the procs need its clock). */
export function lazyIo(get: () => FakeProcs): HookIo {
  return {
    spawn: (c, a, o) => get().io().spawn(c, a, o),
    killTree: (pid) => get().io().killTree(pid),
    env: () => get().io().env(),
  };
}

export async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!(await cond())) {
    if (Date.now() > until) throw new Error("waitFor timed out");
    await realSleep(10);
  }
}

/** Advance the fake clock after letting pending continuations register their timers (and once more after). */
export async function advance(clock: FakeClock, ms: number): Promise<void> {
  await flush(40);
  await clock.advanceAsync(ms);
  await flush(40);
}
