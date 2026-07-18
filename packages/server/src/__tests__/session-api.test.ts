/**
 * Tests for session control REST API endpoints (session-api.ts).
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { createServer, type DashboardServer } from "../server.js";

let httpPort: number;
let piPort: number;
let server: DashboardServer;

// Mock spawnPiSession to avoid actually spawning processes
vi.mock("../spawn-process/process-manager.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    spawnPiSession: vi.fn().mockResolvedValue({ success: true, message: "spawned" }),
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

  it("POST /api/session/:id/prompt — 502 when no bridge connection", async () => {
    registerSession("prompt-no-bridge");
    const res = await postJson("/api/session/prompt-no-bridge/prompt", { text: "hello" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("no bridge connection for session");
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

  // ── hide/unhide ─────────────────────────────────────────────────

  it("POST /api/session/:id/hide — hides session", async () => {
    registerSession("hide-me");
    const res = await postJson("/api/session/hide-me/hide");
    expect(res.status).toBe(200);
    expect(server.sessionManager.get("hide-me")?.hidden).toBe(true);
  });

  it("POST /api/session/:id/unhide — unhides session", async () => {
    registerSession("unhide-me");
    server.sessionManager.update("unhide-me", { hidden: true });
    const res = await postJson("/api/session/unhide-me/unhide");
    expect(res.status).toBe(200);
    expect(server.sessionManager.get("unhide-me")?.hidden).toBe(false);
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
    const res = await postJson("/api/session/resume-active/resume", { mode: "continue" });
    expect(res.status).toBe(409);
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
