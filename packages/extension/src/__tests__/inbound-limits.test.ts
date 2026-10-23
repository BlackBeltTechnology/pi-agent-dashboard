/**
 * Inbound bounds (B21): bash concurrency per session + one prompt bucket per
 * connection across every turn-starting command.
 *
 * Covers test-plan BE10–BE16, BP1–BP4, BX5.
 * See change: harden-bridge-inbound-and-discovery (D17).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCommandHandler, tryExecSlashTemplate } from "../command-handler.js";
import {
  createInboundLimits,
  DEFAULT_MAX_BASH,
  DEFAULT_PROMPT_BURST,
  DEFAULT_PROMPT_REFILL_PER_SEC,
} from "../inbound-limits.js";
import {
  PEAK_CONCURRENT_BASH,
  PEAK_PROMPT_BURST,
  PEAK_PROMPTS_PER_SEC,
  RELOAD_FANOUT_SESSIONS,
} from "./helpers/bridge-inbound-peaks.js";
import { makeStubInstance } from "./helpers/bridge-instance-stub.js";

const registryMock = vi.hoisted(() => ({ bash: { ok: true, path: "/usr/bin/bash" } as { ok: boolean; path: string | null } }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js", () => ({
  getDefaultRegistry: () => ({
    resolve: (name: string) =>
      name === "bash"
        ? { name, ok: registryMock.bash.ok, path: registryMock.bash.path, source: "system", tried: [], resolvedAt: 0 }
        : { name, ok: false, path: null, source: null, tried: [], resolvedAt: 0 },
  }),
}));
vi.mock("../bridge.js", () => {
  throw new Error("bridge.ts (the entry point) was loaded by an extracted handler module");
});
vi.mock("../provider-register.js", () => ({
  reloadProviders: vi.fn(async () => ({ added: [], removed: [], changed: [] })),
  buildProviderCatalogue: vi.fn(() => []),
  toModelInfo: vi.fn((m: unknown) => m),
}));
vi.mock("../model-refresh.js", () => ({ refreshAfterCredentialsReload: vi.fn(async () => {}) }));

const dispatchModule = import("../bridge-handlers/dispatch.js");

// ── bash concurrency ─────────────────────────────────────────────────────────────────────

/** A pi whose `exec` never resolves until `finish()`; collects each pending call. */
function deferredPi() {
  const pending: Array<(r: { stdout: string; stderr: string; exitCode: number }) => void> = [];
  const rejecters: Array<(e: Error) => void> = [];
  const exec = vi.fn(
    () => new Promise<{ stdout: string; stderr: string; exitCode: number }>((res, rej) => { pending.push(res); rejecters.push(rej); }),
  );
  return {
    pi: { sendUserMessage: vi.fn(), getCommands: vi.fn().mockReturnValue([]), on: vi.fn(), exec } as any,
    exec,
    finish: (i = 0, exitCode = 0) => pending[i]({ stdout: "ok", stderr: "", exitCode }),
    fail: (i = 0, err = new Error("spawn ENOENT")) => rejecters[i](err),
  };
}

const feedbackOf = (sink: ReturnType<typeof vi.fn>) =>
  sink.mock.calls
    .map((c) => c[0])
    .filter((m) => m?.type === "event_forward" && m.event?.eventType === "command_feedback")
    .map((m) => m.event.data as { command: string; status: string; message: string });

const send = (text: string, sessionId = "s1") => ({ type: "send_prompt" as const, sessionId, text });
const tick = () => new Promise((r) => setImmediate(r));

