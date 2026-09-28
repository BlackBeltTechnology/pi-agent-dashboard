/**
 * Tests for the transcript-sourced session diff (change:
 * fix-session-diff-durable-source).
 *
 * Covers the diff-only projection (`projectDiffEvents`), the source resolution
 * (`resolveDiffSource`), and the `/api/session-diff` route over real temp git
 * repos + real on-disk JSONL transcripts. The route-level fixtures live here
 * (not in `session-diff.test.ts`) because that file mocks `node:fs`/git at
 * module scope, which is incompatible with real transcripts + repos.
 *
 * See change: fix-session-diff-durable-source.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Wrap the real `stat` so E8 (origin gate) can prove the remote sessionFile is
// never stat'ed and X1 (EACCES) can inject a fault. Delegates to the real impl.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

import {
  capString,
  createMemoryEventStore,
  DEFAULT_MAX_STRING_SIZE,
  type EventStore,
} from "../persistence/memory-event-store.js";
import { registerSessionRoutes } from "../routes/session-routes.js";
import { extractFileChanges } from "../session/session-diff.js";
import { projectDiffEvents, resolveDiffSource } from "../session/session-diff-source.js";
import { loadSessionEntries } from "../session/session-file-reader.js";
import {
  createSessionLoadWorkerPool,
  type SessionLoadWorkerPool,
} from "../session/session-load-worker-pool.js";

const PASSTHRU_GUARD = async () => {};

// ── fixtures ────────────────────────────────────────────────────────────────

function iso(ms: number): string { return new Date(ms).toISOString(); }

function call(id: string, name: string, args: Record<string, unknown>): any {
  return { type: "toolCall", id, name, arguments: args };
}
function assistant(ms: number, text: string, toolCalls: any[] = [], id?: string, parentId?: string | null): any {
  return {
    type: "message", ...(id ? { id } : {}), ...(parentId !== undefined ? { parentId } : {}),
    timestamp: iso(ms),
    message: { role: "assistant", content: [{ type: "text", text }, ...toolCalls] },
  };
}
function userMsg(ms: number, text: string, id?: string): any {
  return { type: "message", ...(id ? { id } : {}), timestamp: iso(ms), message: { role: "user", content: [{ type: "text", text }] } };
}
function toolResult(ms: number, toolCallId: string, toolName = "Bash", id?: string, parentId?: string | null): any {
  return {
    type: "message", ...(id ? { id } : {}), ...(parentId !== undefined ? { parentId } : {}),
    timestamp: iso(ms),
    message: { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text: "ok" }], isError: false },
  };
}
function writeCall(id: string, path: string, content = "x") { return call(id, "Write", { path, content }); }
function editCall(id: string, path: string, edits: any[] = [{ oldText: "a", newText: "b" }]) { return call(id, "Edit", { path, edits }); }
function bashCall(id: string, command: string) { return call(id, "Bash", { command }); }

function writeTranscript(path: string, entries: any[]): string {
  const header = { type: "session", id: `sess-${path.split("/").pop()}`, cwd: "/tmp" };
  writeFileSync(path, toJsonl([header, ...entries]));
  return path;
}

/** JSONL-encode entries with a trailing newline. */
function toJsonl(entries: unknown[]): string {
  return `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

function ingestToolStart(store: EventStore, sessionId: string, toolName: string, args: Record<string, unknown>, timestamp: number) {
  store.insertEvent(sessionId, {
    eventType: "tool_execution_start",
    timestamp,
    data: { type: "tool_execution_start", toolName, toolCallId: `tc-${timestamp}`, args },
  });
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "sds-repo-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "README.md"), "init\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}
function setMtime(p: string, ms: number): void {
  const s = ms / 1000;
  utimesSync(p, s, s);
}

async function buildHarness(opts: {
  session: any;
  store: EventStore;
  pool?: () => SessionLoadWorkerPool | null;
  maxStringSize?: number;
}): Promise<FastifyInstance> {
  const f = Fastify();
  f.get("/api/health", async () => ({ ok: true }));
  registerSessionRoutes(f, {
    sessionManager: {
      listAll: () => [],
      get: (id: string) => (id === opts.session.id ? opts.session : undefined),
    } as any,
    eventStore: opts.store,
    networkGuard: PASSTHRU_GUARD,
    loadWorkerPool: opts.pool ?? (() => null),
    ...(opts.maxStringSize !== undefined ? { maxStringSize: opts.maxStringSize } : {}),
  });
  await f.ready();
  return f;
}

async function getDiff(f: FastifyInstance, sessionId = "s1") {
  const res = await f.inject({ method: "GET", url: `/api/session-diff?sessionId=${sessionId}` });
  return { status: res.statusCode, body: JSON.parse(res.payload) };
}

/** A pool stub that projects for real, synchronously (records call count). */
function realishFakePool(delayMs = 0) {
  const load = vi.fn((req: any) => {
    const entries = loadSessionEntries(req.sessionFile);
    const proj = projectDiffEvents(req.sessionId, entries, { maxStringSize: req.maxStringSize });
    const result = delayMs > 0
      ? new Promise((res) => setTimeout(() => res({ jobId: 1, success: true, events: proj.events, entryCount: entries.length, lastEntryTs: proj.lastEntryTs }), delayMs))
      : Promise.resolve({ jobId: 1, success: true, events: proj.events, entryCount: entries.length, lastEntryTs: proj.lastEntryTs });
    return { jobId: 1, result };
  });
  const pool = { load, cancel: vi.fn(), dispose: vi.fn(async () => {}), inFlight: () => 0 } as unknown as SessionLoadWorkerPool;
  return { pool, load };
}

// ── projection ──────────────────────────────────────────────────────────────

describe("projectDiffEvents — projection (5.1–5.4)", () => {
  const TS = 1_000_000;
  const cwd = "/project";

  it("5.1 message attribution + live order (E4)", () => {
    const entries = [
      assistant(TS, "first", [editCall("c1", "a.ts")]),
      assistant(TS + 10, "second", [editCall("c2", "b.ts")]),
    ];
    const { events } = projectDiffEvents("s1", entries);
    // Live order: message_end(A), start(a), message_end(B), start(b).
    expect(events.map((e) => e.eventType)).toEqual([
      "message_end", "tool_execution_start", "message_end", "tool_execution_start",
    ]);
    const files = extractFileChanges(events, cwd);
    expect(files.find((f) => f.path === "a.ts")!.changes[0].message).toBe("first");
    expect(files.find((f) => f.path === "b.ts")!.changes[0].message).toBe("second");
  });

  it("5.2 truncation parity at cap+1 vs a default store (E10)", () => {
    const sid = "s1";
    const store = createMemoryEventStore(() => false);
    const content = "A".repeat(DEFAULT_MAX_STRING_SIZE + 1);
    const edits = Array.from({ length: 21 }, (_, i) => ({ oldText: `o${i}`, newText: `n${i}` }));
    ingestToolStart(store, sid, "Write", { path: "a.ts", content }, TS);
    ingestToolStart(store, sid, "Edit", { path: "b.ts", edits }, TS + 1);
    const stored = store.getEvents(sid, 0).map((e) => e.event);

    const { events } = projectDiffEvents(sid, [
      assistant(TS, "go", [writeCall("c1", "a.ts", content), editCall("c2", "b.ts", edits)]),
    ], { maxStringSize: DEFAULT_MAX_STRING_SIZE });

    const projStarts = events.filter((e) => e.eventType === "tool_execution_start").map((e) => e.data.args);
    const storeStarts = stored.filter((e) => e.eventType === "tool_execution_start").map((e) => e.data.args);
    expect(projStarts).toEqual(storeStarts);

    const projFiles = extractFileChanges(events, cwd);
    const storeFiles = extractFileChanges(stored, cwd);
    expect(projFiles.find((f) => f.path === "b.ts")!.changes[0].truncated).toBe(true);
    expect(storeFiles.find((f) => f.path === "b.ts")!.changes[0].truncated).toBe(true);
    expect(projFiles.find((f) => f.path === "a.ts")!.changes[0].truncated).toBeUndefined();
  });

  it("5.3 truncation cap boundary: exactly cap is untouched (E11)", () => {
    const content = "A".repeat(DEFAULT_MAX_STRING_SIZE);
    const edits = Array.from({ length: 20 }, (_, i) => ({ oldText: `o${i}`, newText: `n${i}` }));
    const { events } = projectDiffEvents("s1", [
      assistant(TS, "go", [writeCall("c1", "a.ts", content), editCall("c2", "b.ts", edits)]),
    ], { maxStringSize: DEFAULT_MAX_STRING_SIZE });
    const files = extractFileChanges(events, cwd);
    expect(files.find((f) => f.path === "a.ts")!.changes[0].content).toHaveLength(DEFAULT_MAX_STRING_SIZE);
    expect(files.find((f) => f.path === "b.ts")!.changes[0].edits).toHaveLength(20);
    expect(files.every((f) => f.changes[0].truncated === undefined)).toBe(true);
  });

  it("5.4 projection event set + lastEntryTs uses the latest entry (E12)", () => {
    const T = TS;
    const entries = [
      userMsg(T, "hi"),
      assistant(T + 1, "text only"),
      assistant(T + 2, "run it", [bashCall("c1", "true")]),
      toolResult(T + 3, "c1", "Bash"),
      { type: "compaction", timestamp: iso(T + 4), summary: "s" },
      { type: "model_change", timestamp: iso(T + 9), provider: "anthropic", modelId: "x" },
    ];
    const { events, lastEntryTs } = projectDiffEvents("s1", entries);
    expect(new Set(events.map((e) => e.eventType))).toEqual(
      new Set(["message_end", "tool_execution_start", "tool_execution_end"]),
    );
    expect(events.filter((e) => e.eventType === "message_end")).toHaveLength(2);
    expect(lastEntryTs).toBe(T + 9);
  });
});

// ── route: source resolution / ownership / loss modes ───────────────────────

describe("session-diff source resolution + loss modes (5.5–5.10, 6.x)", () => {
  let dir: string;
  let repo: string;
  let fastify: FastifyInstance | null = null;

  beforeEach(() => {
    vi.mocked(stat).mockClear();
    dir = mkdtempSync(join(tmpdir(), "sds-"));
    repo = makeRepo();
  });
  afterEach(async () => {
    if (fastify) { await fastify.close(); fastify = null; }
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const localSession = (sessionFile?: string, status = "active") => ({ id: "s1", cwd: repo, status, ...(sessionFile ? { sessionFile } : {}) });

  it("6.2 restart/evicted loss mode: transcript beats the store (E2)", async () => {
    const file = writeTranscript(join(dir, "s.jsonl"), [
      assistant(1000, "a", [editCall("c1", "e1.ts")]),
      assistant(1001, "b", [editCall("c2", "e2.ts")]),
      assistant(1002, "c", [editCall("c3", "e3.ts")]),
      assistant(1003, "d", [writeCall("c4", "w1.ts")]),
    ]);
    fastify = await buildHarness({ session: localSession(file), store: createMemoryEventStore(() => false) });
    const { status, body } = await getDiff(fastify);
    expect(status).toBe(200);
    expect(body.data.files).toHaveLength(4);
    expect(body.data.otherChanges).toEqual([]);
    const types = Object.fromEntries(body.data.files.map((f: any) => [f.path, f.changes[0].type]));
    expect(types["e1.ts"]).toBe("edit");
    expect(types["w1.ts"]).toBe("write");
  });

  it("6.1 trim loss mode: every trimmed Write start is recovered (E1)", async () => {
    const store = createMemoryEventStore(() => false, undefined, 50);
    const paths = Array.from({ length: 10 }, (_, i) => `t${i}.ts`);
    paths.forEach((p, i) => ingestToolStart(store, "s1", "Write", { path: p, content: "x" }, 1000 + i));
    for (let i = 0; i < 200; i++) {
      store.insertEvent("s1", { eventType: "tool_execution_update", timestamp: 2000 + i, data: { type: "tool_execution_update", toolCallId: `z-${i}`, partialResult: { x: i } } });
    }
    // Trim really happened and dropped every Write start from the store.
    expect(store.getTrimStats().trimmedEvents.bySession["s1"]).toBeGreaterThan(0);
    expect(store.getEvents("s1", 0).some((e) => e.event.eventType === "tool_execution_start")).toBe(false);

    const file = writeTranscript(join(dir, "s.jsonl"), [
      assistant(1000, "w", paths.map((p, i) => writeCall(`c${i}`, p))),
    ]);
    fastify = await buildHarness({ session: localSession(file), store });
    const { body } = await getDiff(fastify);
    expect(body.data.files).toHaveLength(10);
    for (const p of paths) {
      expect(body.data.files.find((f: any) => f.path === p)?.sessionOwned).toBe(true);
      expect(body.data.otherChanges.some((f: any) => f.path === p)).toBe(false);
    }
  });

  it("6.3 branch walk: ancestor included, sibling branch excluded (E3)", async () => {
    const file = join(dir, "branch.jsonl");
    writeTranscript(file, []); // header only; overwrite below
    const entries = [
      { type: "session", id: "sess", cwd: "/tmp" },
      assistant(1000, "", [writeCall("c1", "ancestor.ts")], "e1", null),
      assistant(1001, "", [writeCall("c2", "sibling.ts")], "e2", "e1"),
      assistant(1002, "", [writeCall("c3", "leaf.ts")], "e3", "e1"),
    ];
    writeFileSync(file, toJsonl(entries));
    fastify = await buildHarness({ session: localSession(file), store: createMemoryEventStore(() => false) });
    const { body } = await getDiff(fastify);
    const paths = body.data.files.map((f: any) => f.path);
    expect(paths).toContain("ancestor.ts");
    expect(paths).toContain("leaf.ts");
    expect(paths).not.toContain("sibling.ts");
  });

  it("6.4 fallback: missing transcript → store, same response keys (E5)", async () => {
    const store = createMemoryEventStore(() => false);
    ingestToolStart(store, "s1", "Write", { path: "w1.ts", content: "x" }, 1000);
    ingestToolStart(store, "s1", "Write", { path: "w2.ts", content: "x" }, 1001);
    fastify = await buildHarness({ session: localSession(join(dir, "missing.jsonl")), store });
    const { status, body } = await getDiff(fastify);
    expect(status).toBe(200);
    expect(body.data.files).toHaveLength(2);
    expect(Object.keys(body.data).sort()).toEqual(
      ["baseLabel", "diffBase", "files", "isGitRepo", "otherChanges", "vcsKind"].sort(),
    );
  });

  it("6.5 fallback: header-only transcript → store (E6)", async () => {
    const file = join(dir, "header.jsonl");
    writeFileSync(file, `${JSON.stringify({ type: "session", id: "sess", cwd: "/tmp" })}\n`);
    const store = createMemoryEventStore(() => false);
    ingestToolStart(store, "s1", "Edit", { path: "from-store.ts", edits: [{ oldText: "a", newText: "b" }] }, 1000);
    fastify = await buildHarness({ session: localSession(file), store });
    const { body } = await getDiff(fastify);
    expect(body.data.files.map((f: any) => f.path)).toEqual(["from-store.ts"]);
  });

  it("6.6 fallback: bad header → store, HTTP 200 (E7)", async () => {
    const file = join(dir, "bad.jsonl");
    writeFileSync(file, `${JSON.stringify({ type: "garbage" })}\n`);
    const store = createMemoryEventStore(() => false);
    ingestToolStart(store, "s1", "Edit", { path: "from-store.ts", edits: [{ oldText: "a", newText: "b" }] }, 1000);
    fastify = await buildHarness({ session: localSession(file), store });
    const { status, body } = await getDiff(fastify);
    expect(status).toBe(200);
    expect(body.data.files.map((f: any) => f.path)).toEqual(["from-store.ts"]);
  });

  it("5.5 origin gate: remote session never reads the local transcript (E8)", async () => {
    const file = writeTranscript(join(dir, "remote.jsonl"), [
      assistant(1000, "", Array.from({ length: 5 }, (_, i) => writeCall(`c${i}`, `r${i}.ts`))),
    ]);
    const store = createMemoryEventStore(() => false);
    ingestToolStart(store, "s1", "Edit", { path: "store-only.ts", edits: [{ oldText: "a", newText: "b" }] }, 1000);
    fastify = await buildHarness({ session: { id: "s1", cwd: repo, status: "active", sessionFile: file, originDeviceId: "remote-1" }, store });
    const { status, body } = await getDiff(fastify);
    expect(status).toBe(200);
    expect(body.data.files.map((f: any) => f.path)).toEqual(["store-only.ts"]);
    const statCalls = vi.mocked(stat).mock.calls.map((c) => String(c[0]));
    expect(statCalls.some((p) => p.includes("remote.jsonl"))).toBe(false);
  });

  it("5.6 no sessionFile → store, HTTP 200 (E9)", async () => {
    const store = createMemoryEventStore(() => false);
    ingestToolStart(store, "s1", "Write", { path: "w.ts", content: "x" }, 1000);
    fastify = await buildHarness({ session: localSession(), store });
    const { status, body } = await getDiff(fastify);
    expect(status).toBe(200);
    expect(body.data.files.map((f: any) => f.path)).toEqual(["w.ts"]);
  });

  it("5.7 stat EACCES → sourceKey t:0:0, store-sourced, 200 (X1)", async () => {
    const store = createMemoryEventStore(() => false);
    ingestToolStart(store, "s1", "Write", { path: "w.ts", content: "x" }, 1000);
    const session = localSession(join(dir, "eacces.jsonl"));
    const err: any = new Error("EACCES"); err.code = "EACCES";
    vi.mocked(stat).mockRejectedValueOnce(err);
    const src = await resolveDiffSource(session, store, { pool: null });
    expect(src.sourceKey).toBe("t:0:0");

    fastify = await buildHarness({ session, store });
    const { status, body } = await getDiff(fastify);
    expect(status).toBe(200);
    expect(body.data.files.map((f: any) => f.path)).toEqual(["w.ts"]);
  });

  it("5.8 malformed last line is skipped, no throw (X2)", async () => {
    const file = join(dir, "malformed.jsonl");
    const lines = [
      { type: "session", id: "sess", cwd: "/tmp" },
      assistant(1000, "", [writeCall("c1", "m1.ts")]),
      assistant(1001, "", [writeCall("c2", "m2.ts")]),
    ].map((e) => JSON.stringify(e));
    writeFileSync(file, `${lines.join("\n")}\n{"type":"message","timestamp":"20`);
    fastify = await buildHarness({ session: localSession(file), store: createMemoryEventStore(() => false) });
    const { body } = await getDiff(fastify);
    expect(body.data.files.map((f: any) => f.path).sort()).toEqual(["m1.ts", "m2.ts"]);
  });

  it("5.9 worker vs in-process parity (E16)", async () => {
    const file = writeTranscript(join(dir, "p.jsonl"), [
      assistant(1000, "a", [writeCall("c1", "a.ts"), writeCall("c2", "b.ts")]),
      assistant(1001, "b", [writeCall("c3", "c.ts"), bashCall("c4", "true")]),
      toolResult(1002, "c4", "Bash"),
    ]);
    const store = createMemoryEventStore(() => false);
    const pool = createSessionLoadWorkerPool({ useWorker: true, size: 1, timeoutMs: 15000 });
    try {
      const f1 = await buildHarness({ session: localSession(file), store, pool: () => pool });
      const withWorker = await getDiff(f1);
      await f1.close();
      const f2 = await buildHarness({ session: localSession(file), store });
      const inProcess = await getDiff(f2);
      await f2.close();
      expect(withWorker.body.data).toEqual(inProcess.body.data);
    } finally {
      await pool.dispose();
    }
  });

  it("5.10 pool disposed (returns null) → in-process fallback (E17)", async () => {
    const file = writeTranscript(join(dir, "d.jsonl"), [
      assistant(1000, "a", [writeCall("c1", "a.ts")]),
    ]);
    fastify = await buildHarness({ session: localSession(file), store: createMemoryEventStore(() => false), pool: () => null });
    const { status, body } = await getDiff(fastify);
    expect(status).toBe(200);
    expect(body.data.files.map((f: any) => f.path)).toEqual(["a.ts"]);
  });

  it("6.7 open Bash, live: window stays [start, now] (E13)", async () => {
    const T = Date.now() - 10_000;
    const file = writeTranscript(join(dir, "live.jsonl"), [
      assistant(T, "run", [bashCall("c1", "true")]),
    ]);
    const owned = join(repo, "owned-live.txt");
    writeFileSync(owned, "x");
    setMtime(owned, T + 5000);
    fastify = await buildHarness({ session: localSession(file, "streaming"), store: createMemoryEventStore(() => false) });
    const { body } = await getDiff(fastify);
    expect(body.data.files.map((f: any) => f.path)).toContain("owned-live.txt");
  });

  it("6.8 open Bash, ended: window clamped to last entry ts (E14)", async () => {
    const T = Date.now() - 10_000;
    const file = writeTranscript(join(dir, "ended.jsonl"), [
      assistant(T, "run", [bashCall("c1", "true")]),
      userMsg(T + 1000, "done"),
    ]);
    const strays = join(repo, "post-end.txt");
    writeFileSync(strays, "x");
    setMtime(strays, T + 60_000);
    fastify = await buildHarness({ session: localSession(file, "ended"), store: createMemoryEventStore(() => false) });
    const { body } = await getDiff(fastify);
    expect(body.data.files.some((f: any) => f.path === "post-end.txt")).toBe(false);
    expect(body.data.otherChanges.some((f: any) => f.path === "post-end.txt")).toBe(true);
  });

  it("6.9 ended clamp slack boundary: T+999ms owned, T+1001ms not (E15)", async () => {
    const T = Date.now() - 10_000;
    const file = writeTranscript(join(dir, "slack.jsonl"), [
      assistant(T, "run", [bashCall("c1", "true")]),
    ]);
    const inside = join(repo, "in-slack.txt");
    const outside = join(repo, "out-slack.txt");
    writeFileSync(inside, "x");
    writeFileSync(outside, "x");
    setMtime(inside, T + 999);
    setMtime(outside, T + 1001);
    fastify = await buildHarness({ session: localSession(file, "ended"), store: createMemoryEventStore(() => false) });
    const { body } = await getDiff(fastify);
    expect(body.data.files.map((f: any) => f.path)).toContain("in-slack.txt");
    expect(body.data.otherChanges.map((f: any) => f.path)).toContain("out-slack.txt");
    expect(body.data.files.map((f: any) => f.path)).not.toContain("out-slack.txt");
  });

  it("6.10 MAX_FILES cap on the transcript path (E18)", async () => {
    const calls = Array.from({ length: 201 }, (_, i) => writeCall(`c${i}`, `cap${i}.ts`));
    const file = writeTranscript(join(dir, "cap.jsonl"), [assistant(1000, "bulk", calls)]);
    fastify = await buildHarness({ session: localSession(file), store: createMemoryEventStore(() => false) });
    const { body } = await getDiff(fastify);
    expect(body.data.files).toHaveLength(200);
    const paths = body.data.files.map((f: any) => f.path);
    expect([...paths].sort()).toEqual(paths);
  });

  it("6.11 the route plumbs maxStringSize into the projection (store-cap parity)", async () => {
    const content = "A".repeat(DEFAULT_MAX_STRING_SIZE + 1);
    const file = writeTranscript(join(dir, "cap-args.jsonl"), [
      assistant(1000, "w", [writeCall("c1", "big.ts", content)]),
    ]);
    fastify = await buildHarness({
      session: localSession(file),
      store: createMemoryEventStore(() => false),
      maxStringSize: DEFAULT_MAX_STRING_SIZE,
    });
    const { body } = await getDiff(fastify);
    const change = body.data.files.find((f: any) => f.path === "big.ts").changes[0];
    // The projection ran `truncateStrings(args, 4000)` — same helper + cap the
    // store applies on ingest (B1 wiring guard: a `undefined` cap would skip this).
    expect(change.content).toBe(capString(content, DEFAULT_MAX_STRING_SIZE));
    expect(change.content).toContain("chars hidden");
  });
});

