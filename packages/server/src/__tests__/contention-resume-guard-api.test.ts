/**
 * The session-file-keyed resume guard and the contended-prompt annotation, at
 * the REST surface with a real bridge socket attached.
 *
 * Covers test-plan #X12 (REST resume refused), #X14 (zombie still resumable),
 * #X17 (no sessionFile never refuses), #X18 (fork exempt) and #F1/#F3 (prompt
 * honesty).
 *
 * See change: fix-duplicate-bridge-registration (D4, D5).
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createServer, type DashboardServer } from "../server.js";

let httpPort: number;
let piPort: number;
let server: DashboardServer;

const { spawnCalls } = vi.hoisted(() => ({ spawnCalls: [] as unknown[] }));

vi.mock("../spawn-process/process-manager.js", async (importOriginal) => {
  const orig: any = await importOriginal();
  return {
    ...orig,
    spawnPiSession: vi.fn(async (...args: unknown[]) => {
      spawnCalls.push(args);
      return { success: true, message: "spawned" };
    }),
    getKeeperManager: () => ({
      ...orig.getKeeperManager(),
      isKeeperAlive: () => false,
    }),
  };
});

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const sockets: WebSocket[] = [];
/** The bridge that owns `/t/shared.jsonl`; X12 sets it, X14 closes it. */
let holderSocket: WebSocket | undefined;

/** Connect a bridge socket and register `sessionId`, waiting until it routes. */
async function connectBridge(sessionId: string, extra: Record<string, unknown> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  ws.on("error", () => {});
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
  ws.send(
    JSON.stringify({ type: "session_register", sessionId, cwd: "/tmp/test", source: "tui", ...extra }),
  );
  // The register has landed once the manager reflects the bridge's own source.
  for (let i = 0; i < 300; i++) {
    if (server.sessionManager.get(sessionId)?.source === "tui") {
      await delay(20);
      return ws;
    }
    await delay(10);
  }
  throw new Error(`bridge for ${sessionId} never registered`);
}

/** Live bridge count, read through the same surface an operator would use. */
async function bridgeCount(): Promise<number> {
  const res = await fetch(url("/api/health"));
  return ((await res.json()) as any).activeBridgeCount as number;
}

