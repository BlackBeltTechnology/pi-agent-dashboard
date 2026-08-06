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
import { createCanonicalSessionStore, type CanonicalSessionStore } from "../canonical-session-store.js";

const CWD = "/work/acme";
const FLOW: FlowRunSpec = { flowName: "invoicebot:process", task: "source://inv1" };

interface Sess {
  id: string;
  cwd?: string;
  status?: "active" | "idle" | "streaming" | "ended";
  sessionFile?: string;
  automationRun?: { runId?: string; name?: string };
}

function makeDeps(sessions: Sess[], canonicalStore?: CanonicalSessionStore) {
  const store = new Map(sessions.map((s) => [s.id, s]));
  const emits: { sessionId: string; eventType: string; data: any }[] = [];
  const spawns: any[] = [];
  let eventHandler: ((sessionId: string, event: unknown) => void) | null = null;
  let recordedIds: string[] = [];
  const deps: SessionLinkDeps = {
    spawnSession: async (opts) => { spawns.push(opts); return { success: true, spawnToken: "tok-1" }; },
    emitEventToSession: (sessionId, eventType, data) => {
      const s = store.get(sessionId);
      // An ended session has no live bridge — emit fails (models sendToSession=false).
      if (!s || s.status === "ended") return false;
      emits.push({ sessionId, eventType, data });
      return true;
    },
    getSession: (id) => store.get(id),
    listAll: () => [...store.values()],
    onEvent: (h) => { eventHandler = h; return () => { eventHandler = null; }; },
    resolveRecordedSessionIds: async () => recordedIds,
    logger: { info: () => {}, warn: () => {} },
    spawnBindTimeoutMs: 200,
    ...(canonicalStore ? { canonicalStore } : {}),
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

// Durable canonical identity via the dedicated store (Decision 1, Option B).
// See change: make-invoice-session-canonical (§1 + §1b).
describe("durable canonical identity (dedicated store)", () => {
  let dir: string;
  let storeFile: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ib-canon-link-"));
    storeFile = join(dir, "canonical-sessions.json");
  });

  it("1.1 reuses a live canonical session from the store — no spawn, no stamp needed", async () => {
    const store = createCanonicalSessionStore(storeFile);
    store.set(CWD, "inv-1", "canon-live");
    // Stampless on purpose: the store binding is the authority, not automationRun.
    ctx = makeDeps([{ id: "canon-live", cwd: CWD, status: "idle" }], store);
    const link = createSessionLink(ctx.deps);
    expect(await link.ensureScopedSession(CWD, "inv-1")).toBe("canon-live");
    expect(ctx.spawns).toHaveLength(0);
  });

  it("1.2 returns an ended-but-restorable canonical id (sessionFile exists) — no spawn", async () => {
    const file = join(dir, "canon.jsonl");
    writeFileSync(file, "");
    const store = createCanonicalSessionStore(storeFile);
    store.set(CWD, "inv-2", "canon-ended");
    ctx = makeDeps([{ id: "canon-ended", cwd: CWD, status: "ended", sessionFile: file }], store);
    const link = createSessionLink(ctx.deps);
    expect(await link.ensureScopedSession(CWD, "inv-2")).toBe("canon-ended");
    expect(ctx.spawns).toHaveLength(0);
  });

  it("1.3 reconstructs the canonical id from the store after a restart (real disk round-trip)", async () => {
    // Instance A records the link and writes it to disk.
    createCanonicalSessionStore(storeFile).set(CWD, "inv-3", "canon-3");
    // Restart: a BRAND-NEW store instance, in-memory cache gone, reads from disk.
    const restarted = createCanonicalSessionStore(storeFile);
    ctx = makeDeps([{ id: "canon-3", cwd: CWD, status: "active" }], restarted);
    const link = createSessionLink(ctx.deps);
    expect(await link.ensureScopedSession(CWD, "inv-3")).toBe("canon-3");
    expect(ctx.spawns).toHaveLength(0);
  });

  it("1.4 ended canonical with a missing sessionFile re-spawns once and re-points the store", async () => {
    const store = createCanonicalSessionStore(storeFile);
    store.set(CWD, "inv-4", "canon-gone");
    ctx = makeDeps([{ id: "canon-gone", cwd: CWD, status: "ended", sessionFile: join(dir, "gone.jsonl") }], store);
    const link = createSessionLink(ctx.deps);
    const pending = link.ensureScopedSession(CWD, "inv-4");
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.spawns).toHaveLength(1);
    const runId = ctx.spawns[0].automationRun.runId;
    ctx.addSession({ id: "canon-fresh", cwd: CWD, status: "active", automationRun: { name: "invoicebot-scoped:inv-4", runId } });
    ctx.fire("canon-fresh");
    expect(await pending).toBe("canon-fresh");
    expect(store.get(CWD, "inv-4")).toBe("canon-fresh");
  });

  it("1b.1 re-points the store to a resume successor once it registers", async () => {
    const file = join(dir, "canon5.jsonl");
    writeFileSync(file, "");
    const store = createCanonicalSessionStore(storeFile);
    store.set(CWD, "inv-5", "canon-ended5");
    ctx = makeDeps([{ id: "canon-ended5", cwd: CWD, status: "ended", sessionFile: file }], store);
    const link = createSessionLink(ctx.deps);
    // Resolve hands back the ended-restorable id AND arms a pending re-point.
    expect(await link.ensureScopedSession(CWD, "inv-5")).toBe("canon-ended5");
    expect(ctx.spawns).toHaveLength(0);
    // Transport resumes it: a stampless successor session registers in the cwd.
    ctx.addSession({ id: "successor5", cwd: CWD, status: "active" });
    ctx.fire("successor5");
    expect(store.get(CWD, "inv-5")).toBe("successor5");
    expect(await link.ensureScopedSession(CWD, "inv-5")).toBe("successor5");
    expect(ctx.spawns).toHaveLength(0);
  });

  it("1b re-point does not fire while a spawn is in flight for the cwd", async () => {
    const store = createCanonicalSessionStore(storeFile);
    // No live/restorable canonical → resolution spawns; meanwhile a stray
    // registration in the cwd must NOT be mistaken for a resume successor.
    ctx = makeDeps([], store);
    const link = createSessionLink(ctx.deps);
    const pending = link.ensureScopedSession(CWD, "inv-6");
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.spawns).toHaveLength(1);
    const runId = ctx.spawns[0].automationRun.runId;
    // A stray stampless session appears mid-spawn — guard must ignore it.
    ctx.addSession({ id: "stray", cwd: CWD, status: "active" });
    ctx.fire("stray");
    ctx.addSession({ id: "scoped6", cwd: CWD, status: "active", automationRun: { name: "invoicebot-scoped:inv-6", runId } });
    ctx.fire("scoped6");
    expect(await pending).toBe("scoped6");
    expect(store.get(CWD, "inv-6")).toBe("scoped6");
  });
});

