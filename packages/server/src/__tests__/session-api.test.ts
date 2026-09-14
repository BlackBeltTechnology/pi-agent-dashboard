/**
 * Tests for session control REST API endpoints (session-api.ts).
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { metaPath, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { ArchivedSessionSummary } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import Fastify from "fastify";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createSessionArchive } from "../session/session-archive.js";
import { registerSessionRoutes } from "../routes/session-routes.js";
import { createServer, type DashboardServer } from "../server.js";

let httpPort: number;
let piPort: number;
let server: DashboardServer;

// Sessions whose process carrier (keeper) is genuinely alive. `resume` rejects
// "already active" ONLY when the process is provably live; a session that is
// merely RECORDED as active with a dead carrier is a crash-orphaned zombie and
// must fall through to reopen. See change: resume-zombie-active-session.
// `vi.hoisted` because `vi.mock` factories are hoisted above module init.
const { liveCarriers } = vi.hoisted(() => ({ liveCarriers: new Set<string>() }));

// Mock spawnPiSession to avoid actually spawning processes
vi.mock("../spawn-process/process-manager.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    spawnPiSession: vi.fn().mockResolvedValue({ success: true, message: "spawned" }),
    // No bridge is connected in these tests, so the keeper probe is the only
    // thing that can make a session read as genuinely live.
    getKeeperManager: () => ({
      ...orig.getKeeperManager(),
      isKeeperAlive: (sessionId: string) => liveCarriers.has(sessionId),
    }),
  };
});

function url(path: string) {
  return `http://127.0.0.1:${httpPort}${path}`;
}

async function postJson(path: string, body?: Record<string, unknown>) {
  return fetch(url(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

/** Register a fresh session, returning its id */
function registerSession(id: string, overrides?: Record<string, unknown>) {
  server.sessionManager.register({
    id,
    cwd: "/tmp/test",
    source: "tui" as const,
    startedAt: Date.now(),
    ...overrides,
  });
  return id;
}

