/**
 * Restored-entry identity guard of the headless PID registry: every pid of an
 * entry restored from disk is verified by start time before any signal.
 * See change: guard-restored-headless-identity (test-plan.md rows E*, P*, X*).
 *
 * Kill primitives are mocked (dispatch shape only, no real signals); the start
 * probe and the gone check are injected through the registry options.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const killProcessMock = vi.hoisted(() => vi.fn(async (_pid: number, _o?: unknown) => ({ ok: true, forced: false })));
const killPidWithGroupMock = vi.hoisted(() => vi.fn((_pid: number, _sig: string) => undefined));
const killProcessGroupMock = vi.hoisted(() => vi.fn(async (_pid: number, _o?: unknown) => ({ ok: true, forced: false })));
const isUnsafeMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async (orig) => ({
  ...(await orig<object>()),
  killProcess: killProcessMock,
  killPidWithGroup: killPidWithGroupMock,
  killProcessGroup: killProcessGroupMock,
}));
vi.mock("../auth/test-env-guard.js", () => ({ isUnsafeTestHomeScan: isUnsafeMock }));

// eslint-disable-next-line import/first
import type { ExitIntent } from "@blackbelt-technology/pi-dashboard-shared/boot-state.js";
// eslint-disable-next-line import/first
import { createHeadlessPidRegistry } from "../spawn-process/headless-pid-registry.js";

const DAY = 24 * 60 * 60 * 1000;
const proc = (): ChildProcess => new EventEmitter() as unknown as ChildProcess;

/** A fake process table: start time per pid (`null` = unverifiable), `gone` set. */
function world() {
  const starts = new Map<number, number | null>();
  const gone = new Set<number>();
  const probe = vi.fn((pid: number): number | null => (starts.has(pid) ? (starts.get(pid) as number | null) : null));
  const isGone = vi.fn((pid: number) => gone.has(pid));
  return { starts, gone, probe, isGone };
}

function pidFileWith(entries: unknown[]): string {
  const p = join(mkdtempSync(join(tmpdir(), "pid-reg-ident-")), "pids.json");
  writeFileSync(p, JSON.stringify({ entries }));
  return p;
}

const iso = (ms: number) => new Date(ms).toISOString();
const readFile = (p: string) => JSON.parse(readFileSync(p, "utf-8")) as { entries: Array<Record<string, unknown>> };

/** Every signal primitive call naming `pid`. */
function signalsTo(pid: number): number {
  return [killProcessMock, killPidWithGroupMock, killProcessGroupMock]
    .flatMap((m) => m.mock.calls)
    .filter((c) => c[0] === pid).length;
}

let warn: ReturnType<typeof vi.spyOn>;
const warnLines = () => warn.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  killProcessMock.mockReset().mockResolvedValue({ ok: true, forced: false });
  killPidWithGroupMock.mockReset();
  killProcessGroupMock.mockReset().mockResolvedValue({ ok: true, forced: false });
  isUnsafeMock.mockReset().mockReturnValue(false);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const NOW = Date.now();

// ── cleanupOrphans ───────────────────────────────────────────────────────────