describe("session-file resume guard (REST)", () => {
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
    for (const ws of sockets) ws.terminate();
    if (server) {
      try {
        await server.stop();
      } catch {
        /* */
      }
    }
  });

  afterEach(() => {
    spawnCalls.length = 0;
  });

  // ── X12 ───────────────────────────────────────────────────────────────────
  it("X12: refuses a continue whose session file a live bridge serves under another id", async () => {
    // B is live and owns the file. Held in a named binding so X14 closes THIS
    // socket rather than whichever one happens to be open at the time.
    holderSocket = await connectBridge("live-B", { sessionFile: "/t/shared.jsonl", pid: 4242 });

    // A is a separate, ended session recorded against the SAME file.
    server.sessionManager.register({
      id: "ended-A",
      cwd: "/tmp/test",
      source: "tui" as const,
      sessionFile: "/t/shared.jsonl",
      startedAt: Date.now(),
    });
    server.sessionManager.update("ended-A", { status: "ended", endedAt: Date.now() });

    const res = await postJson("/api/session/ended-A/resume", { mode: "continue" });
    const body = (await res.json()) as any;

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toContain("live-B");
    // No pi was spawned.
    expect(spawnCalls).toHaveLength(0);
  }, 25000);

  // ── X18 ───────────────────────────────────────────────────────────────────
  it("X18: a fork of the same live session file proceeds \u2014 the guard is continue-only", async () => {
    const res = await postJson("/api/session/ended-A/resume", { mode: "fork" });
    const body = (await res.json()) as any;

    expect(res.status).not.toBe(409);
    expect(body.error ?? "").not.toContain("already served");
  }, 25000);

  // ── X14 ───────────────────────────────────────────────────────────────────
  it("X14: once the holder's bridge is gone the same continue proceeds", async () => {
    // A non-automation close deliberately leaves the map entry in place for the
    // reconnect grace window, so `activeBridgeCount` does NOT drop here. The
    // guard keys on D1 liveness, which follows the transport — poll the SERVER
    // until it actually stops seeing the file as live, rather than sleeping.
    expect(holderSocket).toBeDefined();
    holderSocket!.close();

    let body: any;
    for (let i = 0; i < 300; i++) {
      const res = await postJson("/api/session/ended-A/resume", { mode: "continue" });
      body = await res.json();
      if (!String(body.error ?? "").includes("already served by live session")) break;
      await delay(20);
    }

    // Positive outcome, not merely the absence of one string: the resume is
    // accepted and a pi is actually spawned for it.
    expect(body.error ?? "").not.toContain("already served by live session");
    expect(body.success).toBe(true);
    expect(spawnCalls.length).toBeGreaterThan(0);
  }, 25000);

  // ── X17 ───────────────────────────────────────────────────────────────────
  it("X17: a live session with no sessionFile never triggers the guard", async () => {
    await connectBridge("no-file", { pid: 7 });

    server.sessionManager.register({
      id: "other",
      cwd: "/tmp/test",
      source: "tui" as const,
      sessionFile: "/t/other.jsonl",
      startedAt: Date.now(),
    });
    server.sessionManager.update("other", { status: "ended", endedAt: Date.now() });

    const res = await postJson("/api/session/other/resume", { mode: "continue" });
    const body = (await res.json()) as any;
    expect(body.error ?? "").not.toContain("already served by live session");
  }, 25000);

  // ── F3 / F1 ───────────────────────────────────────────────────────────────
  // E31 — transmission is now reported explicitly on the mainline path too:
  // a bare `{success:true}` left "written but unacknowledged" with no field to
  // land in. See change: fix-spawn-correlation-ttl-coupling (D7).
  it("F3: an uncontended prompt reports transmission and a prompt handle", async () => {
    await connectBridge("plain", { pid: 11, sessionFile: "/t/plain.jsonl" });

    const res = await postJson("/api/session/plain/prompt", { text: "hi" });
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.transmitted).toBe(true);
    expect(typeof body.promptId).toBe("string");
    expect(body).not.toHaveProperty("delivered");
  }, 25000);

  // E30 — the former `delivered: true` was asserted on exactly the branch least
  // able to know it (a displaced bridge). It reports TRANSMISSION now; the
  // annotation and the non-plain-success shape are unchanged.
  // See change: fix-spawn-correlation-ttl-coupling (D7).
  it("F1: a contended prompt is annotated, names the bridge state, and reports transmission", async () => {
    await connectBridge("contended", { pid: 37660, sessionFile: "/t/c.jsonl" });

    // A second bridge claims the same id and loses.
    const dup = new WebSocket(`ws://127.0.0.1:${piPort}`);
    dup.on("error", () => {});
    sockets.push(dup);
    await new Promise<void>((r) => dup.on("open", () => r()));
    const closed = new Promise<void>((r) => dup.on("close", () => r()));
    dup.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "contended",
        cwd: "/tmp/test",
        source: "tui",
        pid: 17579,
        sessionFile: "/t/c.jsonl",
      }),
    );
    await closed;

    const res = await postJson("/api/session/contended/prompt", { text: "hi" });
    const body = (await res.json()) as any;

    // Not a plain success …
    expect(body).not.toEqual({ success: true });
    // … but explicitly transmitted, so a caller does not retry and double-send —
    // and it no longer claims a delivery this branch cannot know.
    expect(body.success).toBe(true);
    expect(body.transmitted).toBe(true);
    expect(body).not.toHaveProperty("delivered");
    expect(typeof body.promptId).toBe("string");
    expect(body.bridgeState).toBe("contended");
    expect(body.warning).toContain("37660");
    expect(body.warning).toContain("17579");
    expect(body.warning).toContain("transmitted");
  }, 25000);

  // ── F7 ────────────────────────────────────────────────────────────────────
  it("F7: /api/health carries the cumulative count and the contended id list", async () => {
    const res = await fetch(url("/api/health"));
    const body = (await res.json()) as any;

    expect(body.bridgeContentionCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.contendedSessionIds)).toBe(true);
    expect(body.contendedSessionIds).toContain("contended");
  }, 25000);

  // ── #X19 (task 11.11) ─────────────────────────────────────────────────────
  // Resume is refused for a session that ran on ANOTHER host, while a local
  // session is untouched (task 11.12). The pairing is the test: a gate that
  // refused everything would satisfy the remote assertions alone, so the local
  // control is what proves it discriminates.
  // See change: add-pi-gateway-transport-identity (D13).
  it("refuses an ENDED remote session and names the originating device", async () => {
    server.sessionManager.register({
      id: "remote-ended",
      cwd: "/tmp/test",
      source: "tui" as const,
      sessionFile: "/Users/robson/.pi/agent/sessions/collides.jsonl",
      startedAt: Date.now(),
    });
    server.sessionManager.update("remote-ended", {
      status: "ended",
      endedAt: Date.now(),
      originDeviceId: "device-7",
    });

    const res = await postJson("/api/session/remote-ended/resume", { mode: "continue" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    // The explanation names the host, not a missing file: "not found" would
    // send an operator hunting a transcript that was never here.
    expect(body.error).toMatch(/device-7/);
    expect(body.error).not.toMatch(/file is unknown/);
    expect(spawnCalls).toHaveLength(0);
  });

  it("refuses a LIVE remote session as a second writer, not as a revival", async () => {
    server.sessionManager.register({
      id: "remote-live",
      cwd: "/tmp/test",
      source: "tui" as const,
      sessionFile: "/Users/robson/.pi/agent/sessions/collides.jsonl",
      startedAt: Date.now(),
    });
    server.sessionManager.update("remote-live", { originDeviceId: "device-7" });

    const res = await postJson("/api/session/remote-live/resume", { mode: "continue" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toMatch(/second pi writing/);
    expect(spawnCalls).toHaveLength(0);
  });

  it("leaves a LOCAL ended session resumable (task 11.12)", async () => {
    server.sessionManager.register({
      id: "local-ended",
      cwd: "/tmp/test",
      source: "tui" as const,
      sessionFile: "/t/local-only.jsonl",
      startedAt: Date.now(),
    });
    server.sessionManager.update("local-ended", { status: "ended", endedAt: Date.now() });

    const res = await postJson("/api/session/local-ended/resume", { mode: "continue" });
    expect(res.status).toBe(200);
    expect(spawnCalls.length).toBeGreaterThan(0);
  });
});

/**
 * #E15 / task 11.8 — /api/session-file confines reads to `session.cwd`, but a
 * remote session's cwd is a path on ANOTHER host. Two machines with the same
 * username yield the same path, so the confinement passes while the file
 * served is an unrelated local one. A correctness bug before a security one.
 */
describe("/api/session-file refuses a remote-origin session", () => {
  it("refuses by naming the device, and never serves the local path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "origin-gate-"));
    writeFileSync(join(dir, "README.md"), "local-secret");

    // Same cwd for both: the whole point is that the PATH cannot discriminate.
    server.sessionManager.register({
      id: "remote-sess",
      cwd: dir,
      source: "tui",
      originDeviceId: "device-7",
    });
    server.sessionManager.register({ id: "local-sess", cwd: dir, source: "tui" });

    const remote = await fetch(url("/api/session-file?sessionId=remote-sess&path=README.md"));
    expect(remote.status).toBe(403);
    const body = (await remote.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/device-7/);
    expect(body.error).toMatch(/not on this host/);
    expect(JSON.stringify(body)).not.toContain("local-secret");

    // The discriminating control: an identical read for a LOCAL session is
    // served, so the refusal is about ORIGIN and not about the path.
    const local = await fetch(url("/api/session-file?sessionId=local-sess&path=README.md"));
    expect(local.status).toBe(200);
    const okBody = (await local.json()) as { data: { content: string } };
    expect(okBody.data.content).toBe("local-secret");
  });
});