describe("Session Control REST API", () => {
  beforeAll(async () => {
    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: true,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    });
    await server.start();
    httpPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterAll(async () => {
    if (server) {
      try { await server.stop(); } catch { /* */ }
    }
  });

  // ── prompt ──────────────────────────────────────────────────────

  it("POST /api/session/:id/prompt — 404 for unknown session", async () => {
    const res = await postJson("/api/session/unknown-id/prompt", { text: "hello" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("session not found");
  });

  it("POST /api/session/:id/prompt — 400 when text missing", async () => {
    const res = await postJson("/api/session/any-id/prompt", {});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("text is required");
  });

  // E32 — no OPEN socket: not transmitted, 502 as today.
  // See change: fix-spawn-correlation-ttl-coupling (D7).
  it("POST /api/session/:id/prompt — 502 and transmitted:false when no bridge connection", async () => {
    registerSession("prompt-no-bridge");
    const res = await postJson("/api/session/prompt-no-bridge/prompt", { text: "hello" });
    expect(res.status).toBe(502);
    const body = (await res.json()) as any;
    expect(body.error).toBe("no bridge connection for session");
    expect(body.success).toBe(false);
    expect(body.transmitted).toBe(false);
    expect(body).not.toHaveProperty("promptId");
  });

  // ── abort ───────────────────────────────────────────────────────

  it("POST /api/session/:id/abort — 404 for unknown", async () => {
    const res = await postJson("/api/session/unknown/abort");
    expect(res.status).toBe(404);
  });

  it("POST /api/session/:id/abort — success for known session", async () => {
    registerSession("abort-ok");
    const res = await postJson("/api/session/abort-ok/abort");
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  // ── shutdown ────────────────────────────────────────────────────

  it("POST /api/session/:id/shutdown — 404 for unknown", async () => {
    const res = await postJson("/api/session/unknown/shutdown");
    expect(res.status).toBe(404);
  });

  it("POST /api/session/:id/shutdown — unregisters session", async () => {
    registerSession("shutdown-me");
    const res = await postJson("/api/session/shutdown-me/shutdown");
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(server.sessionManager.get("shutdown-me")?.status).toBe("ended");
  });

  // ── rename ──────────────────────────────────────────────────────

  it("POST /api/session/:id/rename — 400 when name missing", async () => {
    const res = await postJson("/api/session/any/rename", {});
    expect(res.status).toBe(400);
  });

  it("POST /api/session/:id/rename — renames session", async () => {
    registerSession("rename-me");
    const res = await postJson("/api/session/rename-me/rename", { name: "new-name" });
    expect(res.status).toBe(200);
    expect(server.sessionManager.get("rename-me")?.name).toBe("new-name");
  });

  // ── archive / unarchive ──────────────────────────────────────────

  const archiveTmpDirs: string[] = [];
  /** Register an ended session backed by a real sidecar so it can be archived. */
  function seedArchivableEnded(id: string, overrides: Record<string, unknown> = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-api-archive-"));
    archiveTmpDirs.push(dir);
    const file = path.join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: "/tmp/test" })}\n`);
    writeSessionMeta(file, { cwd: "/tmp/test", status: "ended", startedAt: 1000, endedAt: 2000 });
    server.sessionManager.restore({
      id,
      cwd: "/tmp/test",
      source: "tui",
      status: "ended",
      startedAt: 1000,
      endedAt: 2000,
      sessionFile: file,
      hidden: false,
      ...overrides,
    } as never);
    return file;
  }

  afterAll(() => {
    for (const dir of archiveTmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("POST /api/session/:id/archive — archives an ended session (E34)", async () => {
    seedArchivableEnded("archive-me");
    const res = await postJson("/api/session/archive-me/archive");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
    expect(server.sessionManager.get("archive-me")).toBeUndefined();
  });

  it("POST /api/session/:id/archive — idle alive returns pending (E34)", async () => {
    seedArchivableEnded("archive-idle", { status: "idle", endedAt: undefined });
    const res = await postJson("/api/session/archive-idle/archive");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, pending: true });
  });

  it("POST /api/session/:id/archive — running is 409 (E34)", async () => {
    seedArchivableEnded("archive-running", { status: "streaming", endedAt: undefined });
    const res = await postJson("/api/session/archive-running/archive");
    expect(res.status).toBe(409);
    expect(server.sessionManager.get("archive-running")).toBeDefined();
  });

  it("POST /api/session/:id/archive — live:true is 409 (E34)", async () => {
    seedArchivableEnded("archive-live", { live: true });
    const res = await postJson("/api/session/archive-live/archive");
    expect(res.status).toBe(409);
  });

  it("GET /api/sessions excludes archived (E35)", async () => {
    seedArchivableEnded("list-resident");
    seedArchivableEnded("list-archived");
    await postJson("/api/session/list-archived/archive");
    const res = await fetch(url("/api/sessions"));
    const body = (await res.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((s) => s.id);
    expect(ids).toContain("list-resident");
    expect(ids).not.toContain("list-archived");
  });

  it("GET /api/sessions/archived/:id — returns the row or 404 (E27)", async () => {
    seedArchivableEnded("byid-archived");
    await postJson("/api/session/byid-archived/archive");
    const hit = await fetch(url("/api/sessions/archived/byid-archived"));
    expect(hit.status).toBe(200);
    const miss = await fetch(url("/api/sessions/archived/byid-unknown"));
    expect(miss.status).toBe(404);
  });

  it("POST /api/session/:id/unarchive — restores an archived session", async () => {
    seedArchivableEnded("unarchive-me");
    await postJson("/api/session/unarchive-me/archive");
    const res = await postJson("/api/session/unarchive-me/unarchive");
    expect(res.status).toBe(200);
    expect(server.sessionManager.get("unarchive-me")).toMatchObject({ status: "ended", hidden: false, archived: false });
  });

  // ── spawn ───────────────────────────────────────────────────────

  it("POST /api/session/spawn — 400 when cwd missing", async () => {
    const res = await postJson("/api/session/spawn", {});
    expect(res.status).toBe(400);
  });

  it("POST /api/session/spawn — success with valid cwd", async () => {
    const res = await postJson("/api/session/spawn", { cwd: "/tmp/project" });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  // ── resume ──────────────────────────────────────────────────────

  it("POST /api/session/:id/resume — 400 for invalid mode", async () => {
    const res = await postJson("/api/session/any/resume", { mode: "invalid" });
    expect(res.status).toBe(400);
  });

  it("POST /api/session/:id/resume — 404 for unknown session", async () => {
    const res = await postJson("/api/session/unknown/resume", { mode: "continue" });
    expect(res.status).toBe(404);
  });

  it("POST /api/session/:id/resume — 409 if session still active", async () => {
    registerSession("resume-active", { sessionFile: "/path/session.jsonl" });
    // Genuinely live: a keeper still carries the process. Reopening this would
    // double-spawn (the gateway session→connection map is last-write-wins).
    liveCarriers.add("resume-active");
    try {
      const res = await postJson("/api/session/resume-active/resume", { mode: "continue" });
      expect(res.status).toBe(409);
    } finally {
      liveCarriers.delete("resume-active");
    }
  });

  // Counterpart of the above, and the REST-layer coverage the zombie fix never
  // got: same "active" record, but NO live carrier and no bridge. This is the
  // crash/OOM/kill-9 case that used to be permanently unrecoverable — 409 on
  // resume, prompt dropped on send. It MUST fall through to reopen.
  it("POST /api/session/:id/resume — reopens a crash-orphaned zombie whose process is gone", async () => {
    registerSession("resume-zombie", { sessionFile: "/path/zombie.jsonl" });
    expect(liveCarriers.has("resume-zombie")).toBe(false);
    const res = await postJson("/api/session/resume-zombie/resume", { mode: "continue" });
    expect(res.status).toBe(200);
  });

  // ── flow-control ────────────────────────────────────────────────

  it("POST /api/session/:id/flow-control — 400 for invalid action", async () => {
    const res = await postJson("/api/session/any/flow-control", { action: "invalid" });
    expect(res.status).toBe(400);
  });

  it("POST /api/session/:id/flow-control — success", async () => {
    registerSession("flow-ctrl");
    const res = await postJson("/api/session/flow-ctrl/flow-control", { action: "abort" });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  // ── model ───────────────────────────────────────────────────────

  it("POST /api/session/:id/model — 400 when missing fields", async () => {
    const res = await postJson("/api/session/any/model", { provider: "anthropic" });
    expect(res.status).toBe(400);
  });

  it("POST /api/session/:id/model — success", async () => {
    registerSession("model-set");
    const res = await postJson("/api/session/model-set/model", {
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
    });
    expect(res.status).toBe(200);
  });

  // ── thinking-level ──────────────────────────────────────────────

  it("POST /api/session/:id/thinking-level — 400 when missing", async () => {
    const res = await postJson("/api/session/any/thinking-level", {});
    expect(res.status).toBe(400);
  });

  it("POST /api/session/:id/thinking-level — success", async () => {
    registerSession("think-set");
    const res = await postJson("/api/session/think-set/thinking-level", { level: "high" });
    expect(res.status).toBe(200);
  });

  // ── attach/detach proposal ──────────────────────────────────────

  it("POST /api/session/:id/attach-proposal — 400 when changeName missing", async () => {
    const res = await postJson("/api/session/any/attach-proposal", {});
    expect(res.status).toBe(400);
  });

  it("POST /api/session/:id/attach-proposal — attaches and auto-names", async () => {
    registerSession("attach-me");
    const res = await postJson("/api/session/attach-me/attach-proposal", { changeName: "add-feature" });
    expect(res.status).toBe(200);
    const session = server.sessionManager.get("attach-me");
    expect(session?.attachedProposal).toBe("add-feature");
    expect(session?.name).toBe("add-feature"); // auto-named
  });

  it("POST /api/session/:id/detach-proposal — detaches", async () => {
    registerSession("detach-me");
    server.sessionManager.update("detach-me", { attachedProposal: "some-change" });
    const res = await postJson("/api/session/detach-me/detach-proposal");
    expect(res.status).toBe(200);
    expect(server.sessionManager.get("detach-me")?.attachedProposal).toBeNull();
  });
});

// ── archived listing / delete REST surface ────────────────────────
//
// Drives `registerSessionRoutes` directly against a purpose-built archive
// index (via `fastify.inject`) so the index can be SEEDED — the full server
// does not expose `sessionArchive`, and paging BVA needs hundreds of rows.
// Covers test-plan #E23, #E24, #E25, #E26, #E28, #X4, #X6.
// See change: archive-sessions-lazy-load.

interface CountEvent {
  cwd: string;
  count: number;
}

async function makeArchiveApi() {
  const sessionManager = createMemorySessionManager();
  const metaPersistence = createMetaPersistence();
  const archive = createSessionArchive({ sessionManager, metaPersistence, getPinnedDirs: () => [] });
  const counts: CountEvent[] = [];
  archive.setEmitter({
    sessionArchived: (_id, cwd, count) => counts.push({ cwd, count }),
    archivedCountUpdated: (cwd, count) => counts.push({ cwd, count }),
    sessionAdded: () => {},
  });
  const app = Fastify();
  registerSessionRoutes(app, {
    sessionManager,
    eventStore: {} as never,
    networkGuard: async () => {},
    sessionArchive: archive,
  });
  await app.ready();
  return { app, archive, sessionManager, metaPersistence, counts };
}

function archivedRow(i: number, over: Partial<ArchivedSessionSummary> = {}): ArchivedSessionSummary {
  return {
    id: `s-${String(i).padStart(4, "0")}`,
    cwd: "/a",
    groupPath: "/a",
    endedAt: 5000,
    archivedAt: 6000,
    sessionFile: `/tmp/archived/${i}.jsonl`,
    ...over,
  };
}

/** Parse `{ success, data: { items, nextCursor } }` out of an inject response. */
function listBody(res: { payload: string }) {
  return JSON.parse(res.payload).data as { items: ArchivedSessionSummary[]; nextCursor?: string };
}

describe("GET /api/sessions/archived — paging (E23)", () => {
  it("pages 120 equal-endedAt rows as 50/50/20 with distinct ids and no trailing cursor", async () => {
    const { app, archive } = await makeArchiveApi();
    // Every row shares one endedAt: the id tiebreak is the ONLY thing keeping
    // the cursor from looping or skipping.
    archive.seed(Array.from({ length: 120 }, (_, i) => archivedRow(i)));

    const seen: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    let last: { items: ArchivedSessionSummary[]; nextCursor?: string } | undefined;
    for (let page = 0; page < 3; page++) {
      const qs = `?cwd=/a&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await app.inject({ method: "GET", url: `/api/sessions/archived${qs}` });
      expect(res.statusCode).toBe(200);
      last = listBody(res);
      pageSizes.push(last.items.length);
      seen.push(...last.items.map((r) => r.id));
      cursor = last.nextCursor;
    }

    expect(pageSizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect(last?.nextCursor).toBeUndefined();
    await app.close();
  });
});