// ── cache + event loop ──────────────────────────────────────────────────────

describe("session-diff cache + event loop (7.1–7.7)", () => {
  let dir: string;
  let repo: string;
  let fastify: FastifyInstance | null = null;

  beforeEach(() => {
    vi.mocked(stat).mockClear();
    dir = mkdtempSync(join(tmpdir(), "sds-cache-"));
    repo = makeRepo();
  });
  afterEach(async () => {
    if (fastify) { await fastify.close(); fastify = null; }
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const localSession = (sessionFile?: string, status = "active") => ({ id: "s1", cwd: repo, status, ...(sessionFile ? { sessionFile } : {}) });

  it("7.1 cache hit skips the worker; second request < 20ms (P3)", async () => {
    const calls = Array.from({ length: 50 }, (_, i) => writeCall(`c${i}`, `f${i}.ts`));
    const file = writeTranscript(join(dir, "cache.jsonl"), [assistant(1000, "bulk", calls)]);
    const { pool, load } = realishFakePool();
    fastify = await buildHarness({ session: localSession(file), store: createMemoryEventStore(() => false), pool: () => pool });
    const first = await getDiff(fastify);
    const t = performance.now();
    const second = await getDiff(fastify);
    const secondMs = performance.now() - t;
    expect(load).toHaveBeenCalledTimes(1);
    expect(second.body.data).toEqual(first.body.data);
    // The cache hit itself does no parse; the residual is 3 git key spawns.
    expect(secondMs).toBeLessThan(250);
  });

  it("7.2 transcript key invalidation on an already-dirty file (X3)", async () => {
    writeFileSync(join(repo, "a.ts"), "dirty\n");
    const file = join(dir, "inval.jsonl");
    writeTranscript(file, [assistant(1000, "one", [editCall("c1", "a.ts")])]);
    fastify = await buildHarness({ session: localSession(file), store: createMemoryEventStore(() => false) });
    const first = await getDiff(fastify);
    expect(first.body.data.files.find((f: any) => f.path === "a.ts").changes).toHaveLength(1);
    // Append a second Edit; porcelain is unchanged (a.ts already dirty).
    appendFileSync(file, `${JSON.stringify(assistant(1001, "two", [editCall("c2", "a.ts")]))}\n`);
    const second = await getDiff(fastify);
    expect(second.body.data.files.find((f: any) => f.path === "a.ts").changes).toHaveLength(2);
  });

  it("7.3 store key invalidation on a new tool call (X4)", async () => {
    const store = createMemoryEventStore(() => false);
    ingestToolStart(store, "s1", "Write", { path: "w1.ts", content: "x" }, 1000);
    fastify = await buildHarness({ session: localSession(), store });
    const first = await getDiff(fastify);
    expect(first.body.data.files).toHaveLength(1);
    ingestToolStart(store, "s1", "Write", { path: "w2.ts", content: "x" }, 1001);
    const second = await getDiff(fastify);
    expect(second.body.data.files).toHaveLength(2);
  });

  it("7.4 streaming text alone does not bust the cache (X5)", async () => {
    const file = writeTranscript(join(dir, "stream.jsonl"), [assistant(1000, "a", [writeCall("c1", "a.ts")])]);
    const store = createMemoryEventStore(() => false);
    const { pool, load } = realishFakePool();
    fastify = await buildHarness({ session: localSession(file), store, pool: () => pool });
    const first = await getDiff(fastify);
    for (let i = 0; i < 50; i++) {
      store.insertEvent("s1", { eventType: "message_update", timestamp: 2000 + i, data: { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "delta" }] } } });
    }
    const second = await getDiff(fastify);
    expect(load).toHaveBeenCalledTimes(1);
    expect(second.body.data).toEqual(first.body.data);
  });

  it("7.5 concurrent identical requests coalesce (single-flight) (X6)", async () => {
    const file = writeTranscript(join(dir, "flight.jsonl"), [assistant(1000, "a", [writeCall("c1", "a.ts")])]);
    const { pool, load } = realishFakePool(200);
    fastify = await buildHarness({ session: localSession(file), store: createMemoryEventStore(() => false), pool: () => pool });
    const results = await Promise.all(Array.from({ length: 5 }, () => getDiff(fastify!)));
    expect(load).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r.body.data).toEqual(results[0].body.data);
  });

  it("7.6 pool timeout fallback still resolves with the correct files (X7)", async () => {
    const file = writeTranscript(join(dir, "timeout.jsonl"), [assistant(1000, "a", [writeCall("c1", "a.ts")])]);
    // Bad worker URL → spawn failure → the pool falls back in-process for the request.
    const pool = createSessionLoadWorkerPool({ useWorker: true, workerUrlOverride: "file:///definitely/not/here.mjs", timeoutMs: 50 });
    try {
      fastify = await buildHarness({ session: localSession(file), store: createMemoryEventStore(() => false), pool: () => pool });
      const { status, body } = await getDiff(fastify);
      expect(status).toBe(200);
      expect(body.data.files.map((f: any) => f.path)).toEqual(["a.ts"]);
    } finally {
      await pool.dispose();
    }
  });

  it("7.7 a large transcript does not block the event loop (P1)", async () => {
    // A real worker_threads pool does NOT spawn under vitest (the .ts worker
    // entry needs jiti on `process.execArgv`; the pool falls back in-process —
    // see `session-load-worker.test.ts`). So the production offload is proven
    // by the pool's own tests; here we prove the ROUTE's half: the heavy parse
    // is fast only when a pool owns it. The in-process sanity variant must
    // STALL (proves the assertion is falsifiable); the pool variant must not.
    const file = join(dir, "big.jsonl");
    const COUNT = 2000;
    // ~80 MB: the in-process parse must stall the loop well past the 100 ms
    // budget on a FAST CI runner too (a 40 MB fixture measured ~86 ms there).
    const bigText = "x".repeat(40_000);
    const writeBig = (target: string, count: number): void => {
      const lines: string[] = [JSON.stringify({ type: "session", id: "big", cwd: "/tmp" })];
      for (let i = 0; i < count; i++) {
        lines.push(JSON.stringify(assistant(1_000_000 + i, `step ${i}`, [editCall(`c${i}`, `f${i}.ts`, [{ oldText: "a", newText: bigText }])])));
      }
      writeFileSync(target, `${lines.join("\n")}\n`);
    };
    writeBig(file, COUNT);
    const entries = loadSessionEntries(file);
    expect(entries.length).toBe(COUNT);

    async function maxLoopGap(f: FastifyInstance, sessionId: string): Promise<{ maxGap: number; diff: any }> {
      let maxGap = 0;
      let last = performance.now();
      const sampler = setInterval(() => {
        const now = performance.now();
        maxGap = Math.max(maxGap, now - last);
        last = now;
      }, 5);
      try {
        const res = await f.inject({ method: "GET", url: `/api/session-diff?sessionId=${sessionId}` });
        return { maxGap, diff: JSON.parse(res.payload) };
      } finally {
        clearInterval(sampler);
      }
    }

    // In-process sanity: the parse runs on the main thread → the loop stalls.
    // HOW BIG a transcript that takes is hardware-dependent — the 80 MB
    // fixture stalls a CI runner ~150 ms but an M-series dev box only 66 ms,
    // which failed this gate for hardware reasons alone. Grow the fixture
    // until it crosses the floor rather than pin a size calibrated on one
    // machine. CI still settles on the first attempt.
    let stallGap = 0;
    let stallCount = COUNT;
    for (let attempt = 0; attempt < 3 && stallGap < 100; attempt++) {
      // Attempt 0 reuses the fixture the pool half needs; later attempts get
      // a scratch file, removed immediately so the doubling cannot fill /tmp.
      const scaled = attempt === 0 ? file : join(dir, `big-stall-${attempt}.jsonl`);
      if (attempt > 0) writeBig(scaled, stallCount);
      const inProc = await buildHarness({ session: { id: "s1", cwd: repo, status: "active", sessionFile: scaled }, store: createMemoryEventStore(() => false), pool: () => null, maxStringSize: 4000 });
      try {
        const { maxGap, diff } = await maxLoopGap(inProc, "s1");
        expect(diff.data.files.length).toBeGreaterThan(0);
        stallGap = maxGap;
      } finally {
        await inProc.close();
        if (attempt > 0) rmSync(scaled, { force: true });
      }
      stallCount *= 2;
    }
    expect(
      stallGap,
      `the in-process parse never stalled ≥100ms (best ${stallGap.toFixed(1)}ms up to ${stallCount / 2} entries) — ` +
        `the pool assertion below would be passing for free`,
    ).toBeGreaterThanOrEqual(100);

    // Pool owns the parse (resolved off the measured window) → loop stays responsive.
    const precomputed = projectDiffEvents("s1", entries, { maxStringSize: 4000 });
    const { pool } = realishFakePool();
    const offThread = await buildHarness({
      session: { id: "s1", cwd: repo, status: "active", sessionFile: file },
      store: createMemoryEventStore(() => false),
      maxStringSize: 4000,
      pool: () => ({
        ...pool,
        load: () => ({
          jobId: 1,
          result: new Promise((res) => setTimeout(() => res({ jobId: 1, success: true, events: precomputed.events, entryCount: COUNT, lastEntryTs: precomputed.lastEntryTs }), 200)),
        }),
      }) as unknown as SessionLoadWorkerPool,
    });
    try {
      const { maxGap, diff } = await maxLoopGap(offThread, "s1");
      expect(diff.data.files.length).toBe(200);
      expect(maxGap).toBeLessThan(100);
    } finally {
      await offThread.close();
    }
    // Explicit budget: the stall probe may rebuild a doubled fixture on fast
    // hardware, which does not fit the project's 30 s default.
  }, 120_000);

  it("7.8 live→ended transition is not served from the live cache entry (CR-5)", async () => {
    const T = Date.now() - 10_000;
    const file = writeTranscript(join(dir, "lifecycle.jsonl"), [
      assistant(T, "run", [bashCall("c1", "true")]),
    ]);
    const owned = join(repo, "lifecycle-owned.txt");
    writeFileSync(owned, "x");
    setMtime(owned, T + 5000);
    const session: any = { id: "s1", cwd: repo, status: "streaming", sessionFile: file };
    fastify = await buildHarness({ session, store: createMemoryEventStore(() => false) });
    const live = await getDiff(fastify);
    expect(live.body.data.files.map((f: any) => f.path)).toContain("lifecycle-owned.txt");

    // Session ends with the transcript AND git state unchanged (aborted call —
    // no new entry). Without the lifecycle key component the live result would
    // be served for the TTL and the file would stay session-owned.
    session.status = "ended";
    const ended = await getDiff(fastify);
    expect(ended.body.data.files.map((f: any) => f.path)).not.toContain("lifecycle-owned.txt");
    expect(ended.body.data.otherChanges.map((f: any) => f.path)).toContain("lifecycle-owned.txt");
  });
});
