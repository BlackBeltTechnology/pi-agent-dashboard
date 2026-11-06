/**
 * The Stop pipeline (`createStopPipeline`): scope admission, orphan target
 * rules, honest outcomes, exactly-once finalization under concurrency, and the
 * orphan parent cascade. Real run-store records in a tmp dir; the engine,
 * session table and host abort are fakes.
 * See change: polish-automation-board (design D2, D3, D4, D6).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finishRun,
  finishRunIfRunning,
  readChildRuns,
  readRun,
  resolveRunDir,
  setSessionId,
  startChildRun,
  startParentRun,
  startRun,
} from "../server/run-store.js";
import { createStopPipeline, ORPHAN_STOP_RESULT } from "../server/stop-run.js";
import type { StopOutcome } from "../shared/automation-types.js";

const BOOT = Date.UTC(2026, 10, 6, 10, 0, 0);
const BEFORE = new Date(BOOT - 60_000);
const AFTER = new Date(BOOT + 60_000);

let tmp: string;
let base: string;
let other: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "auto-stop-pipe-")));
  base = path.join(tmp, "repo");
  other = path.join(tmp, "other");
  fs.mkdirSync(base);
  fs.mkdirSync(other);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Session = { cwd: string; automationRun?: { runId?: string; scope?: string } };

function harness(opts: {
  tracked?: Map<string, string>;
  abort?: (a: { sessionId?: string; onResult?: (r: { outcome: string }) => void }) => Promise<boolean>;
} = {}) {
  const tracked = opts.tracked ?? new Map<string, string>();
  const sessions = new Map<string, Session>();
  const connected = new Set<string>();
  const abortCalls: string[] = [];
  const abort = vi.fn(async (a: { sessionId?: string; onResult?: (r: { outcome: string }) => void }) => {
    abortCalls.push(a.sessionId ?? "");
    if (opts.abort) return opts.abort(a);
    a.onResult?.({ outcome: "confirmed-dead" });
    return true;
  });
  const engineStop = vi.fn(async (): Promise<StopOutcome | null> => "killed");
  const stop = createStopPipeline({
    engine: {
      isTracked: (id) => tracked.has(id),
      trackedScopeBase: (id) => tracked.get(id),
      stopRun: engineStop,
      isOrphaned: (r) => r.status === "running" && !tracked.has(r.runId) && r.startedAt < BOOT,
    },
    getSession: (id) => sessions.get(id),
    isConnected: (id) => connected.has(id),
    abortSpawnedRun: abort,
    warn: () => {},
  });
  /** A connected session carrying this run's stamp in `cwd` (default: the scope base). */
  const stamped = (sid: string, runId: string, cwd = base, scope: string | null = "folder") => {
    sessions.set(sid, { cwd, automationRun: { runId, ...(scope ? { scope } : {}) } });
    connected.add(sid);
  };
  return { stop, abort, abortCalls, engineStop, sessions, connected, stamped, tracked };
}

function orphanFlat(runId: string, sessionId?: string): void {
  startRun(base, "nightly", { runId, at: BEFORE });
  if (sessionId) setSessionId(base, runId, sessionId);
}

const req = (runId: string, scopeBase = base) => ({ scope: "folder" as const, scopeBase, runId });