describe("GET /api/sessions/archived — limit BVA (E24)", () => {
  it.each<[string, number]>([
    ["0", 1],
    ["1", 1],
    ["200", 200],
    ["201", 200],
    ["5000", 200],
    ["abc", 50],
  ])("limit=%s yields %i items", async (limit, expected) => {
    const { app, archive } = await makeArchiveApi();
    archive.seed(Array.from({ length: 250 }, (_, i) => archivedRow(i)));
    const res = await app.inject({ method: "GET", url: `/api/sessions/archived?cwd=/a&limit=${limit}` });
    expect(res.statusCode).toBe(200);
    expect(listBody(res).items.length).toBe(expected);
    await app.close();
  });
});

describe("GET /api/sessions/archived — cwd validation (E25)", () => {
  it("rejects a relative cwd with 400", async () => {
    const { app, archive } = await makeArchiveApi();
    archive.seed([archivedRow(1)]);
    const res = await app.inject({ method: "GET", url: "/api/sessions/archived?cwd=rel/path" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe("cwd must be an absolute path");
    await app.close();
  });

  it("rejects an empty cwd with 400", async () => {
    const { app, archive } = await makeArchiveApi();
    archive.seed([archivedRow(1)]);
    const res = await app.inject({ method: "GET", url: "/api/sessions/archived?cwd=" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("returns an empty list for an unknown folder", async () => {
    const { app, archive } = await makeArchiveApi();
    archive.seed([archivedRow(1)]);
    const res = await app.inject({ method: "GET", url: "/api/sessions/archived?cwd=/unknown" });
    expect(res.statusCode).toBe(200);
    expect(listBody(res).items).toEqual([]);
    await app.close();
  });

  it("folds a trailing separator onto the same folder key", async () => {
    const { app, archive } = await makeArchiveApi();
    archive.seed([archivedRow(1), archivedRow(2)]);
    const res = await app.inject({ method: "GET", url: "/api/sessions/archived?cwd=/a/" });
    expect(res.statusCode).toBe(200);
    expect(listBody(res).items.map((r) => r.id).sort()).toEqual(["s-0001", "s-0002"]);
    await app.close();
  });
});

describe("GET /api/sessions/archived — q matching (E26)", () => {
  async function seeded() {
    const rig = await makeArchiveApi();
    rig.archive.seed([
      archivedRow(1, { name: "abcdef" }),
      archivedRow(2, { name: undefined, firstMessage: "an abc message" }),
      archivedRow(3, { name: "unrelated", firstMessage: "abc hidden by the name" }),
    ]);
    return rig;
  }

  it("ignores a query shorter than 3 characters", async () => {
    const { app } = await seeded();
    const res = await app.inject({ method: "GET", url: "/api/sessions/archived?q=ab" });
    expect(res.statusCode).toBe(200);
    expect(listBody(res).items).toEqual([]);
    await app.close();
  });

  it("matches on name", async () => {
    const { app } = await seeded();
    const res = await app.inject({ method: "GET", url: "/api/sessions/archived?q=abc" });
    expect(listBody(res).items.map((r) => r.id)).toContain("s-0001");
    await app.close();
  });

  it("matches on firstMessage when the row has no name", async () => {
    const { app } = await seeded();
    const res = await app.inject({ method: "GET", url: "/api/sessions/archived?q=abc" });
    const ids = listBody(res).items.map((r) => r.id);
    expect(ids).toContain("s-0002");
    // A named row's firstMessage is NOT searched — name wins outright.
    expect(ids).not.toContain("s-0003");
    await app.close();
  });

  it("matches case-insensitively", async () => {
    const { app } = await seeded();
    const res = await app.inject({ method: "GET", url: "/api/sessions/archived?q=ABC" });
    expect(listBody(res).items.map((r) => r.id).sort()).toEqual(["s-0001", "s-0002"]);
    await app.close();
  });
});

describe("GET /api/sessions/archived — bad cursor (X4)", () => {
  it("rejects an undecodable cursor with 400", async () => {
    const { app, archive } = await makeArchiveApi();
    archive.seed([archivedRow(1)]);
    const res = await app.inject({ method: "GET", url: "/api/sessions/archived?cwd=/a&cursor=%%%" });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe("invalid cursor");
    await app.close();
  });

  it("treats a cursor from another folder as an end-of-list position", async () => {
    // Documents ACTUAL behaviour: the cursor is a sort position, not a folder
    // token, so an older foreign position lands past every row here and the
    // page comes back empty (200, no nextCursor) rather than restarting.
    const { app, archive } = await makeArchiveApi();
    archive.seed([
      archivedRow(1, { cwd: "/a", groupPath: "/a", endedAt: 5000 }),
      archivedRow(2, { cwd: "/b", groupPath: "/b", endedAt: 10 }),
    ]);
    const foreign = Buffer.from("10:s-0002", "utf-8").toString("base64");
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/archived?cwd=/a&cursor=${encodeURIComponent(foreign)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = listBody(res);
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeUndefined();
    await app.close();
  });
});

describe("DELETE /api/sessions/archived/:id (E28, X6)", () => {
  const deleteTmpDirs: string[] = [];

  afterAll(() => {
    for (const dir of deleteTmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Real `.jsonl` + `.meta.json` on a tmp fs, indexed as archived. */
  function seedArchivedFiles(archive: ReturnType<typeof createSessionArchive>, id: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "archive-delete-"));
    deleteTmpDirs.push(dir);
    const file = path.join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: "/a" })}\n`);
    writeSessionMeta(file, { cwd: "/a", status: "ended", startedAt: 1000, endedAt: 2000, archived: true });
    archive.seed([
      ...archive.rows(),
      archivedRow(0, { id, cwd: "/a", groupPath: "/a", sessionFile: file }),
    ]);
    return file;
  }

  it("deletes the files, drops the row and broadcasts the decremented count", async () => {
    const { app, archive, counts } = await makeArchiveApi();
    const keep = seedArchivedFiles(archive, "del-keep");
    const target = seedArchivedFiles(archive, "del-me");

    const res = await app.inject({ method: "DELETE", url: "/api/sessions/archived/del-me" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).success).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(metaPath(target))).toBe(false);
    expect(archive.has("del-me")).toBe(false);
    // The sibling row is untouched, and the broadcast carries 2 - 1.
    expect(fs.existsSync(keep)).toBe(true);
    expect(counts.at(-1)).toMatchObject({ count: 1 });
    await app.close();
  });

  it("answers 404 for a resident (non-archived) session and leaves its files", async () => {
    const { app, archive, sessionManager, counts } = await makeArchiveApi();
    const file = seedArchivedFiles(archive, "resident-files");
    // Same id lives in the manager, NOT in the archive index.
    sessionManager.restore({
      id: "resident-sess",
      cwd: "/a",
      source: "tui",
      status: "ended",
      startedAt: 1000,
      endedAt: 2000,
      sessionFile: file,
      hidden: false,
    } as never);

    const res = await app.inject({ method: "DELETE", url: "/api/sessions/archived/resident-sess" });
    expect(res.statusCode).toBe(404);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(metaPath(file))).toBe(true);
    expect(counts).toEqual([]);
    await app.close();
  });

  it("answers 500 and keeps the row when the sidecar unlink fails (X6)", async () => {
    const { app, archive, counts } = await makeArchiveApi();
    const file = seedArchivedFiles(archive, "partial-del");
    // Fault injection with no mocking: replace the sidecar with a DIRECTORY so
    // `unlinkSync` fails with a non-ENOENT error after the `.jsonl` unlink
    // already succeeded.
    fs.rmSync(metaPath(file));
    fs.mkdirSync(metaPath(file));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await app.inject({ method: "DELETE", url: "/api/sessions/archived/partial-del" });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).success).toBe(false);
    expect(archive.has("partial-del")).toBe(true);
    expect(counts).toEqual([]);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[archive] delete failed for partial-del"),
      expect.anything(),
    );

    errSpy.mockRestore();
    await app.close();
  });
});

// ── P2: listing endpoint under a concurrent burst ───────────────────────────
//
// Observation-only (no threshold, per the test-plan clarification): 4000 index
// rows, 20 concurrent `GET /api/sessions/archived?cwd=` — every request answers
// 200 and emits exactly one request-timing log line.
// Rig choice: the `makeArchiveApi` fastify rig in THIS file (it can seed the
// index); `browser-gateway-load.test.ts` drives the WS gateway, which never
// touches this REST route. See change: archive-sessions-lazy-load.
describe("GET /api/sessions/archived — concurrent burst (P2)", () => {
  it("answers 20 concurrent requests with 200 and logs one timing line each", async () => {
    const { app, archive } = await makeArchiveApi();
    archive.seed(
      Array.from({ length: 4000 }, (_, i) =>
        archivedRow(i, { cwd: i % 2 === 0 ? "/a" : "/b", groupPath: i % 2 === 0 ? "/a" : "/b", endedAt: 5000 + i }),
      ),
    );

    const lines: string[] = [];
    const debugSpy = vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    try {
      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          app.inject({ method: "GET", url: "/api/sessions/archived?cwd=/a&limit=50" }),
        ),
      );
      expect(responses.map((r) => r.statusCode)).toEqual(Array(20).fill(200));
      // Each request really served a full page out of the 2000 `/a` rows.
      for (const res of responses) expect(listBody(res).items).toHaveLength(50);

      const timing = lines.filter((l) => /\[archive\] GET \/api\/sessions\/archived .* in \d+ ms$/.test(l));
      expect(timing).toHaveLength(20);
      expect(timing[0]).toContain("cwd=/a");
      expect(timing[0]).toContain("→ 50 items");
    } finally {
      debugSpy.mockRestore();
      await app.close();
    }
  });
});
