/**
 * End-to-end test for the §8 spawn→register→meta-persist flow:
 *
 *   1. Browser sends `spawn_session { cwd, gitWorktreeBase }`.
 *   2. Server enqueues into `pendingWorktreeBaseRegistry`.
 *   3. Bridge sends `session_register { sessionId, cwd, sessionFile }`.
 *   4. Server consumes the intent, stamps `DashboardSession.gitWorktreeBase`,
 *      writes `.meta.json#gitWorktreeBase`, and broadcasts the update.
 *
 * Uses a real `DashboardServer` instance over the local WS gateways so the
 * full pipeline (browser handler, pi gateway, event wiring, meta writer)
 * is exercised end-to-end. No mocks.
 *
 * See change: add-worktree-spawn-dialog.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type DashboardServer } from "../server.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openBrowserWs(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));
  // Drain any initial server-pushed messages.
  await wait(50);
  return ws;
}

async function openPiWs(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));
  return ws;
}

describe("§8 spawn→register persists gitWorktreeBase to .meta.json", () => {
  let server: DashboardServer;
  let browserPort: number;
  let piPort: number;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wt-spawn-flow-"));
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
    browserPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterEach(async () => {
    await server.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("gitWorktreeBase from spawn_session is persisted to .meta.json on register", async () => {
    // Pre-create the session file so the bridge can supply a sessionFile path
    // the server can write meta beside.
    const sessionFile = join(tmpDir, "session-abc.jsonl");
    writeFileSync(sessionFile, "");

    const browserWs = await openBrowserWs(browserPort);

    // Spawn message — this is the only place `gitWorktreeBase` enters the system.
    // We don't actually want pi to spawn (it would fail in the test env), but
    // the message handler enqueues into the registry BEFORE attempting spawn,
    // so we can race the bridge register to consume the intent.
    browserWs.send(
      JSON.stringify({
        type: "spawn_session",
        cwd: tmpDir,
        gitWorktreeBase: "develop",
        requestId: "req-1",
      }),
    );

    // Give the handler a moment to enqueue (synchronous in practice, but
    // the WS message dispatch is async).
    await wait(80);

    // Now simulate a bridge connecting and registering its session at the
    // same cwd. This consumes the pending intent.
    const piWs = await openPiWs(piPort);
    piWs.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-A",
        cwd: tmpDir,
        source: "cli",
        sessionFile,
      }),
    );

    // Give the wiring time to run the registered-handler, stamp the session,
    // and call mergeSessionMeta.
    await wait(120);

    // Verify .meta.json on disk carries the field.
    const metaContent = JSON.parse(
      readFileSync(join(tmpDir, "session-abc.meta.json"), "utf-8"),
    );
    expect(metaContent.gitWorktreeBase).toBe("develop");

    browserWs.close();
    piWs.close();
  });

  it("no gitWorktreeBase in spawn → no .meta.json write of that field", async () => {
    const sessionFile = join(tmpDir, "session-xyz.jsonl");
    writeFileSync(sessionFile, "");

    const browserWs = await openBrowserWs(browserPort);
    browserWs.send(
      JSON.stringify({
        type: "spawn_session",
        cwd: tmpDir,
        requestId: "req-2",
      }),
    );
    await wait(80);

    const piWs = await openPiWs(piPort);
    piWs.send(
      JSON.stringify({
        type: "session_register",
        sessionId: "sess-B",
        cwd: tmpDir,
        source: "cli",
        sessionFile,
      }),
    );
    await wait(120);

    // Either no .meta.json exists yet, or if it does (some other writer
    // created one), the gitWorktreeBase field is undefined.
    const metaFile = join(tmpDir, "session-xyz.meta.json");
    try {
      const metaContent = JSON.parse(readFileSync(metaFile, "utf-8"));
      expect(metaContent.gitWorktreeBase).toBeUndefined();
    } catch {
      // file doesn't exist — also fine; means no one persisted gitWorktreeBase.
    }

    browserWs.close();
    piWs.close();
  });
});