describe("orphan Stop target rules", () => {
  // test-plan #E3 — only (f) symlink-to-scope and (g) exact match are signalled.
  it("E3: abort only for a connected, stamped, in-scope session; record stopped in every row", async () => {
    const link = path.join(tmp, "link-to-repo");
    fs.symlinkSync(base, link);
    const rows: Array<{ id: string; setup: (h: ReturnType<typeof harness>) => void; outcome: StopOutcome; aborted: boolean }> = [
      { id: "a", setup: () => orphanFlat("run-a"), outcome: "not-found", aborted: false },
      { id: "b", setup: (h) => { orphanFlat("run-b", "s-b"); h.stamped("s-b", "run-b"); h.connected.delete("s-b"); }, outcome: "unconfirmed", aborted: false },
      { id: "c", setup: (h) => { orphanFlat("run-c", "s-c"); h.stamped("s-c", "other-run"); }, outcome: "unconfirmed", aborted: false },
      { id: "d", setup: (h) => { orphanFlat("run-d", "s-d"); h.stamped("s-d", "run-d", base, null); }, outcome: "unconfirmed", aborted: false },
      { id: "e", setup: (h) => { orphanFlat("run-e", "s-e"); h.stamped("s-e", "run-e", other); }, outcome: "unconfirmed", aborted: false },
      { id: "f", setup: (h) => { orphanFlat("run-f", "s-f"); h.stamped("s-f", "run-f", link); }, outcome: "killed", aborted: true },
      { id: "g", setup: (h) => { orphanFlat("run-g", "s-g"); h.stamped("s-g", "run-g"); }, outcome: "killed", aborted: true },
    ];
    for (const row of rows) {
      const h = harness();
      row.setup(h);
      const r = await h.stop(req(`run-${row.id}`));
      expect(r, row.id).toEqual({ ok: true, outcome: row.outcome });
      expect(h.abort.mock.calls.length, row.id).toBe(row.aborted ? 1 : 0);
      const rec = readRun(base, `run-${row.id}`)!;
      expect(rec.status, row.id).toBe("stopped");
      expect(rec.archived, row.id).not.toBe(true);
      expect(fs.readFileSync(path.join(resolveRunDir(base, rec.runId)!, "result.md"), "utf-8").trim()).toBe(ORPHAN_STOP_RESULT);
    }
  });

  // test-plan #E4 — a forged sessionId naming a human session is never signalled.
  it("E4: a connected human session without the run stamp is not signalled", async () => {
    const h = harness();
    orphanFlat("run-forged", "human-1");
    h.sessions.set("human-1", { cwd: base });
    h.connected.add("human-1");
    const r = await h.stop(req("run-forged"));
    expect(h.abort).toHaveBeenCalledTimes(0);
    expect(r.outcome).toBe("unconfirmed");
  });

  // test-plan #X5 — the cwd comparison fails closed when realpath throws.
  it("X5: a session cwd that no longer exists fails closed (no abort, unconfirmed)", async () => {
    const h = harness();
    const gone = path.join(tmp, "gone");
    fs.mkdirSync(gone);
    orphanFlat("run-x5", "s-x5");
    h.stamped("s-x5", "run-x5", gone);
    fs.rmSync(gone, { recursive: true });
    const r = await h.stop(req("run-x5"));
    expect(h.abort).toHaveBeenCalledTimes(0);
    expect(r).toEqual({ ok: true, outcome: "unconfirmed" });
  });

  // test-plan #X4 — a rejected abort is unconfirmed, finalized, no unhandled rejection.
  it("X4: a rejecting abort is unconfirmed and the record says the process may still be running", async () => {
    const h = harness({ abort: async () => { throw new Error("terminator down"); } });
    orphanFlat("run-x4", "s-x4");
    h.stamped("s-x4", "run-x4");
    const r = await h.stop(req("run-x4"));
    expect(r).toEqual({ ok: true, outcome: "unconfirmed" });
    const rec = readRun(base, "run-x4")!;
    expect(rec.status).toBe("stopped");
    expect(rec.error).toContain("may still be running");
  });
});

describe("Stop rejections", () => {
  // test-plan #E6
  it("E6: done / error / stopped records are rejected and left byte-identical", async () => {
    const h = harness();
    for (const status of ["done", "error", "stopped"] as const) {
      const id = `fin-${status}`;
      orphanFlat(id, `s-${status}`);
      h.stamped(`s-${status}`, id);
      finishRun(base, id, { status, result: "- a finding" });
      const file = path.join(resolveRunDir(base, id)!, "run.json");
      const before = fs.readFileSync(file);
      const r = await h.stop(req(id));
      expect(r.ok).toBe(false);
      expect(r.error).toBeTruthy();
      expect(fs.readFileSync(file).equals(before)).toBe(true);
    }
    expect(h.abort).toHaveBeenCalledTimes(0);
  });

  // test-plan #E7
  it("E7: a running, untracked record started by this process is rejected naming the reaper", async () => {
    const h = harness();
    startRun(base, "nightly", { runId: "fresh", at: AFTER });
    const r = await h.stop(req("fresh"));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("reaper");
    expect(readRun(base, "fresh")!.status).toBe("running");
    expect(h.abort).toHaveBeenCalledTimes(0);
  });

  // test-plan #E8
  it("E8: a tracked run of scope /a is not stoppable from an admission for /b", async () => {
    const h = harness({ tracked: new Map([["live-run", base]]) });
    const r = await h.stop(req("live-run", other));
    expect(r.ok).toBe(false);
    expect(h.engineStop).toHaveBeenCalledTimes(0);
    expect(h.abort).toHaveBeenCalledTimes(0);
    expect(h.tracked.has("live-run")).toBe(true);
  });

  it("a tracked run in its own scope goes through the engine's live Stop", async () => {
    const h = harness({ tracked: new Map([["live-run", base]]) });
    expect(await h.stop(req("live-run"))).toEqual({ ok: true, outcome: "killed" });
    expect(h.engineStop).toHaveBeenCalledWith("live-run");
  });

  it("an unsafe run id is rejected", async () => {
    const h = harness();
    expect((await h.stop(req("../escape"))).ok).toBe(false);
  });
});

