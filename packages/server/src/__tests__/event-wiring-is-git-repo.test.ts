/**
 * Contract tests for the `isGitRepo` tri-state on the `session_register`
 * path in `event-wiring.ts`.
 *
 * Pins:
 *   - `session_register` with `isGitRepo: false` stamps the in-memory
 *     session AND persists `isGitRepo: false` to `.meta.json`.
 *   - `session_register` with `isGitRepo: true` persists `true`.
 *   - `session_register` omitting the field leaves it `undefined` (no
 *     persistence) — legacy-bridge back-compat.
 *
 * See change: gate-session-worktree-button-on-git.
 */
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TestRig {
  stop: () => Promise<void>;
  sessionManager: { get: (id: string) => { isGitRepo?: boolean } | undefined };
  piPort: number;
  tmpDir: string;
}

async function startServer(): Promise<TestRig> {
  const { createServer } = await import("../server.js");
  const server = await createServer({
    port: 0,
    piPort: 0,
    host: "127.0.0.1",
    dev: true,
    autoShutdown: false,
    shutdownIdleSeconds: 999,
    tunnel: false,
  });
  await server.start();
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-isgitrepo-"));
  return {
    stop: () => server.stop(),
    sessionManager: server.sessionManager,
    piPort: server.piPort()!,
    tmpDir,
  };
}

async function sendRegister(piPort: number, payload: Record<string, unknown>): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "session_register", ...payload }));
      resolve();
    });
  });
  return ws;
}

describe("event-wiring: isGitRepo tri-state persistence", () => {
  let rig: TestRig | undefined;

  afterEach(async () => {
    if (rig) {
      await rig.stop();
      rig = undefined;
    }
  });

  it("persists isGitRepo:false to .meta.json and stamps in-memory", async () => {
    rig = await startServer();
    const SID = "isgit-false-sess";
    const sessionFile = path.join(rig.tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");

    await sendRegister(rig.piPort, {
      sessionId: SID,
      cwd: rig.tmpDir,
      source: "tui",
      sessionFile,
      isGitRepo: false,
    });
    await wait(80);

    expect(rig.sessionManager.get(SID)?.isGitRepo).toBe(false);
    expect(readSessionMeta(sessionFile)?.isGitRepo).toBe(false);
  }, 15000);

  it("persists isGitRepo:true to .meta.json and stamps in-memory", async () => {
    rig = await startServer();
    const SID = "isgit-true-sess";
    const sessionFile = path.join(rig.tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");

    await sendRegister(rig.piPort, {
      sessionId: SID,
      cwd: rig.tmpDir,
      source: "tui",
      sessionFile,
      isGitRepo: true,
    });
    await wait(80);

    expect(rig.sessionManager.get(SID)?.isGitRepo).toBe(true);
    expect(readSessionMeta(sessionFile)?.isGitRepo).toBe(true);
  }, 15000);

  it("leaves isGitRepo undefined and unpersisted when the field is absent (legacy bridge)", async () => {
    rig = await startServer();
    const SID = "isgit-absent-sess";
    const sessionFile = path.join(rig.tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");

    await sendRegister(rig.piPort, {
      sessionId: SID,
      cwd: rig.tmpDir,
      source: "tui",
      sessionFile,
    });
    await wait(80);

    expect(rig.sessionManager.get(SID)?.isGitRepo).toBeUndefined();
    expect(readSessionMeta(sessionFile)?.isGitRepo).toBeUndefined();
  }, 15000);
});