describe("bash concurrency bound", () => {
  beforeEach(() => { registryMock.bash = { ok: true, path: "/usr/bin/bash" }; });

  it("BE10: N-1 and N accepted, N+1 (`!` and `!!`) refused visibly with the limit", async () => {
    const N = 3;
    const { pi, exec } = deferredPi();
    const sink = vi.fn();
    const limits = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_MAX_BASH: String(N) } });
    const handler = createCommandHandler(pi, "s1", { eventSink: sink, limits });

    for (let i = 0; i < N; i++) void handler.handle(send(`!sleep ${i}`));
    await tick();
    expect(exec).toHaveBeenCalledTimes(N);
    expect(feedbackOf(sink)).toEqual([]);

    void handler.handle(send("!sleep 99"));
    void handler.handle(send("!!sleep 99"));
    await tick();
    expect(exec).toHaveBeenCalledTimes(N); // not spawned
    const fb = feedbackOf(sink);
    expect(fb).toHaveLength(2); // one per refusal; `!!` shares the bound
    for (const f of fb) {
      expect(f.status).toBe("error");
      expect(f.message).toContain("concurrency");
      expect(f.message).toContain(String(N));
    }
  });

  describe("exec templates share the counter", () => {
    const tmpDir = join(import.meta.dirname ?? __dirname, "__tmp_inbound_limits__");
    const promptsDir = join(tmpDir, ".pi", "prompts");
    beforeEach(() => {
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(join(promptsDir, "dash-run.md"), "---\nexecutable: bash\n---\necho hi");
    });
    afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

    it("BE11: `!` + exec fill N=2; a third of either kind is refused; below the limit it starts", async () => {
      const { pi, exec, finish } = deferredPi();
      const sink = vi.fn();
      const limits = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_MAX_BASH: "2" } });
      const handler = createCommandHandler(pi, "s1", { eventSink: sink, limits });

      void handler.handle(send("!sleep 1")); // 1 of 2
      await tick();
      const ranExec = tryExecSlashTemplate(pi, "/dash-run", tmpDir, "s1", sink, limits); // 2 of 2
      await tick();
      expect(exec).toHaveBeenCalledTimes(2);

      expect(await tryExecSlashTemplate(pi, "/dash-run", tmpDir, "s1", sink, limits)).toBe(true); // 3rd exec: refused
      void handler.handle(send("!sleep 3")); // 3rd `!`: refused
      await tick();
      expect(exec).toHaveBeenCalledTimes(2);
      const fb = feedbackOf(sink);
      expect(fb).toHaveLength(2);
      expect(fb.every((f) => f.message.includes("concurrency limit reached"))).toBe(true);

      finish(1); // the exec template completes → below the limit
      await ranExec;
      const third = tryExecSlashTemplate(pi, "/dash-run", tmpDir, "s1", sink, limits);
      await tick();
      expect(exec).toHaveBeenCalledTimes(3);
      finish(2);
      expect(await third).toBe(true);
    });

    it("BE11: zero in flight starts normally", async () => {
      const { pi, exec, finish } = deferredPi();
      const limits = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_MAX_BASH: "2" } });
      const p = tryExecSlashTemplate(pi, "/dash-run", tmpDir, "s1", vi.fn(), limits);
      await tick();
      expect(exec).toHaveBeenCalledTimes(1);
      finish(0);
      await p;
    });
  });

  it("BE12: the limit is per session; a finished command frees the slot", async () => {
    const { pi, exec, finish } = deferredPi();
    const sink = vi.fn();
    const limits = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_MAX_BASH: "1" } });
    const h1 = createCommandHandler(pi, "s1", { eventSink: sink, limits });
    const h2 = createCommandHandler(pi, "s2", { eventSink: sink, limits });

    const first = h1.handle(send("!one"));
    await tick();
    void h1.handle(send("!refused")); // s1 at its limit
    await tick();
    expect(feedbackOf(sink)).toHaveLength(1);

    void h2.handle(send("!other", "s2")); // s2 unaffected
    await tick();
    expect(exec).toHaveBeenCalledTimes(2);

    finish(0, 0);
    await first;
    void h1.handle(send("!echo"));
    await tick();
    expect(exec).toHaveBeenCalledTimes(3);
    expect(feedbackOf(sink)).toHaveLength(1); // no new refusal
  });

  it("BX5: every exit path frees the slot", async () => {
    const limits = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_MAX_BASH: "1" } });
    const endings: Array<[string, (d: ReturnType<typeof deferredPi>) => void]> = [
      ["exit 0", (d) => d.finish(0, 0)],
      ["non-zero exit", (d) => d.finish(0, 2)],
      ["spawn error (ENOENT)", (d) => d.fail(0)],
      ["timeout kill", (d) => d.fail(0, new Error("Command timed out after 30000ms"))],
      ["session abort", (d) => d.fail(0, new Error("aborted"))],
    ];
    for (const [label, end] of endings) {
      const d = deferredPi();
      const sink = vi.fn();
      const handler = createCommandHandler(d.pi, "s1", { eventSink: sink, limits });
      const running = handler.handle(send("!first"));
      await tick();
      end(d);
      await running;
      expect(limits.bashInFlight("s1"), label).toBe(0);
      void handler.handle(send("!echo"));
      await tick();
      expect(d.exec, label).toHaveBeenCalledTimes(2);
      expect(feedbackOf(sink), label).toEqual([]);
      d.finish(1);
      await tick();
    }
  });

  it("BP4: 100k mixed acquire/release/double-release cycles leave no residue and no timers", () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const limits = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_MAX_BASH: "3" } });
    const conns = Array.from({ length: 20 }, () => ({}));
    for (let i = 0; i < 100_000; i++) {
      const sid = `s${i % 50}`;
      const a = limits.tryAcquireBash(sid);
      const b = limits.tryAcquireBash(sid);
      limits.takePrompt(conns[i % conns.length]);
      a?.();
      a?.(); // double release is a no-op
      b?.();
    }
    for (let s = 0; s < 50; s++) expect(limits.bashInFlight(`s${s}`)).toBe(0);
    expect(timers).not.toHaveBeenCalled();
    timers.mockRestore();
  });
});

