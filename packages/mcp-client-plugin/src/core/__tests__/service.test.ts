/**
 * Live state from `pi mcp list --json` via an injected runner
 * (migrate-mcp-to-pi-builtin test-plan E14, E22, E23, E27).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveStateReader } from "../live-state.js";
import type { PiMcpListRunner } from "../types.js";
import { CWD, GLOBAL, makeIO, makeService, PROJECT } from "./helpers.js";

const LIST = JSON.stringify({
  servers: [
    { name: "a", state: "connected", tools: ["t1", "t2"] },
    { name: "b", state: "disconnected", tools: [], error: "ECONNREFUSED" },
  ],
  errors: [],
});

afterEach(() => {
  vi.useRealTimers();
});

describe("E14 — exit codes", () => {
  const cases: Array<[string, PiMcpListRunner, boolean]> = [
    ["exit 0 + JSON", async () => ({ stdout: LIST, code: 0 }), true],
    ["exit 1 + valid JSON", async () => ({ stdout: LIST, code: 1 }), true],
    ["exit 1 + garbage", async () => ({ stdout: "boom", code: 1 }), false],
    [
      "spawn error",
      async () => {
        throw new Error("ENOENT pi");
      },
      false,
    ],
  ];

  it.each(cases)("%s", async (_label, runner, ok) => {
    const live = await makeService(makeIO(), { runner }).getLiveState({ kind: "global" });
    expect(live.ok).toBe(ok);
    if (live.ok) {
      expect(live.servers.a).toEqual({ state: "connected", tools: 2 });
      expect(live.servers.b).toEqual({ state: "disconnected", tools: 0, error: "ECONNREFUSED" });
    }
  });
});

describe("E22 — 30 s timeout boundary", () => {
  it("a runner resolving at 29.9 s yields pi state", async () => {
    vi.useFakeTimers();
    const runner: PiMcpListRunner = () =>
      new Promise((resolve) => setTimeout(() => resolve({ stdout: LIST, code: 0 }), 29_900));
    const pending = makeService(makeIO(), { runner }).getLiveState({ kind: "global" });
    await vi.advanceTimersByTimeAsync(29_900);
    expect((await pending).ok).toBe(true);
  });

  it("a runner hanging past 30 s is killed and reports state unknown", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const runner: PiMcpListRunner = (_cwd, s) => {
      signal = s;
      return new Promise(() => {});
    };
    const pending = makeService(makeIO(), { runner }).getLiveState({ kind: "global" });
    await vi.advanceTimersByTimeAsync(30_000);
    const r = await pending;
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
    expect(signal?.aborted).toBe(true);
  });
});

describe("E23 — per-cwd cache TTL boundary", () => {
  it("cwd A at 0, 29.9 s, 30.1 s and cwd B at 1 s → 3 runner calls", async () => {
    let t = 0;
    const calls: string[] = [];
    const runner: PiMcpListRunner = async (cwd) => {
      calls.push(cwd);
      return { stdout: LIST, code: 0 };
    };
    const other = "/work/other";
    // Drive the clock through the reader's injected `now`.
    const reader = createLiveStateReader({ runner, now: () => t });
    await reader.read(CWD);
    t = 1_000;
    await reader.read(other);
    t = 29_900;
    await reader.read(CWD);
    t = 30_100;
    await reader.read(CWD);
    expect(calls).toEqual([CWD, other, CWD]);
  });
});

describe("E27 — the global list runs in an empty scratch dir", () => {
  it("runner cwd is the scratch dir and the view lists only Pi-global servers", async () => {
    const seen: string[] = [];
    const runner: PiMcpListRunner = async (cwd) => {
      seen.push(cwd);
      return { stdout: LIST, code: 0 };
    };
    const io = makeIO({
      [GLOBAL]: { mcpServers: { a: { command: "a" } } },
      [PROJECT]: { mcpServers: { f: { command: "f" } } },
    });
    const svc = makeService(io, { runner, scratchCwd: "/scratch-empty" });
    await svc.getLiveState({ kind: "global" });
    expect(seen).toEqual(["/scratch-empty"]);
    expect(svc.getEffectiveView({ kind: "global" }).servers.map((s) => s.name)).toEqual(["a"]);
  });

  it("a project live read runs in that cwd", async () => {
    const seen: string[] = [];
    const runner: PiMcpListRunner = async (cwd) => {
      seen.push(cwd);
      return { stdout: LIST, code: 0 };
    };
    await makeService(makeIO(), { runner }).getLiveState({ kind: "project", cwd: CWD });
    expect(seen).toEqual([CWD]);
  });
});

describe("one pi mcp list per cwd at a time", () => {
  // review r4 B1: a Refresh during an in-flight run must see a run that STARTS
  // after the refresh — one queued follow-up, coalescing every fresh request
  // made meanwhile (≤ 1 running + 1 queued per cwd).
  it("a fresh request while a run is in flight queues ONE post-refresh run; plain reads share in-flight", async () => {
    const OLD = JSON.stringify({ servers: [{ name: "a", state: "connecting", tools: [] }], errors: [] });
    const NEW = JSON.stringify({ servers: [{ name: "a", state: "connected", tools: ["t"] }], errors: [] });
    let calls = 0;
    const releases: Array<(v: { stdout: string; code: number }) => void> = [];
    const runner: PiMcpListRunner = () => {
      calls += 1;
      return new Promise((resolve) => {
        releases.push(resolve);
      });
    };
    const reader = createLiveStateReader({ runner });
    const a = reader.read(CWD);
    const b = reader.read(CWD, { fresh: true });
    const c = reader.read(CWD, { fresh: true });
    const plain = reader.read(CWD);
    expect(calls).toBe(1);
    expect(plain).toBe(a);
    expect(c).toBe(b);

    releases[0]({ stdout: OLD, code: 0 });
    const first = await a;
    expect(first.ok && first.servers.a.state).toBe("connecting");
    await vi.waitFor(() => expect(calls).toBe(2));

    releases[1]({ stdout: NEW, code: 0 });
    const refreshed = await b;
    expect(refreshed.ok && refreshed.servers.a.state).toBe("connected");
    expect(await c).toEqual(refreshed);
    // The refreshed run is now the cached value.
    expect(await reader.read(CWD)).toEqual(refreshed);
    expect(calls).toBe(2);
  });
});