describe("orphan parent cascade", () => {
  type Kid = "k" | "u" | "nf";
  function orphanParent(h: ReturnType<typeof harness>, pid: string, kids: Kid[], extraTerminal?: { status: "done" | "error"; findings: string }) {
    startParentRun(base, "fan", { runId: pid, at: BEFORE });
    kids.forEach((kind, i) => {
      const cid = `${pid}-c${i}`;
      startChildRun(base, pid, "fan", { runId: cid, at: BEFORE });
      if (kind === "nf") return;
      setSessionId(base, cid, `s-${cid}`);
      h.stamped(`s-${cid}`, kind === "k" ? cid : "someone-else");
    });
    if (extraTerminal) {
      const cid = `${pid}-done`;
      startChildRun(base, pid, "fan", { runId: cid, at: BEFORE });
      finishRun(base, cid, { status: extraTerminal.status, result: extraTerminal.findings });
    }
  }

  // test-plan #E10
  it("E10: parent outcome combines children; parent finalized with combined status + summed findings", async () => {
    const rows: Array<{ kids: Kid[]; outcome: StopOutcome; extra?: { status: "done" | "error"; findings: string }; status: string; findings: number }> = [
      { kids: ["k", "k"], outcome: "killed", extra: { status: "done", findings: "- one" }, status: "done", findings: 1 },
      { kids: ["k", "u"], outcome: "unconfirmed", status: "stopped", findings: 0 },
      { kids: ["nf", "nf"], outcome: "not-found", status: "stopped", findings: 0 },
      { kids: [], outcome: "not-found", extra: { status: "error", findings: "- a\n- b" }, status: "error", findings: 2 },
    ];
    for (const [i, row] of rows.entries()) {
      const h = harness();
      const pid = `parent-${i}`;
      orphanParent(h, pid, row.kids, row.extra);
      const r = await h.stop(req(pid));
      expect(r, pid).toEqual({ ok: true, outcome: row.outcome });
      const parent = readRun(base, pid)!;
      expect(parent.status, pid).toBe(row.status);
      expect(parent.findings, pid).toBe(row.findings);
      for (const kid of readChildRuns(base, parent)) expect(kid.status, kid.runId).not.toBe("running");
    }
  });

  it("a tracked child owned by another scope is not live-stopped by the parent cascade", async () => {
    const tracked = new Map<string, string>();
    const h = harness({ tracked });
    orphanParent(h, "p-x", ["nf"]);
    tracked.set("p-x-c0", other);
    await h.stop(req("p-x"));
    expect(h.engineStop).not.toHaveBeenCalled();
  });

  it("a tracked child in the admitted scope goes through the engine's live Stop", async () => {
    const tracked = new Map<string, string>();
    const h = harness({ tracked });
    orphanParent(h, "p-in", ["nf"]);
    tracked.set("p-in-c0", base);
    const r = await h.stop(req("p-in"));
    expect(h.engineStop).toHaveBeenCalledWith("p-in-c0");
    expect(r.outcome).toBe("killed");
  });

  it("stopping the last running orphan child by its own id finalizes the parent", async () => {
    const h = harness();
    orphanParent(h, "p-last", ["k"], { status: "done", findings: "- x" });
    const r = await h.stop(req("p-last-c0"));
    expect(r).toEqual({ ok: true, outcome: "killed" });
    const parent = readRun(base, "p-last")!;
    expect(parent.status).toBe("done");
    expect(parent.findings).toBe(1);
  });

  // test-plan #X3 — parent and child Stops race: one abort for that child.
  it("X3: concurrent parent + child Stops abort the child once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness({ abort: async (a) => { await gate; a.onResult?.({ outcome: "confirmed-dead" }); return true; } });
    orphanParent(h, "p-race", ["k"]);
    const both = Promise.all([h.stop(req("p-race")), h.stop(req("p-race-c0"))]);
    release();
    const [parent, child] = await both;
    expect(h.abortCalls.filter((s) => s === "s-p-race-c0")).toHaveLength(1);
    expect(parent.outcome).toBe("killed");
    expect(child.outcome).toBe("killed");
    expect(readRun(base, "p-race")!.status).toBe("stopped");
  });
});

describe("exactly-once under concurrency", () => {
  // test-plan #X1
  it("X1: two concurrent Stops of one orphan signal once and share one result", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness({ abort: async (a) => { await gate; a.onResult?.({ outcome: "confirmed-dead" }); return true; } });
    orphanFlat("run-x1", "s-x1");
    h.stamped("s-x1", "run-x1");
    const renames = vi.spyOn(fs, "renameSync");
    const p1 = h.stop(req("run-x1"));
    const p2 = h.stop(req("run-x1"));
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(h.abort).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(r1).toEqual({ ok: true, outcome: "killed" });
    expect(renames.mock.calls.filter((c) => String(c[1]).endsWith("run.json"))).toHaveLength(1);
  });

  // test-plan #X2
  it("X2: the reaper finalizing during the abort wins; Stop reports alreadyFinalized", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness({ abort: async (a) => { await gate; a.onResult?.({ outcome: "confirmed-dead" }); return true; } });
    orphanFlat("run-x2", "s-x2");
    h.stamped("s-x2", "run-x2");
    const p = h.stop(req("run-x2"));
    expect(finishRunIfRunning(base, "run-x2", { status: "error", error: "run exceeded max age", result: "_(run exceeded max age)_" })).toBe(true);
    release();
    const r = await p;
    expect(r).toEqual({ ok: true, outcome: "killed", alreadyFinalized: true });
    const rec = readRun(base, "run-x2")!;
    expect(rec.status).toBe("error");
    expect(rec.error).toBe("run exceeded max age");
  });
});