describe("cleanupOrphans — restored spawn pid verification (D4)", () => {
  it("E3: gone pid — never probed, dropped from registry and file", async () => {
    const w = world();
    w.gone.add(101);
    const file = pidFileWith([{ pid: 101, cwd: "/a", spawnedAt: iso(NOW - DAY) }]);
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    expect(w.probe).not.toHaveBeenCalled();
    expect(reg.size()).toBe(0);
    expect(readFile(file).entries).toHaveLength(0);
    expect(signalsTo(101)).toBe(0);
  });

  it("E5: reclaim row — match/unverifiable reclaimed, gone dropped, mismatch reclaimed refused; no signals", async () => {
    const w = world();
    const A = NOW - 3 * DAY;
    w.starts.set(1, A - 1000); // match
    w.gone.add(2); // gone
    w.starts.set(3, A + 10_000); // mismatch
    // 4: unverifiable (no start)
    const file = pidFileWith([1, 2, 3, 4].map((pid) => ({ pid, cwd: "/a", spawnedAt: iso(A) })));
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    expect(reg.size()).toBe(3);
    expect(readFile(file).entries.map((e) => e.pid).sort()).toEqual([1, 3, 4]);
    // Refused entry: pid-tier link refuses it (G8); the others link.
    expect(reg.linkByPid("s3", 3)).toBe(false);
    expect(reg.linkByPid("s1", 1)).toBe(true);
    expect(reg.linkByPid("s4", 4)).toBe(true);
    expect(warnLines().filter((l) => l.includes("identity mismatch pid=3 kind=spawn session=-"))).toHaveLength(1);
    for (const pid of [1, 2, 3, 4]) expect(signalsTo(pid)).toBe(0);
  });

  it("E6: 7-day row — match killed, mismatch dropped unsignalled, unverifiable retained unsignalled", async () => {
    const w = world();
    const A = NOW - 8 * DAY;
    w.starts.set(1, A); // match
    w.starts.set(2, NOW - 1000); // mismatch
    const file = pidFileWith([1, 2, 3].map((pid) => ({ pid, cwd: "/a", spawnedAt: iso(A) })));
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    expect(killProcessMock).toHaveBeenCalledTimes(1);
    expect(killProcessMock).toHaveBeenCalledWith(1, { timeoutMs: 2000 });
    expect(signalsTo(2)).toBe(0);
    expect(signalsTo(3)).toBe(0);
    expect(readFile(file).entries.map((e) => e.pid)).toEqual([3]);
    expect(reg.size()).toBe(1);
  });

  it("E7: 7-day age boundary keeps the existing `>` semantics", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const w = world();
    const at = [NOW - 7 * DAY, NOW - 7 * DAY + 1, NOW - 7 * DAY - 1];
    at.forEach((a, i) => w.starts.set(i + 1, a - 10_000));
    const file = pidFileWith(at.map((a, i) => ({ pid: i + 1, cwd: "/a", spawnedAt: iso(a) })));
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    expect(killProcessMock.mock.calls.map((c) => c[0])).toEqual([3]);
    expect(reg.size()).toBe(2);
  });

  it("E22: the server's own / parent pid recycled into the file is never signalled", async () => {
    const w = world();
    w.starts.set(process.pid, NOW - 5000);
    w.starts.set(process.ppid, NOW - 5000);
    const file = pidFileWith([
      { pid: process.pid, cwd: "/a", spawnedAt: iso(NOW - 8 * DAY) },
      { pid: process.ppid, cwd: "/a", spawnedAt: iso(NOW - 60 * 60 * 1000) },
    ]);
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    expect(reg.linkByPid("x", process.ppid)).toBe(false); // reclaimed refused
    await reg.killAll({ exitIntent: "idle" });
    expect(signalsTo(process.pid)).toBe(0);
    expect(signalsTo(process.ppid)).toBe(0);
  });

  it("E23: host reboot — every persisted pid recycled ⇒ 0 signals, 20 refusals, 20 kept", async () => {
    const w = world();
    const A = NOW - 2 * DAY;
    const persisted = Array.from({ length: 20 }, (_, i) => {
      const pid = 1000 + i;
      w.starts.set(pid, NOW - 60_000); // boot time, after every anchor
      w.starts.set(5000 + i, NOW - 60_000);
      return { pid, cwd: "/a", spawnedAt: iso(A), keeperPid: pid, piPid: 5000 + i, spawnToken: `t${i}` };
    });
    const file = pidFileWith(persisted);
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    expect(reg.size()).toBe(20);
    expect(warnLines().filter((l) => /identity mismatch pid=10\d\d kind=keeper/.test(l))).toHaveLength(20);
    reg.linkByToken("t0", "s0");
    const r = await reg.killBySessionIdChecked("s0", { verifyIdentity: true });
    expect(r.outcome).toBe("refused-identity");
    await reg.killAll({ exitIntent: "shutdown" });
    for (const e of persisted) {
      expect(signalsTo(e.pid)).toBe(0);
      expect(signalsTo(e.piPid)).toBe(0);
    }
  });

  it("E25: PID-file back-compat — legacy, stamped, unknown field, empty; markers never persisted", async () => {
    const w = world();
    const S = NOW - DAY;
    w.starts.set(10, S);
    w.starts.set(20, S);
    // Legacy piPid (no stamp) — anchor S+60 s: start S+30 s matches.
    w.starts.set(11, S + 30_000);
    // Stamped piPid — anchor = piLinkedAt S+90 s: start S+80 s matches (beyond legacy window).
    w.starts.set(21, S + 80_000);
    const file = pidFileWith([
      { pid: 10, cwd: "/a", spawnedAt: iso(S), keeperPid: 10, piPid: 11, spawnToken: "a", futureField: { x: 1 } },
      { pid: 20, cwd: "/b", spawnedAt: iso(S), keeperPid: 20, piPid: 21, piLinkedAt: iso(S + 90_000), spawnToken: "b" },
    ]);
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    expect(reg.size()).toBe(2);
    const out = readFile(file).entries;
    expect(out.find((e) => e.pid === 20)?.piLinkedAt).toBe(iso(S + 90_000));
    for (const e of out) {
      expect(e).not.toHaveProperty("restored");
      expect(e).not.toHaveProperty("identityRefused");
      expect(e).not.toHaveProperty("futureField");
    }
    reg.linkByToken("a", "sa");
    reg.linkByToken("b", "sb");
    expect((await reg.killBySessionIdChecked("sa")).outcome).toBe("signalled");
    expect((await reg.killBySessionIdChecked("sb")).outcome).toBe("signalled");
    expect(killProcessMock).toHaveBeenCalledWith(11, { timeoutMs: 2000 });
    expect(killProcessMock).toHaveBeenCalledWith(21, { timeoutMs: 2000 });

    const empty = pidFileWith([]);
    const reg2 = createHeadlessPidRegistry({ pidFilePath: empty, probe: w.probe, isGone: w.isGone });
    await reg2.cleanupOrphans();
    expect(readFile(empty)).toEqual({ entries: [] });
  });

  it("E25(a)/E2: legacy piPid window is spawnedAt + 60 s (S+62 000 matches, S+62 001 does not)", async () => {
    const S = NOW - DAY;
    for (const [start, outcome] of [[S + 62_000, "signalled"], [S + 62_001, "refused-identity"]] as const) {
      killProcessMock.mockClear();
      const w = world();
      w.starts.set(10, S);
      w.starts.set(11, start);
      const file = pidFileWith([{ pid: 10, cwd: "/a", spawnedAt: iso(S), keeperPid: 10, piPid: 11, spawnToken: "a" }]);
      const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
      await reg.cleanupOrphans();
      w.starts.set(10, NOW); // keeper pid recycled too: only the pi rung could signal
      reg.linkByToken("a", "sa");
      expect((await reg.killBySessionIdChecked("sa")).outcome).toBe(outcome);
    }
  });

  it("E26: rollback readability — the pre-change loader shape ignores piLinkedAt", () => {
    const file = pidFileWith([
      { pid: 1, cwd: "/a", spawnedAt: iso(NOW), piPid: 2, piLinkedAt: iso(NOW), keeperPid: 1, keeperSockPath: "/s", spawnToken: "t" },
    ]);
    const oldLoad = (raw: unknown) =>
      ((raw as { entries: Array<Record<string, unknown>> }).entries ?? []).map(
        ({ pid, cwd, spawnedAt, spawnToken, piPid, keeperPid, keeperSockPath, pluginRef }) =>
          ({ pid, cwd, spawnedAt, spawnToken, piPid, keeperPid, keeperSockPath, pluginRef }),
      );
    const loaded = oldLoad(readFile(file));
    expect(loaded[0]).toMatchObject({ pid: 1, cwd: "/a", piPid: 2, keeperPid: 1, keeperSockPath: "/s", spawnToken: "t" });
  });

  it("E27: markers are not persisted — restart #2 re-evaluates (gone ⇒ dropped, match ⇒ unflagged)", async () => {
    const S = NOW - DAY;
    const file = pidFileWith([{ pid: 7, cwd: "/a", spawnedAt: iso(S) }]);
    const w1 = world();
    w1.starts.set(7, NOW);
    const r1 = createHeadlessPidRegistry({ pidFilePath: file, probe: w1.probe, isGone: w1.isGone });
    await r1.cleanupOrphans();
    expect(r1.linkByPid("x", 7)).toBe(false); // refused
    const saved = readFileSync(file, "utf-8");

    const w2 = world();
    w2.gone.add(7);
    const r2 = createHeadlessPidRegistry({ pidFilePath: file, probe: w2.probe, isGone: w2.isGone });
    await r2.cleanupOrphans();
    expect(r2.size()).toBe(0);

    writeFileSync(file, saved);
    const w3 = world();
    w3.starts.set(7, S);
    const r3 = createHeadlessPidRegistry({ pidFilePath: file, probe: w3.probe, isGone: w3.isGone });
    await r3.cleanupOrphans();
    expect(r3.linkByPid("y", 7)).toBe(true); // unflagged
  });

  it("E44: unparseable / future anchors (G5)", async () => {
    const w = world();
    w.starts.set(1, NOW - 10 * DAY);
    // NaN spawnedAt ⇒ unverifiable: reclaimed, never 7-day killed, unattended no signal.
    const f1 = pidFileWith([{ pid: 1, cwd: "/a", spawnedAt: "not-a-date", spawnToken: "t1" }]);
    const r1 = createHeadlessPidRegistry({ pidFilePath: f1, probe: w.probe, isGone: w.isGone });
    await r1.cleanupOrphans();
    expect(r1.size()).toBe(1);
    r1.linkByToken("t1", "s1");
    expect((await r1.killBySessionIdChecked("s1", { verifyIdentity: true })).outcome).toBe("refused-identity");
    expect(signalsTo(1)).toBe(0);

    // Garbage piLinkedAt ⇒ unverifiable (not the legacy window).
    const S = NOW - DAY;
    w.starts.set(2, S);
    w.starts.set(3, S + 1000); // would match the legacy window
    const f2 = pidFileWith([{ pid: 2, cwd: "/a", spawnedAt: iso(S), keeperPid: 2, piPid: 3, piLinkedAt: "x", spawnToken: "t2" }]);
    const r2 = createHeadlessPidRegistry({ pidFilePath: f2, probe: w.probe, isGone: w.isGone });
    await r2.cleanupOrphans();
    r2.linkByToken("t2", "s2");
    const res2 = await r2.killBySessionIdChecked("s2", { verifyIdentity: true });
    expect(res2.refusedPids).toContain(3);
    expect(signalsTo(3)).toBe(0);

    // Future piLinkedAt clamps to now: start now+10 s mismatch, now-1 s match.
    for (const [start, refused] of [[Date.now() + 10_000, true], [Date.now() - 1000, false]] as const) {
      w.starts.set(4, S);
      w.starts.set(5, start);
      const f = pidFileWith([{ pid: 4, cwd: "/a", spawnedAt: iso(S), keeperPid: 4, piPid: 5, piLinkedAt: iso(Date.now() + DAY), spawnToken: "t" }]);
      const r = createHeadlessPidRegistry({ pidFilePath: f, probe: w.probe, isGone: w.isGone });
      await r.cleanupOrphans();
      r.linkByToken("t", "s");
      const res = await r.killBySessionIdChecked("s", { verifyIdentity: true });
      expect(res.refusedPids.includes(5)).toBe(refused);
    }
  });

  it("E19: isUnsafeTestHomeScan guard kept — no probe, no signal, warning", async () => {
    const w = world();
    w.starts.set(1, NOW);
    const file = pidFileWith([{ pid: 1, cwd: "/a", spawnedAt: iso(NOW - 8 * DAY) }]);
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    isUnsafeMock.mockReturnValue(true);
    await reg.cleanupOrphans();
    await reg.killAll({ exitIntent: "shutdown" });
    expect(w.probe).not.toHaveBeenCalled();
    expect(signalsTo(1)).toBe(0);
    expect(warnLines().some((l) => l.includes("blocked"))).toBe(true);
  });

  it("X1: a probe that throws or rejects ⇒ unverifiable; cleanupOrphans and killAll never reject", async () => {
    const S = NOW - DAY;
    const probe = vi.fn((pid: number) => {
      if (pid === 1) throw new Error("spawn ps ENOENT");
      if (pid === 3) return Promise.reject(new Error("boom"));
      return S;
    });
    const file = pidFileWith([1, 2, 3].map((pid) => ({ pid, cwd: "/a", spawnedAt: iso(S) })));
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe, isGone: () => false });
    await expect(reg.cleanupOrphans()).resolves.toBeUndefined();
    expect(reg.size()).toBe(3);
    expect(warnLines().filter((l) => l.includes("identity probe failed pid=1") && l.includes("ENOENT"))).toHaveLength(1);
    expect(warnLines().filter((l) => l.includes("identity probe failed pid=3"))).toHaveLength(1);
    await expect(reg.killAll({ exitIntent: "idle" })).resolves.toBeUndefined();
    expect(killPidWithGroupMock.mock.calls.map((c) => c[0])).toEqual([2]);
  });

  it("P1: one probe per restored live pid at startup; 0 for gone entries", async () => {
    const w = world();
    const S = NOW - DAY;
    const persisted = Array.from({ length: 100 }, (_, i) => {
      w.starts.set(i + 1, S);
      return { pid: i + 1, cwd: "/a", spawnedAt: iso(S) };
    });
    for (let i = 0; i < 10; i++) {
      w.gone.add(1000 + i);
      persisted.push({ pid: 1000 + i, cwd: "/a", spawnedAt: iso(NOW - 8 * DAY) });
    }
    const reg = createHeadlessPidRegistry({ pidFilePath: pidFileWith(persisted), probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    expect(w.probe).toHaveBeenCalledTimes(100);
  });
});

