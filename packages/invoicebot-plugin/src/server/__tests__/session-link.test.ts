/**
 * Session-linkage seam: reuse a supplied live invoicebot session (no spawn);
 * else spawn and correlate strictly by the stamped automationRun.runId (a
 * same-cwd decoy is NOT mis-bound); an unrelated/stale sessionId falls through
 * to spawn and is never injected into; resolveSessionId returns the recorded
 * link, falls back to a scan, and returns null (never throws) for unknown.
 * See change: add-invoicebot-rest-plugin (§5.5, §6.1).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { FlowRunSpec } from "../engine/port.js";
import { createSessionLink, recordedSessionIdsFromDetails, type SessionLinkDeps } from "../session-link.js";

const CWD = "/work/acme";
const FLOW: FlowRunSpec = { flowName: "invoicebot:process", task: "source://inv1" };

interface Sess {
  id: string;
  cwd?: string;
  status?: "active" | "idle" | "streaming" | "ended";
  sessionFile?: string;
  automationRun?: { runId?: string; name?: string };
}

function makeDeps(sessions: Sess[]) {
  const store = new Map(sessions.map((s) => [s.id, s]));
  const emits: { sessionId: string; eventType: string; data: any }[] = [];
  const spawns: any[] = [];
  let eventHandler: ((sessionId: string, event: unknown) => void) | null = null;
  let recordedIds: string[] = [];
  const deps: SessionLinkDeps = {
    spawnSession: async (opts) => { spawns.push(opts); return { success: true, spawnToken: "tok-1" }; },
    emitEventToSession: (sessionId, eventType, data) => { if (!store.has(sessionId)) return false; emits.push({ sessionId, eventType, data }); return true; },
    getSession: (id) => store.get(id),
    listAll: () => [...store.values()],
    onEvent: (h) => { eventHandler = h; return () => { eventHandler = null; }; },
    resolveRecordedSessionIds: async () => recordedIds,
    logger: { info: () => {}, warn: () => {} },
    spawnBindTimeoutMs: 200,
  };
  return {
    deps,
    store,
    emits,
    spawns,
    fire: (id: string) => eventHandler?.(id, {}),
    addSession: (s: Sess) => store.set(s.id, s),
    setRecordedIds: (ids: string[]) => { recordedIds = ids; },
  };
}

let ctx: ReturnType<typeof makeDeps>;
beforeEach(() => { ctx = makeDeps([]); });

describe("reuse branch", () => {
  it("emits flow:run into a supplied live, cwd-matched invoicebot session — no spawn", async () => {
    ctx.addSession({ id: "sess-live", cwd: CWD, automationRun: { name: "invoicebot:process", runId: "r0" } });
    const link = createSessionLink(ctx.deps);
    const sid = await link.dispatchFlow({ cwd: CWD, flow: FLOW, sessionId: "sess-live", invoiceId: "inv1" });
    expect(sid).toBe("sess-live");
    expect(ctx.spawns).toHaveLength(0);
    expect(ctx.emits).toEqual([{ sessionId: "sess-live", eventType: "flow:run", data: FLOW }]);
    expect(link.resolveSessionId("inv1", CWD)).toBe("sess-live");
  });

  it("reuse never targets an unrelated (wrong-cwd) session → falls through to spawn", async () => {
    ctx.addSession({ id: "sess-other", cwd: "/other", automationRun: { name: "invoicebot:process", runId: "r0" } });
    const link = createSessionLink(ctx.deps);
    const p = link.dispatchFlow({ cwd: CWD, flow: FLOW, sessionId: "sess-other" });
    // spawn happened; simulate the run session registering
    await Promise.resolve();
    const runId = ctx.spawns[0].automationRun.runId;
    ctx.addSession({ id: "sess-spawned", cwd: CWD, automationRun: { name: "invoicebot:process", runId } });
    ctx.fire("sess-spawned");
    const sid = await p;
    expect(sid).toBe("sess-spawned");
    // never emitted into the unrelated session
    expect(ctx.emits.some((e) => e.sessionId === "sess-other")).toBe(false);
  });

  it("a non-invoicebot session (no automationRun) is not a reuse target", async () => {
    ctx.addSession({ id: "user-sess", cwd: CWD });
    const link = createSessionLink(ctx.deps);
    const p = link.dispatchFlow({ cwd: CWD, flow: FLOW, sessionId: "user-sess" });
    await Promise.resolve();
    const runId = ctx.spawns[0].automationRun.runId;
    ctx.addSession({ id: "run-sess", cwd: CWD, automationRun: { name: "invoicebot:process", runId } });
    ctx.fire("run-sess");
    expect(await p).toBe("run-sess");
    expect(ctx.emits.some((e) => e.sessionId === "user-sess")).toBe(false);
  });
});

describe("spawn + runId correlation", () => {
  it("binds by runId, not cwd — a same-cwd decoy is NOT mis-bound", async () => {
    const link = createSessionLink(ctx.deps);
    const p = link.dispatchFlow({ cwd: CWD, flow: FLOW, invoiceId: "inv1" });
    await Promise.resolve();
    const runId = ctx.spawns[0].automationRun.runId;
    // a decoy session in the SAME cwd but WITHOUT the matching runId
    ctx.addSession({ id: "decoy", cwd: CWD, automationRun: { name: "invoicebot:process", runId: "DIFFERENT" } });
    ctx.fire("decoy");
    // decoy must not bind or receive the flow
    expect(ctx.emits.some((e) => e.sessionId === "decoy")).toBe(false);
    // the real run session registers
    ctx.addSession({ id: "real-run", cwd: CWD, automationRun: { name: "invoicebot:process", runId } });
    ctx.fire("real-run");
    const sid = await p;
    expect(sid).toBe("real-run");
    expect(ctx.emits).toEqual([{ sessionId: "real-run", eventType: "flow:run", data: FLOW }]);
    expect(link.resolveSessionId("inv1", CWD)).toBe("real-run");
  });

  it("bind timeout → returns the spawnToken fallback", async () => {
    const link = createSessionLink(ctx.deps);
    const sid = await link.dispatchFlow({ cwd: CWD, flow: FLOW }); // no session ever registers
    expect(sid).toBe("tok-1");
  });

  it("spawn rejection → undefined", async () => {
    ctx.deps.spawnSession = async () => ({ success: false, message: "untrusted" });
    const link = createSessionLink(ctx.deps);
    expect(await link.dispatchFlow({ cwd: CWD, flow: FLOW })).toBeUndefined();
  });
});

// Per-invoice scope env. See change: scope-session-toolset-by-profile.
describe("per-invoice scope env", () => {
  it("a bound invoiceId spawn carries IB_TOOLSET=scoped-invoice + IB_INVOICE_ID", async () => {
    const link = createSessionLink(ctx.deps);
    link.dispatchFlow({ cwd: CWD, flow: FLOW, invoiceId: "inv-42" });
    await Promise.resolve();
    expect(ctx.spawns).toHaveLength(1);
    expect(ctx.spawns[0].env).toEqual({ IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "inv-42" });
  });

  it("an unbound spawn (no invoiceId) carries no env — Ask session unchanged", async () => {
    const link = createSessionLink(ctx.deps);
    link.dispatchFlow({ cwd: CWD, flow: FLOW });
    await Promise.resolve();
    expect(ctx.spawns).toHaveLength(1);
    expect(ctx.spawns[0].env).toBeUndefined();
  });
});

describe("recordedSessionIdsFromDetails", () => {
  it("selects valid session ids newest-first and ignores malformed rows", () => {
    expect(recordedSessionIdsFromDetails({
      runs: [
        { session_id: "older", started_at: "2026-01-01T00:00:00Z" },
        { session_id: 42, started_at: "2027-01-01T00:00:00Z" },
        { session_id: "newer", started_at: "2026-02-01T00:00:00Z" },
        { session_id: "fallback-latest" },
      ],
    })).toEqual(["newer", "older", "fallback-latest"]);
    expect(recordedSessionIdsFromDetails({ runs: "bad" })).toEqual([]);
  });
});

describe("ensureScopedSession", () => {
  it("reuses an exact live flow-less scoped session discovered from persisted automation metadata", async () => {
    ctx.addSession({
      id: "scoped-live",
      cwd: CWD,
      status: "idle",
      automationRun: { name: "invoicebot-scoped:inv-42", runId: "r-scoped" },
    });
    const link = createSessionLink(ctx.deps);
    expect(await link.ensureScopedSession(CWD, "inv-42")).toBe("scoped-live");
    expect(ctx.spawns).toHaveLength(0);
  });

  it("does not reuse ended, wrong-cwd, or other-invoice scoped sessions", async () => {
    ctx.addSession({ id: "ended", cwd: CWD, status: "ended", automationRun: { name: "invoicebot-scoped:inv-42", runId: "r1" } });
    ctx.addSession({ id: "wrong-cwd", cwd: "/other", status: "active", automationRun: { name: "invoicebot-scoped:inv-42", runId: "r2" } });
    ctx.addSession({ id: "wrong-invoice", cwd: CWD, status: "active", automationRun: { name: "invoicebot-scoped:inv-99", runId: "r3" } });
    const link = createSessionLink(ctx.deps);
    const pending = link.ensureScopedSession(CWD, "inv-42");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctx.spawns).toHaveLength(1);
    const runId = ctx.spawns[0].automationRun.runId;
    ctx.addSession({ id: "fresh", cwd: CWD, status: "active", automationRun: { name: "invoicebot-scoped:inv-42", runId } });
    ctx.fire("fresh");
    expect(await pending).toBe("fresh");
  });

  it("uses recorded ids newest-first: live directly, ended only when its file exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ib-scoped-session-"));
    try {
      const file = join(dir, "session.jsonl");
      writeFileSync(file, "");
      ctx.addSession({ id: "missing-file", cwd: CWD, status: "ended", sessionFile: join(dir, "gone.jsonl"), automationRun: { name: "invoicebot:process", runId: "r1" } });
      ctx.addSession({ id: "resumable", cwd: CWD, status: "ended", sessionFile: file, automationRun: { name: "invoicebot:process", runId: "r2" } });
      ctx.setRecordedIds(["missing-file", "resumable"]);
      const link = createSessionLink(ctx.deps);
      expect(await link.ensureScopedSession(CWD, "inv-42")).toBe("resumable");
      expect(ctx.spawns).toHaveLength(0);

      ctx.addSession({ id: "live-run", cwd: CWD, status: "streaming", automationRun: { name: "invoicebot:process", runId: "r3" } });
      ctx.setRecordedIds(["live-run", "resumable"]);
      expect(await link.ensureScopedSession(CWD, "inv-42")).toBe("live-run");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spawns flow-less with scoped env, correlates by runId, emits no flow, and reuses the link", async () => {
    const link = createSessionLink(ctx.deps);
    const pending = link.ensureScopedSession(CWD, "inv 42");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctx.spawns).toHaveLength(1);
    expect(ctx.spawns[0]).toMatchObject({
      cwd: CWD,
      guard: true,
      env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "inv 42" },
      automationRun: { name: "invoicebot-scoped:inv%2042", visibility: "shown" },
    });
    const runId = ctx.spawns[0].automationRun.runId;
    ctx.addSession({ id: "scoped-new", cwd: CWD, status: "active", automationRun: { name: "invoicebot-scoped:inv%2042", runId } });
    ctx.fire("scoped-new");
    expect(await pending).toBe("scoped-new");
    expect(ctx.emits).toHaveLength(0);
    expect(await link.ensureScopedSession(CWD, "inv 42")).toBe("scoped-new");
    expect(ctx.spawns).toHaveLength(1);
  });

  it("returns undefined on spawn rejection, throw, or bind timeout — never the spawnToken", async () => {
    ctx.deps.spawnSession = async () => ({ success: false, message: "rejected", spawnToken: "not-a-session" });
    let link = createSessionLink(ctx.deps);
    expect(await link.ensureScopedSession(CWD, "inv-42")).toBeUndefined();
    link.dispose();

    ctx.deps.spawnSession = async () => { throw new Error("boom"); };
    link = createSessionLink(ctx.deps);
    expect(await link.ensureScopedSession(CWD, "inv-42")).toBeUndefined();
    link.dispose();

    ctx.deps.spawnSession = async (opts) => { ctx.spawns.push(opts); return { success: true, spawnToken: "not-a-session" }; };
    ctx.deps.spawnBindTimeoutMs = 5;
    link = createSessionLink(ctx.deps);
    expect(await link.ensureScopedSession(CWD, "inv-42")).toBeUndefined();
  });
});

describe("resolveSessionId", () => {
  it("returns the recorded link", async () => {
    ctx.addSession({ id: "sess-live", cwd: CWD, automationRun: { name: "invoicebot:process", runId: "r0" } });
    const link = createSessionLink(ctx.deps);
    await link.dispatchFlow({ cwd: CWD, flow: FLOW, sessionId: "sess-live", invoiceId: "inv9" });
    expect(link.resolveSessionId("inv9", CWD)).toBe("sess-live");
  });

  it("falls back to a scan for an intake-spawned session", () => {
    ctx.addSession({ id: "intake-1", cwd: CWD, automationRun: { name: "invoicebot-intake", runId: "rx" } });
    const link = createSessionLink(ctx.deps);
    expect(link.resolveSessionId("never-linked", CWD)).toBe("intake-1");
  });

  it("returns null (no throw) when nothing matches", () => {
    const link = createSessionLink(ctx.deps);
    expect(link.resolveSessionId("unknown", CWD)).toBeNull();
  });
});