// ── env configuration ────────────────────────────────────────────────────────────────────

describe("BE16: configuration", () => {
  it("valid overrides are enforced exactly", async () => {
    for (const n of [1, 8]) {
      const limits = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_MAX_BASH: String(n) } });
      const held = Array.from({ length: n }, () => limits.tryAcquireBash("s"));
      expect(held.every(Boolean)).toBe(true);
      expect(limits.tryAcquireBash("s")).toBeUndefined();
    }
    let t = 0;
    const rate = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_PROMPT_RATE: "5/2" }, now: () => t });
    const conn = {};
    expect(Array.from({ length: 5 }, () => rate.takePrompt(conn)).every(Boolean)).toBe(true);
    expect(rate.takePrompt(conn)).toBe(false);
    t = 500; // 1 token at 2/s
    expect(rate.takePrompt(conn)).toBe(true);
    expect(rate.takePrompt(conn)).toBe(false);
  });

  it("unset → documented defaults, no log", () => {
    const log = vi.fn();
    const l = createInboundLimits({ env: {}, log });
    expect([l.maxBash, l.promptBurst, l.promptRefillPerSec]).toEqual([DEFAULT_MAX_BASH, DEFAULT_PROMPT_BURST, DEFAULT_PROMPT_REFILL_PER_SEC]);
    expect([DEFAULT_MAX_BASH, DEFAULT_PROMPT_BURST, DEFAULT_PROMPT_REFILL_PER_SEC]).toEqual([4, 30, 10]);
    expect(log).not.toHaveBeenCalled();
  });

  it("invalid → default + exactly one log line per variable (not per message); 0 is not unlimited", () => {
    for (const bad of ["0", "-1", "NaN", "abc", "", "1.5"]) {
      const log = vi.fn();
      const l = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_MAX_BASH: bad }, log });
      expect(l.maxBash, bad).toBe(DEFAULT_MAX_BASH);
      for (let i = 0; i < 20; i++) l.tryAcquireBash("s");
      expect(log, bad).toHaveBeenCalledTimes(1);
    }
    for (const bad of ["0/10", "30/0", "30", "-5/10", "30/10/5", "", "abc", "1.5/2"]) {
      const log = vi.fn();
      const l = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_PROMPT_RATE: bad }, log });
      expect([l.promptBurst, l.promptRefillPerSec], bad).toEqual([DEFAULT_PROMPT_BURST, DEFAULT_PROMPT_REFILL_PER_SEC]);
      for (let i = 0; i < 100; i++) l.takePrompt({});
      expect(log, bad).toHaveBeenCalledTimes(1);
    }
    const log = vi.fn();
    createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_MAX_BASH: "x", PI_DASHBOARD_BRIDGE_PROMPT_RATE: "y" }, log });
    expect(log).toHaveBeenCalledTimes(2); // one per variable
  });

  it("a handler built without explicit limits reads the environment at construction", async () => {
    vi.stubEnv("PI_DASHBOARD_BRIDGE_MAX_BASH", "1");
    registryMock.bash = { ok: true, path: "/usr/bin/bash" };
    const { pi, exec } = deferredPi();
    const sink = vi.fn();
    const handler = createCommandHandler(pi, "s1", { eventSink: sink });
    vi.unstubAllEnvs();
    void handler.handle(send("!a"));
    await tick();
    void handler.handle(send("!b"));
    await tick();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(feedbackOf(sink)).toHaveLength(1);
  });
});