// ── registration / linking ───────────────────────────────────────────────────

describe("piLinkedAt + linking", () => {
  it("E28: linkByToken stamps piLinkedAt synchronously, with no probe", () => {
    vi.useFakeTimers({ now: 1_700_000_000_000, toFake: ["Date"] });
    const w = world();
    const file = join(mkdtempSync(join(tmpdir(), "pid-reg-ident-")), "pids.json");
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    reg.register(10, "/a", proc(), "ka", { keeperPid: 10, keeperSockPath: "/s" });
    reg.register(20, "/b", proc(), "nb");
    reg.register(30, "/c", proc(), "kc", { keeperPid: 30, keeperSockPath: "/s" });
    expect(reg.linkByToken("ka", "sa", 11)).toBe(true);
    const a = readFile(file).entries.find((e) => e.pid === 10);
    expect(a?.piPid).toBe(11);
    expect(a?.piLinkedAt).toBe(iso(1_700_000_000_000));
    reg.linkByToken("nb", "sb", 21); // non-keeper
    reg.linkByToken("kc", "sc", 30); // pid === entry.pid
    for (const pid of [20, 30]) {
      const e = readFile(file).entries.find((x) => x.pid === pid);
      expect(e?.piPid).toBeUndefined();
      expect(e?.piLinkedAt).toBeUndefined();
    }
    vi.setSystemTime(1_700_000_100_000);
    expect(reg.linkByToken("ka", "sa2", 12)).toBe(false);
    expect(readFile(file).entries.find((e) => e.pid === 10)?.piLinkedAt).toBe(iso(1_700_000_000_000));
    expect(reg.linkByToken("unknown", "s", 1)).toBe(false);
    expect(w.probe).not.toHaveBeenCalled();
  });

  it("P2: no probe on the registration path (1000 register + linkByToken)", () => {
    const w = world();
    const reg = createHeadlessPidRegistry({
      pidFilePath: join(mkdtempSync(join(tmpdir(), "pid-reg-ident-")), "pids.json"),
      probe: w.probe,
      isGone: w.isGone,
    });
    for (let i = 1; i <= 1000; i++) {
      reg.register(i, "/a", proc(), `t${i}`, { keeperPid: i, keeperSockPath: "/s" });
      reg.linkByToken(`t${i}`, `s${i}`, 100_000 + i);
    }
    expect(w.probe).not.toHaveBeenCalled();
    expect(w.isGone).not.toHaveBeenCalled();
  });

  it("E21: a genuine register() on a refused pid key starts unflagged", async () => {
    const w = world();
    w.starts.set(7, NOW);
    const file = pidFileWith([{ pid: 7, cwd: "/a", spawnedAt: iso(NOW - DAY) }]);
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    reg.register(7, "/b", proc(), "fresh");
    expect(reg.linkByToken("fresh", "s")).toBe(true);
    expect(await reg.killBySessionId("s")).toBe(true);
    expect(killProcessMock).toHaveBeenCalledWith(7, { timeoutMs: 2000 });
    expect(w.probe).toHaveBeenCalledTimes(1); // only the startup probe
  });

  it("E21b: linkByPid skips a refused entry in tier 2a and 2b; linkByToken still links (G8)", async () => {
    const w = world();
    const S = NOW - DAY;
    w.starts.set(7, NOW); // mismatch
    w.starts.set(8, NOW); // mismatch (keeper)
    const file = pidFileWith([
      { pid: 7, cwd: "/a", spawnedAt: iso(S) },
      { pid: 8, cwd: "/a", spawnedAt: iso(S), keeperPid: 8, piPid: 9, spawnToken: "own" },
    ]);
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    expect(reg.linkByPid("s2", 7)).toBe(false);
    expect(reg.linkByPid("s3", 9)).toBe(false);
    expect(reg.getPid("s2")).toBeUndefined();
    expect(reg.getPid("s3")).toBeUndefined();
    const persisted = readFile(file).entries.find((e) => e.pid === 7);
    expect(persisted?.piPid).toBeUndefined();
    expect(persisted?.piLinkedAt).toBeUndefined();
    expect(reg.linkByToken("own", "s4")).toBe(true);
  });
});

