/**
 * Server event-wiring: the `pi_version_update` arm stores the bridge-reported
 * pi version on the session record (mirroring git_info_update).
 *
 * See change: restore-pi-version-skew-surface.
 */
import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("event-wiring: pi_version_update", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (stop) { await stop(); stop = undefined; }
  });

  it("stores reported version on the session", async () => {
    const { createServer } = await import("../server.js");
    const server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    stop = () => server.stop();
    const piPort = server.piPort()!;

    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-ver-update-"));
    const SID = "pv-sess";
    const sessionFile = path.join(tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");

    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("open", () => resolve());
    });
    ws.send(JSON.stringify({ type: "session_register", sessionId: SID, cwd: tmpDir, source: "tui", sessionFile }));
    await wait(80);

    ws.send(JSON.stringify({ type: "pi_version_update", sessionId: SID, version: "0.80.2" }));
    await wait(80);

    expect(server.sessionManager.get(SID)?.piVersion).toBe("0.80.2");
    ws.close();
  }, 20_000);

  // test-plan #E5 — the server compares the reported version with
  // `piCompatibility.minimum` and stamps the flag; a later in-floor report
  // CLEARS it with an explicit `null` (the client merges shallowly).
  // See change: update-pi-core-1-0-adopt-apis.
  it("flags a below-floor version and clears the flag once the session reaches the floor", async () => {
    const { createServer } = await import("../server.js");
    const server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    stop = () => server.stop();
    const piPort = server.piPort()!;

    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pi-ver-floor-"));
    const SID = "pv-floor";
    const sessionFile = path.join(tmpDir, `${SID}.jsonl`);
    writeFileSync(sessionFile, "");
    const minimum = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"),
    ).piCompatibility.minimum as string;

    const ws = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.on("error", reject);
      ws.on("open", () => resolve());
    });
    ws.send(JSON.stringify({ type: "session_register", sessionId: SID, cwd: tmpDir, source: "tui", sessionFile }));
    await wait(80);

    ws.send(JSON.stringify({ type: "pi_version_update", sessionId: SID, version: "0.87.1" }));
    await wait(80);
    expect(server.sessionManager.get(SID)?.piBelowFloor).toEqual({ minimum });

    ws.send(JSON.stringify({ type: "pi_version_update", sessionId: SID, version: minimum }));
    await wait(80);
    expect(server.sessionManager.get(SID)?.piVersion).toBe(minimum);
    expect(server.sessionManager.get(SID)?.piBelowFloor).toBeNull();
    ws.close();
  }, 20_000);
});