// dispatchFlow resolves the invoice's canonical session and reuses (live) or
// resumes (ended/bridgeless) it; a new invoice still spawns exactly one.
// See change: make-invoice-session-canonical (§6).
describe("dispatchFlow canonical reuse/resume (§6)", () => {
  let dir: string;
  let storeFile: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ib-canon-dispatch-"));
    storeFile = join(dir, "canonical-sessions.json");
  });

  it("6.1 live canonical is reused — flow:run delivered, no spawn", async () => {
    const store = createCanonicalSessionStore(storeFile);
    store.set(CWD, "inv-1", "canon-live");
    // Stampless live session (e.g. a resumed successor) — store is the authority.
    ctx = makeDeps([{ id: "canon-live", cwd: CWD, status: "idle" }], store);
    const link = createSessionLink(ctx.deps);
    const sid = await link.dispatchFlow({ cwd: CWD, flow: FLOW, invoiceId: "inv-1" });
    expect(sid).toBe("canon-live");
    expect(ctx.spawns).toHaveLength(0);
    expect(ctx.emits).toContainEqual({ sessionId: "canon-live", eventType: "flow:run", data: FLOW });
    expect(store.get(CWD, "inv-1")).toBe("canon-live");
  });

  it("6.2 ended/bridgeless canonical resumes it and delivers — no fresh one-shot spawn", async () => {
    const file = join(dir, "canon2.jsonl");
    writeFileSync(file, "");
    const store = createCanonicalSessionStore(storeFile);
    store.set(CWD, "inv-2", "canon-ended");
    ctx = makeDeps([{ id: "canon-ended", cwd: CWD, status: "ended", sessionFile: file }], store);
    const link = createSessionLink(ctx.deps);
    const p = link.dispatchFlow({ cwd: CWD, flow: FLOW, invoiceId: "inv-2" });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.spawns).toHaveLength(1);
    // The spawn is a RESUME of the canonical transcript, not a fresh one-shot.
    expect(ctx.spawns[0].resumeSessionFile).toBe(file);
    const runId = ctx.spawns[0].automationRun.runId;
    ctx.addSession({ id: "resumed-succ", cwd: CWD, status: "active", automationRun: { name: FLOW.flowName, runId } });
    ctx.fire("resumed-succ");
    expect(await p).toBe("resumed-succ");
    expect(ctx.emits).toContainEqual({ sessionId: "resumed-succ", eventType: "flow:run", data: FLOW });
    expect(store.get(CWD, "inv-2")).toBe("resumed-succ"); // canonical re-pointed to the successor
  });

  it("6.3 no canonical session spawns exactly one and records it as canonical", async () => {
    const store = createCanonicalSessionStore(storeFile);
    ctx = makeDeps([], store);
    const link = createSessionLink(ctx.deps);
    const p = link.dispatchFlow({ cwd: CWD, flow: FLOW, invoiceId: "inv-3" });
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.spawns).toHaveLength(1);
    expect(ctx.spawns[0].resumeSessionFile).toBeUndefined(); // fresh spawn, not a resume
    const runId = ctx.spawns[0].automationRun.runId;
    ctx.addSession({ id: "fresh-run", cwd: CWD, status: "active", automationRun: { name: FLOW.flowName, runId } });
    ctx.fire("fresh-run");
    expect(await p).toBe("fresh-run");
    expect(store.get(CWD, "inv-3")).toBe("fresh-run");
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