// ── kill paths ───────────────────────────────────────────────────────────────

/** A restored keeper entry `K`(pi `P`) linked to `s1` by token. */
async function restoredKeeper(opts: { K?: number; P?: number; piLinkedAt?: number; spawnedAt?: number } = {}) {
  const K = opts.K ?? 500;
  const P = opts.P ?? 600;
  const S = opts.spawnedAt ?? NOW - DAY;
  const w = world();
  w.starts.set(K, S - 1000);
  w.starts.set(P, S + 1000);
  const file = pidFileWith([
    {
      pid: K, cwd: "/a", spawnedAt: iso(S), keeperPid: K, keeperSockPath: "/s", piPid: P, spawnToken: "tok",
      ...(opts.piLinkedAt !== undefined ? { piLinkedAt: iso(opts.piLinkedAt) } : {}),
    },
  ]);
  const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
  await reg.cleanupOrphans();
  reg.linkByToken("tok", "s1");
  w.probe.mockClear();
  return { reg, w, K, P, S, file };
}

describe("killBySessionIdChecked / killEntry (D4/D5)", () => {
  it("E8: a pid recycled after restore is not signalled (checked + operator)", async () => {
    const w = world();
    const S = NOW - DAY;
    w.starts.set(7, S);
    const file = pidFileWith([{ pid: 7, cwd: "/a", spawnedAt: iso(S), spawnToken: "t" }]);
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    reg.linkByToken("t", "s1");
    w.starts.set(7, S + 3_600_000); // the pid died and was reused
    const r = await reg.killBySessionIdChecked("s1", { verifyIdentity: true });
    expect(r.outcome).toBe("refused-identity");
    expect(r.diagnostic).toContain("identity reuse");
    expect(await reg.killBySessionId("s1")).toBe(false);
    expect(signalsTo(7)).toBe(0);
    expect(warnLines().some((l) => l.includes("identity mismatch pid=7 kind=spawn session=s1"))).toBe(true);
    expect(reg.size()).toBe(1);
  });

  it("E9: an identityRefused entry is never signalled, even by an operator killAll", async () => {
    const w = world();
    w.starts.set(7, NOW);
    const file = pidFileWith([{ pid: 7, cwd: "/a", spawnedAt: iso(NOW - DAY), spawnToken: "t" }]);
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    expect(reg.linkByToken("t", "s1")).toBe(true);
    expect((await reg.killBySessionIdChecked("s1")).outcome).toBe("refused-identity");
    expect(reg.size()).toBe(1);
    await reg.killAll({ exitIntent: "shutdown" });
    expect(signalsTo(7)).toBe(0);
  });

  it("E10 (match, mismatch): keeper signalled, piPid + piLinkedAt cleared and persisted", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { reg, w, K, P, file } = await restoredKeeper({ piLinkedAt: NOW - DAY + 5000 });
    w.starts.set(P, NOW); // pi recycled
    const r = await reg.killBySessionIdChecked("s1", { verifyIdentity: true });
    expect(r.outcome).toBe("signalled");
    expect(r.refusedPids).toEqual([P]);
    expect(signalsTo(P)).toBe(0);
    expect(killProcessMock).toHaveBeenCalledWith(K, { timeoutMs: 2000 });
    expect(warnLines().some((l) => l.includes(`identity mismatch pid=${P} kind=pi session=s1`))).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(killProcessGroupMock).toHaveBeenCalledWith(K, { timeoutMs: 2000 });
    expect(readFile(file).entries).toHaveLength(0);
  });

  it("E10 (match, mismatch) on a refused kill keeps the entry with piPid cleared in the file", async () => {
    const { reg, w, K, P, file } = await restoredKeeper({ piLinkedAt: NOW - DAY + 5000 });
    w.starts.set(P, NOW);
    w.starts.set(K, NOW); // keeper recycled too ⇒ nothing signalled, entry kept
    const r = await reg.killBySessionIdChecked("s1", { verifyIdentity: true });
    expect(r.outcome).toBe("refused-identity");
    const e = readFile(file).entries[0];
    expect(e.piPid).toBeUndefined();
    expect(e.piLinkedAt).toBeUndefined();
    expect(signalsTo(K) + signalsTo(P)).toBe(0);
  });

  it("E10 (match, match) and (gone, match): pi signalled, then the group timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    for (const keeperGone of [false, true]) {
      killProcessMock.mockClear();
      killProcessGroupMock.mockClear();
      const { reg, w, K, P } = await restoredKeeper();
      if (keeperGone) w.gone.add(K);
      const r = await reg.killBySessionIdChecked("s1", { verifyIdentity: true });
      expect(r.outcome).toBe("signalled");
      expect(killProcessMock).toHaveBeenCalledWith(P, { timeoutMs: 2000 });
      await vi.advanceTimersByTimeAsync(200);
      // E41: a gone keeper still has its group reaped.
      expect(killProcessGroupMock).toHaveBeenCalledWith(K, { timeoutMs: 2000 });
    }
  });

  it("E10 (mismatch, match) / E40: pi signalled, the timer re-probe skips the recycled keeper group", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { reg, w, K, P } = await restoredKeeper();
    w.starts.set(K, NOW);
    const r = await reg.killBySessionIdChecked("s1", { verifyIdentity: true });
    expect(r.outcome).toBe("signalled");
    expect(killProcessMock).toHaveBeenCalledWith(P, { timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(200);
    expect(killProcessGroupMock).not.toHaveBeenCalled();
    expect(signalsTo(K)).toBe(0);
    expect(warnLines().some((l) => l.includes(`pid=${K} kind=keeper`))).toBe(true);
  });

  it("E40: keeper matches at kill time, recycled by the time the 200 ms timer fires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { reg, w, K } = await restoredKeeper();
    await reg.killBySessionIdChecked("s1", { verifyIdentity: true });
    w.starts.set(K, NOW + 3_600_000);
    await vi.advanceTimersByTimeAsync(200);
    expect(killProcessGroupMock).not.toHaveBeenCalled();
  });

  it("E47: keeper still matches when the timer fires ⇒ group kill exactly once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { reg, K } = await restoredKeeper();
    await reg.killBySessionIdChecked("s1", { verifyIdentity: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(killProcessGroupMock).toHaveBeenCalledTimes(1);
    expect(killProcessGroupMock).toHaveBeenCalledWith(K, { timeoutMs: 2000 });
  });

  it("E10 (mismatch, mismatch): refused-identity, no signal at all", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { reg, w, K, P } = await restoredKeeper();
    w.starts.set(K, NOW);
    w.starts.set(P, NOW);
    const r = await reg.killBySessionIdChecked("s1", { verifyIdentity: true });
    expect(r.outcome).toBe("refused-identity");
    await vi.advanceTimersByTimeAsync(500);
    expect(signalsTo(K) + signalsTo(P)).toBe(0);
  });

  it("E11/E42: unverifiable — refused when unattended (incl. default token), signalled for operators", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const cases: Array<[string, (r: Awaited<ReturnType<typeof restoredKeeper>>["reg"]) => Promise<unknown>, boolean]> = [
      ["checked unattended", (r) => r.killBySessionIdChecked("s1", { verifyIdentity: true }), false],
      ["token default", (r) => r.killByToken("tok"), false],
      ["checked operator", (r) => r.killBySessionIdChecked("s1", { verifyIdentity: false }), true],
      ["token operator", (r) => r.killByToken("tok", { verifyIdentity: false }), true],
      ["killBySessionId", (r) => r.killBySessionId("s1"), true],
    ];
    for (const [name, call, signalled] of cases) {
      killProcessMock.mockClear();
      killProcessGroupMock.mockClear();
      warn.mockClear();
      const { reg, w, K, P } = await restoredKeeper();
      w.starts.set(K, null);
      w.starts.set(P, null);
      await call(reg);
      await vi.advanceTimersByTimeAsync(200);
      expect({ name, pi: killProcessMock.mock.calls.some((c) => c[0] === P) }).toEqual({ name, pi: signalled });
      expect({ name, group: killProcessGroupMock.mock.calls.some((c) => c[0] === K) }).toEqual({ name, group: signalled });
      expect(warnLines().some((l) => l.includes("unverifiable"))).toBe(true);
    }
  });

  it("E29: refused keeper pid + token-linked verified pi ⇒ only the pi rung, no group signal (G7)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const w = world();
    const K = 500;
    const P2 = 700;
    w.starts.set(K, NOW); // recycled ⇒ identityRefused
    const file = pidFileWith([{ pid: K, cwd: "/a", spawnedAt: iso(NOW - DAY), keeperPid: K, keeperSockPath: "/s", spawnToken: "tok" }]);
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    w.starts.set(P2, Date.now() - 5000);
    expect(reg.linkByToken("tok", "s1", P2)).toBe(true);
    const r = await reg.killBySessionIdChecked("s1", { verifyIdentity: true });
    expect(r.outcome).toBe("signalled");
    expect(killProcessMock).toHaveBeenCalledWith(P2, { timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(500);
    expect(signalsTo(K)).toBe(0);
  });

  it("E20: live (registered) entries are never probed and keep their kill shape", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const w = world();
    const reg = createHeadlessPidRegistry({
      pidFilePath: join(mkdtempSync(join(tmpdir(), "pid-reg-ident-")), "pids.json"),
      probe: w.probe,
      isGone: w.isGone,
    });
    reg.register(1, "/a", proc(), "k", { keeperPid: 1, keeperSockPath: "/s" });
    reg.linkByToken("k", "sk", 2);
    reg.register(3, "/b", proc(), "n");
    reg.register(4, "/c", proc());
    expect((await reg.killBySessionIdChecked("sk")).outcome).toBe("signalled");
    expect(killProcessMock).toHaveBeenCalledWith(2, { timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(200);
    expect(killProcessGroupMock).toHaveBeenCalledWith(1, { timeoutMs: 2000 });
    expect(await reg.killByToken("n")).toBe(true);
    expect(killProcessMock).toHaveBeenCalledWith(3, { timeoutMs: 2000 });
    await reg.killAll();
    expect(killPidWithGroupMock).toHaveBeenCalledWith(4, "SIGTERM");
    expect(w.probe).not.toHaveBeenCalled();
    expect(w.isGone).not.toHaveBeenCalled();
  });

  it("P3: ≤ 2 probes per checked kill + ≤ 1 timer re-probe", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const { reg, w, P } = await restoredKeeper();
    w.starts.set(P, NOW); // pi mismatch ⇒ the keeper rung is probed too
    await reg.killBySessionIdChecked("s1", { verifyIdentity: true });
    expect(w.probe.mock.calls.length).toBeLessThanOrEqual(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(w.probe.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("X3: concurrent kills on one restored entry — neither signals, both refused", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const w = world();
    const S = NOW - DAY;
    w.starts.set(7, S);
    const file = pidFileWith([{ pid: 7, cwd: "/a", spawnedAt: iso(S), spawnToken: "t" }]);
    const probe = vi.fn(async (pid: number) => {
      if (probe.mock.calls.length > 1) await gate;
      return pid === 7 && probe.mock.calls.length > 1 ? NOW : w.probe(pid);
    });
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe, isGone: () => false });
    await reg.cleanupOrphans();
    reg.linkByToken("t", "s1");
    const a = reg.killBySessionIdChecked("s1");
    const b = reg.killBySessionIdChecked("s1");
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.outcome).toBe("refused-identity");
    expect(rb.outcome).toBe("refused-identity");
    expect(signalsTo(7)).toBe(0);
  });

  it("X7: killProcess rejecting for a verified pid never escapes", async () => {
    const { reg, P } = await restoredKeeper();
    killProcessMock.mockRejectedValue(new Error("EPERM"));
    await expect(reg.killBySessionIdChecked("s1", { verifyIdentity: true })).resolves.toMatchObject({ outcome: "signalled" });
    expect(killProcessMock).toHaveBeenCalledWith(P, { timeoutMs: 2000 });
  });

  it("E31: no clear→refill loop — a cleared recycled piPid is never re-recorded", async () => {
    const { reg, w, K, P, file } = await restoredKeeper({ piLinkedAt: NOW - DAY + 5000 });
    w.starts.set(P, NOW);
    w.starts.set(K, NOW); // keep the entry (refused)
    await reg.killBySessionIdChecked("s1", { verifyIdentity: true });
    reg.setKeeperWriter({
      discoverExistingKeepers: async () => [{ sessionId: "t", keeperPid: K, sockPath: "/s", piPid: P, piPidAnchorMs: NOW - DAY }],
    });
    await reg.cleanupKeeperOrphans();
    await reg.cleanupKeeperOrphans();
    expect(readFile(file).entries[0].piPid).toBeUndefined();
    expect(reg.linkByPid("s9", P)).toBe(false);
  });
});