// ── prompt bucket through the dispatcher ─────────────────────────────────────────────────

const B = 30;
const R = 10;

function setup(opts: { limits?: ReturnType<typeof createInboundLimits>; clock?: { t: number } } = {}) {
  const clock = opts.clock ?? { t: 0 };
  const limits = opts.limits ?? createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_PROMPT_RATE: `${B}/${R}` }, now: () => clock.t });
  const handle = vi.fn(async () => undefined);
  const promote = vi.fn(() => true);
  const h = makeStubInstance({
    inboundLimits: limits,
    commandHandler: { handle } as never,
    bridgeFollowUp: { promote } as never,
    emitQueueUpdate: vi.fn(),
    pluginRequests: { handleReply: vi.fn() } as never,
    pathGate: { onServerMessage: vi.fn(() => false) } as never,
    mcpRegistrar: { onMinted: vi.fn() } as never,
    promptBus: { respond: vi.fn() } as never,
    sendCommandFeedback: vi.fn(),
    polling: { gitTracker: null } as never,
    prStatus: { refresh: vi.fn() } as never,
  });
  return { h, handle, promote, limits, clock };
}

const run = async (h: { inst: never }, msg: Record<string, unknown>) => (await dispatchModule).handleInboundMessage(h.inst, msg as never);
const feedbacks = (connection: { send: ReturnType<typeof vi.fn> }) =>
  connection.send.mock.calls
    .map((c) => c[0])
    .filter((m) => m?.type === "event_forward" && m.event?.eventType === "command_feedback")
    .map((m) => m.event.data as { command: string; status: string; message: string });