// ── sidecar fill ─────────────────────────────────────────────────────────────

describe("cleanupKeeperOrphans — sidecar fill verifies the pi pid (E30)", () => {
  async function reclaimedKeeper(piPid?: number) {
    const w = world();
    const S = NOW - DAY;
    w.starts.set(500, S);
    const file = pidFileWith([{ pid: 500, cwd: "/a", spawnedAt: iso(S), keeperPid: 500, keeperSockPath: "/s", ...(piPid ? { piPid } : {}) }]);
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
    await reg.cleanupOrphans();
    return { reg, w, file };
  }
  const M = NOW - 60_000;

  for (const [label, start, recorded] of [
    ["match (M+1 000)", M + 1000, true],
    ["mismatch (M+2 001)", M + 2001, false],
    ["unverifiable (null)", null, false],
  ] as const) {
    it(label, async () => {
      const errs = vi.spyOn(console, "error").mockImplementation(() => {});
      const { reg, w, file } = await reclaimedKeeper();
      w.starts.set(600, start);
      reg.setKeeperWriter({ discoverExistingKeepers: async () => [{ sessionId: "t", keeperPid: 500, sockPath: "/s", piPid: 600, piPidAnchorMs: M }] });
      await reg.cleanupKeeperOrphans();
      const e = readFile(file).entries[0];
      expect(e.piPid).toBe(recorded ? 600 : undefined);
      expect(e.piLinkedAt).toBe(recorded ? iso(M) : undefined);
      const lines = errs.mock.calls.map((c) => String(c[0]));
      if (recorded) expect(lines.some((l) => l.includes("[keeper-identity] recorded piPid=600"))).toBe(true);
      if (start !== null && !recorded) expect(warnLines().some((l) => l.includes("identity mismatch pid=600 kind=pi"))).toBe(true);
    });
  }

  it("X6: a pi sidecar whose stat failed (no anchor) is never recorded", async () => {
    const { reg, w, file } = await reclaimedKeeper();
    w.starts.set(600, M - 1000);
    reg.setKeeperWriter({ discoverExistingKeepers: async () => [{ sessionId: "t", keeperPid: 500, sockPath: "/s", piPid: 600 }] });
    await reg.cleanupKeeperOrphans();
    expect(readFile(file).entries[0].piPid).toBeUndefined();
  });

  it("an existing piPid is left untouched", async () => {
    const errs = vi.spyOn(console, "error").mockImplementation(() => {});
    const { reg, file } = await reclaimedKeeper(777);
    reg.setKeeperWriter({ discoverExistingKeepers: async () => [{ sessionId: "t", keeperPid: 500, sockPath: "/s", piPid: 600, piPidAnchorMs: M }] });
    await reg.cleanupKeeperOrphans();
    expect(readFile(file).entries[0].piPid).toBe(777);
    expect(errs.mock.calls.some((c) => String(c[0]).includes("unchanged piPid=777"))).toBe(true);
  });
});