describe("prompt bucket", () => {
  it("BE13: B handled, B+1 refused (routed to the sender), one more after 1/R s; B-1 refuses nothing", async () => {
    const { h, handle, clock } = setup();
    for (let i = 0; i < B + 1; i++) await run(h as never, { type: "send_prompt", sessionId: "S1", text: `p${i}` });
    expect(handle).toHaveBeenCalledTimes(B);
    const fb = feedbacks(h.connection);
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ command: "send_prompt", status: "error" });
    expect(fb[0].message).toContain(String(B));
    // the optimistic bubble settles first
    expect(h.connection.send.mock.calls.some((c) => c[0]?.type === "prompt_received" && c[0].fresh === false)).toBe(true);

    clock.t = 1000 / R; // 100 ms → one token
    await run(h as never, { type: "send_prompt", sessionId: "S1", text: "again" });
    expect(handle).toHaveBeenCalledTimes(B + 1);
    await run(h as never, { type: "send_prompt", sessionId: "S1", text: "again2" });
    expect(handle).toHaveBeenCalledTimes(B + 1);

    const fresh = setup();
    for (let i = 0; i < B - 1; i++) await run(fresh.h as never, { type: "send_prompt", sessionId: "S1", text: "x" });
    expect(feedbacks(fresh.h.connection)).toEqual([]);
  });

  const gatedRows: Array<[string, Record<string, unknown>]> = [
    ["retry_session", { type: "retry_session", sessionId: "S1" }],
    ["git_commit_draft", { type: "git_commit_draft", sessionId: "S1", cwd: "/x" }],
    ["flow_management", { type: "flow_management", action: "run", flowName: "f" }],
    ["plugin_emit_event", { type: "plugin_emit_event", eventType: "automation:go", data: {} }],
    ["promote_followup_entry", { type: "promote_followup_entry", index: 1 }],
  ];
  const accepted = (s: ReturnType<typeof setup>) =>
    s.handle.mock.calls.length + s.h.pi.events.emit.mock.calls.length + s.promote.mock.calls.length;

  for (const [command, msg] of gatedRows) {
    it(`BE14: ${command} as the (B+1)th is refused with a named command_feedback`, async () => {
      const s = setup();
      for (let i = 0; i < B; i++) await run(s.h as never, { type: "send_prompt", sessionId: "S1", text: "x" });
      const before = accepted(s);
      await run(s.h as never, msg);
      expect(accepted(s)).toBe(before); // no turn, no emit, buffer not drained
      expect(s.h.pi.events.emit).not.toHaveBeenCalled();
      expect(s.promote).not.toHaveBeenCalled();
      expect(feedbacks(s.h.connection).at(-1)).toMatchObject({ command, status: "error" });
    });
  }

  it("BE14: a mixed flood drains ONE bucket (total accepted = B)", async () => {
    const s = setup();
    const each = B / 6;
    const all: Array<Record<string, unknown>> = [{ type: "send_prompt", sessionId: "S1", text: "x" }, ...gatedRows.map(([, m]) => m)];
    expect(all).toHaveLength(6);
    for (let i = 0; i < each; i++) for (const m of all) await run(s.h as never, m);
    expect(accepted(s)).toBe(B);
    for (const m of all) await run(s.h as never, m);
    expect(accepted(s)).toBe(B);
    expect(feedbacks(s.h.connection)).toHaveLength(6);
  });

  it("BE14: non-turn messages never spend a token", async () => {
    const s = setup();
    for (let i = 0; i < B * 3; i++) await run(s.h as never, { type: "stop_after_turn" });
    expect(feedbacks(s.h.connection)).toEqual([]);
    await run(s.h as never, { type: "send_prompt", sessionId: "S1", text: "still full" });
    expect(s.handle).toHaveBeenCalledTimes(1);
    await run(s.h as never, { type: "flow_management", action: "delete", flowName: "f" });
    expect(feedbacks(s.h.connection)).toEqual([]);
  });

  it("BE15: connections are independent; a reconnect (same manager) never refills", async () => {
    const limits = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_PROMPT_RATE: `${B}/${R}` }, now: () => 0 });
    const c1 = setup({ limits });
    const c2 = setup({ limits });
    for (let i = 0; i < B; i++) await run(c1.h as never, { type: "send_prompt", sessionId: "S1", text: "x" });
    await run(c1.h as never, { type: "send_prompt", sessionId: "S1", text: "refused" });
    expect(feedbacks(c1.h.connection)).toHaveLength(1);

    await run(c2.h as never, { type: "send_prompt", sessionId: "S1", text: "ok" });
    expect(c2.handle).toHaveBeenCalledTimes(1);
    expect(feedbacks(c2.h.connection)).toEqual([]);

    // "drop and reconnect": the manager object is unchanged → still refused.
    await run(c1.h as never, { type: "send_prompt", sessionId: "S1", text: "after-reconnect" });
    expect(c1.handle).toHaveBeenCalledTimes(B);
    expect(feedbacks(c1.h.connection)).toHaveLength(2);
  });

  it("a /reload (new ConnectionManager, same process state) does not refill the bucket", async () => {
    const limits = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_PROMPT_RATE: `${B}/${R}` }, now: () => 0 });
    const first = setup({ limits });
    for (let i = 0; i < B; i++) await run(first.h as never, { type: "send_prompt", sessionId: "S1", text: "x" });
    // the reloaded bridge: a NEW connection object but the same process-global state
    const reloaded = setup({ limits });
    (reloaded.h.inst as { shared: object }).shared = (first.h.inst as { shared: object }).shared;
    await run(reloaded.h as never, { type: "send_prompt", sessionId: "S1", text: "after reload" });
    expect(reloaded.handle).not.toHaveBeenCalled();
    expect(feedbacks(reloaded.h.connection)).toHaveLength(1);
  });

  it("BP3: 10 000 prompts in 1 s at a fixed clock: accepted == B, one refusal each, nothing queued", async () => {
    const s = setup();
    for (let i = 0; i < 10_000; i++) await run(s.h as never, { type: "send_prompt", sessionId: "S1", text: "x" });
    expect(s.handle).toHaveBeenCalledTimes(B);
    expect(feedbacks(s.h.connection)).toHaveLength(10_000 - B);
    const nonFeedback = s.h.connection.send.mock.calls.map((c) => c[0]).filter((m) => m.type !== "event_forward" && m.type !== "prompt_received");
    expect(nonFeedback).toEqual([]);
  });

  it("BP1: replayed workloads never trip the DEFAULT limits; defaults >= 3x the recorded peaks", async () => {
    const clock = { t: 0 };
    const limits = createInboundLimits({ env: {}, now: () => clock.t });
    expect(limits.promptRefillPerSec).toBeGreaterThanOrEqual(3 * PEAK_PROMPTS_PER_SEC);
    expect(limits.promptBurst).toBeGreaterThanOrEqual(3 * PEAK_PROMPT_BURST);
    expect(limits.maxBash).toBeGreaterThanOrEqual(3 * PEAK_CONCURRENT_BASH);

    const workloads: Array<[string, () => Promise<number>]> = [
      ["(a) interactive typing at the peak rate for 10 s", async () => {
        const s = setup({ limits, clock });
        for (let sec = 0; sec < 10; sec++) {
          for (let i = 0; i < PEAK_PROMPTS_PER_SEC; i++) await run(s.h as never, { type: "send_prompt", sessionId: "S1", text: "x" });
          clock.t += 1000;
        }
        return feedbacks(s.h.connection).length;
      }],
      ["(b) one automation run prompt", async () => {
        const s = setup({ limits, clock });
        await run(s.h as never, { type: "send_prompt", sessionId: "S1", text: "go" });
        return feedbacks(s.h.connection).length;
      }],
      ["(c) /reload fan-out: each of M sessions' bridge gets one prompt", async () => {
        let refused = 0;
        for (let m = 0; m < RELOAD_FANOUT_SESSIONS; m++) {
          const s = setup({ limits: createInboundLimits({ env: {}, now: () => clock.t }), clock });
          await run(s.h as never, { type: "send_prompt", sessionId: "S1", text: "/reload" });
          refused += feedbacks(s.h.connection).length;
        }
        return refused;
      }],
      ["(d) flow + chat-gateway turn traffic (peak burst, then settle)", async () => {
        const s = setup({ limits: createInboundLimits({ env: {}, now: () => clock.t }), clock });
        for (let i = 0; i < PEAK_PROMPT_BURST; i++) await run(s.h as never, { type: "send_prompt", sessionId: "S1", text: "x" });
        return feedbacks(s.h.connection).length;
      }],
    ];
    for (const [name, wl] of workloads) {
      clock.t = 0;
      expect(await wl(), name).toBe(0);
    }
    const held = Array.from({ length: PEAK_CONCURRENT_BASH + 2 }, () => limits.tryAcquireBash("s"));
    expect(held.every(Boolean)).toBe(true); // K parallel `!` within the default
  });

  it("BP2: the limiter adds < 1 ms p99 per command", async () => {
    const p99 = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.99)];
    const timeAll = async (limits: { takePrompt: (c: object) => boolean }) => {
      const s = setup({ limits: limits as never });
      const times: number[] = [];
      for (let i = 0; i < 10_000; i++) {
        const t0 = performance.now();
        await run(s.h as never, { type: "send_prompt", sessionId: "S1", text: "x" });
        times.push(performance.now() - t0);
      }
      return times;
    };
    // Enabled: a real limiter that never refuses (huge burst). Disabled: gate always opens.
    const enabled = await timeAll(createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_PROMPT_RATE: "1000000/1000000" } }));
    const disabled = await timeAll({ takePrompt: () => true });
    expect(p99(enabled) - p99(disabled)).toBeLessThan(1);

    const limits = createInboundLimits({ env: { PI_DASHBOARD_BRIDGE_MAX_BASH: "4" } });
    const bash: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      const t0 = performance.now();
      limits.tryAcquireBash("s")?.();
      bash.push(performance.now() - t0);
    }
    expect(p99(bash)).toBeLessThan(1);
  });
});