// ── killAll ──────────────────────────────────────────────────────────────────

describe("killAll({ exitIntent }) (D7, G1, G6)", () => {
  const INTENTS: Array<ExitIntent | null | undefined | "{}"> = [
    "shutdown", "user-quit", "restart", "idle", "signal", "ephemeral", null, undefined, "{}",
  ];
  const OPERATOR = new Set(["shutdown", "user-quit", "restart"]);

  for (const intent of INTENTS) {
    it(`E16/E32: intent ${String(intent)} × verdict`, async () => {
      const w = world();
      const S = NOW - DAY;
      w.starts.set(1, S); // match
      w.starts.set(2, NOW); // mismatch
      // 3: unverifiable (win32-like)
      w.gone.add(4); // gone after restore
      const file = pidFileWith([1, 2, 3, 4].map((pid) => ({ pid, cwd: "/a", spawnedAt: iso(S) })));
      const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: w.probe, isGone: w.isGone });
      w.gone.delete(4);
      w.starts.set(4, S);
      await reg.cleanupOrphans();
      w.gone.add(4);
      reg.register(9, "/live", proc());
      w.probe.mockClear();
      if (intent === undefined) await reg.killAll();
      else if (intent === "{}") await reg.killAll({});
      else await reg.killAll({ exitIntent: intent });
      const signalled = killPidWithGroupMock.mock.calls.map((c) => c[0]).sort();
      const expected = [1, 9, ...(OPERATOR.has(String(intent)) ? [3] : [])].sort();
      expect(signalled).toEqual(expected);
      for (const c of killPidWithGroupMock.mock.calls) expect(c[1]).toBe("SIGTERM");
      expect(w.probe.mock.calls.map((c) => c[0])).not.toContain(9);
      expect(reg.size()).toBe(0);
    });
  }

  it("E17: snapshot — a late register is neither signalled nor deleted; an exited entry is not resurrected", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    const S = NOW - DAY;
    const file = pidFileWith([1, 2].map((pid) => ({ pid, cwd: "/a", spawnedAt: iso(S) })));
    let holding = false;
    const probe = vi.fn(async () => {
      if (holding) await hold;
      return S;
    });
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe, isGone: () => false });
    await reg.cleanupOrphans();
    holding = true;
    const done = reg.killAll({ exitIntent: "shutdown" });
    const late = proc();
    reg.register(3, "/late", late);
    reg.remove(1); // entry 1 exits mid-verification
    release();
    await done;
    expect(killPidWithGroupMock.mock.calls.map((c) => c[0])).not.toContain(3);
    expect(reg.size()).toBe(1);
    expect(readFile(file).entries.map((e) => e.pid)).toContain(3);
    expect(killPidWithGroupMock.mock.calls.filter((c) => c[0] === 1).length).toBeLessThanOrEqual(1);
  });

  it("E18: restored entries are verified concurrently", async () => {
    const resolvers: Array<(v: number) => void> = [];
    const S = NOW - DAY;
    let startup = true;
    const probe = vi.fn((_pid: number) => (startup ? S : new Promise<number>((r) => resolvers.push(r))));
    const file = pidFileWith([1, 2, 3].map((pid) => ({ pid, cwd: "/a", spawnedAt: iso(S) })));
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe, isGone: () => false });
    await reg.cleanupOrphans();
    startup = false;
    const done = reg.killAll({ exitIntent: "shutdown" });
    await vi.waitFor(() => expect(resolvers).toHaveLength(3));
    for (const r of resolvers) r(S);
    await done;
    expect(killPidWithGroupMock).toHaveBeenCalledTimes(3);
  });

  it("X2: a hung probe is cut at 2 s ⇒ unverifiable (signalled for shutdown, not idle)", async () => {
    for (const [intent, expectHung] of [["shutdown", true], ["idle", false]] as const) {
      killPidWithGroupMock.mockClear();
      vi.useRealTimers();
      const S = NOW - DAY;
      let startup = true;
      const probe = vi.fn((pid: number) => (startup || pid !== 2 ? S : new Promise<number>(() => {})));
      const file = pidFileWith([1, 2, 3].map((pid) => ({ pid, cwd: "/a", spawnedAt: iso(S) })));
      const reg = createHeadlessPidRegistry({ pidFilePath: file, probe, isGone: () => false });
      await reg.cleanupOrphans();
      startup = false;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const done = reg.killAll({ exitIntent: intent });
      await vi.advanceTimersByTimeAsync(2000);
      await done;
      const sig = killPidWithGroupMock.mock.calls.map((c) => c[0]).sort();
      expect(sig).toEqual(expectHung ? [1, 2, 3] : [1, 3]);
      expect(reg.size()).toBe(0);
    }
  });

  it("X2b/P4: killAll settles within the 5 s budget even when every probe hangs", async () => {
    const S = NOW - DAY;
    let startup = true;
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const probe = vi.fn((_pid: number) => (startup ? S : new Promise<number>(() => {})));
      const file = pidFileWith(Array.from({ length: 50 }, (_, i) => ({ pid: i + 1, cwd: "/a", spawnedAt: iso(S) })));
      const reg = createHeadlessPidRegistry({ pidFilePath: file, probe, isGone: () => false });
      await reg.cleanupOrphans();
      startup = false;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let settled = false;
      const done = reg.killAll({ exitIntent: "idle" }).then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(5000);
      await done;
      expect(settled).toBe(true);
      expect(killPidWithGroupMock).not.toHaveBeenCalled(); // all unverifiable, idle
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("X2b: a serialised probe queue past the budget — late verdicts are not applied", async () => {
    const S = NOW - DAY;
    let startup = true;
    let chain = Promise.resolve();
    const probe = vi.fn((_pid: number) => {
      if (startup) return S;
      const next = chain.then(() => new Promise<number>((r) => setTimeout(() => r(S), 1900)));
      chain = next.then(() => undefined);
      return next;
    });
    const file = pidFileWith(Array.from({ length: 6 }, (_, i) => ({ pid: i + 1, cwd: "/a", spawnedAt: iso(S) })));
    const reg = createHeadlessPidRegistry({ pidFilePath: file, probe, isGone: () => false });
    await reg.cleanupOrphans();
    startup = false;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const done = reg.killAll({ exitIntent: "idle" });
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    const signalled = killPidWithGroupMock.mock.calls.length;
    expect(signalled).toBeGreaterThan(0);
    expect(signalled).toBeLessThan(6);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(killPidWithGroupMock.mock.calls.length).toBe(signalled);
  });
});
