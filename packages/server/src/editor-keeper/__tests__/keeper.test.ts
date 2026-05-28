/**
 * Editor keeper.cjs integration test (POSIX only, task 7.7).
 *
 * Spawns the real `node keeper.cjs <editorId> <cwd> <port> <binary> <dataDir>`
 * as a subprocess. A mock `code-server` shim binds the requested port so the
 * keeper's status + tcp probes can both succeed.
 *
 * Verifies:
 *   - PID sidecar is written
 *   - socket accepts `getStatus` and replies with a `status` event
 *   - `{cmd:"stop"}` triggers SIGTERM → child exits → keeper unlinks artefacts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const KEEPER_PATH = path.resolve(__dirname, "..", "keeper.cjs");
const MOCK_BINARY = path.resolve(__dirname, "fixtures", "mock-code-server.cjs");

const IS_POSIX = process.platform !== "win32";

function editorsDirIn(home: string): string {
  return path.join(home, ".pi", "dashboard", "editors");
}
function sockPathIn(home: string, id: string): string {
  return path.join(editorsDirIn(home), `${id}.sock`);
}
function pidPathIn(home: string, id: string): string {
  return `${sockPathIn(home, id)}.pid`;
}

function makeShortHome(): string {
  return mkdtempSync(path.join("/tmp", "edt"));
}

async function allocPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address() as net.AddressInfo;
      const p = a.port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

function waitFor(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function waitUntil(pred: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pred()) return true;
    await waitFor(50);
  }
  return false;
}

async function sendLine(sockPath: string, payload: object, expectReply: boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(sockPath);
    let buf = "";
    sock.setEncoding("utf8");
    sock.once("connect", () => {
      sock.write(JSON.stringify(payload) + "\n");
      if (!expectReply) {
        sock.end();
        resolve(null);
      }
    });
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl >= 0 && expectReply) {
        try { resolve(JSON.parse(buf.slice(0, nl))); }
        catch (e) { reject(e); }
        sock.destroy();
      }
    });
    sock.once("error", reject);
    setTimeout(() => { sock.destroy(); reject(new Error("sendLine timeout")); }, 3000);
  });
}

describe.skipIf(!IS_POSIX)("editor-keeper.cjs integration (task 7.7, POSIX)", () => {
  let tmpHome: string;
  let keeperProc: ChildProcess | null;

  beforeEach(() => {
    tmpHome = makeShortHome();
    mkdirSync(editorsDirIn(tmpHome), { recursive: true });
    keeperProc = null;
  });

  afterEach(async () => {
    if (keeperProc && keeperProc.exitCode === null) {
      try { keeperProc.kill("SIGKILL"); } catch { /* ignore */ }
      await waitFor(50);
    }
    if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
  });

  it("spawns child, writes sidecar, answers getStatus, stops cleanly", async () => {
    const port = await allocPort();
    const editorId = "abc123def456";
    const dataDir = path.join(tmpHome, "data");
    const cwd = tmpHome;

    keeperProc = spawn(
      process.execPath,
      [KEEPER_PATH, editorId, cwd, String(port), MOCK_BINARY, dataDir],
      { env: { ...process.env, HOME: tmpHome }, stdio: "ignore", detached: true },
    );
    keeperProc.unref();

    // Wait for the sidecar to appear.
    const sockPath = sockPathIn(tmpHome, editorId);
    const pidPath = pidPathIn(tmpHome, editorId);

    const sidecarUp = await waitUntil(() => existsSync(pidPath) && existsSync(sockPath), 5000);
    expect(sidecarUp).toBe(true);

    const sidecar = JSON.parse(readFileSync(pidPath, "utf8"));
    expect(sidecar.editorId).toBe(editorId);
    expect(sidecar.port).toBe(port);
    expect(typeof sidecar.keeperPid).toBe("number");
    expect(typeof sidecar.childPid).toBe("number");

    // getStatus probe
    const status: any = await sendLine(sockPath, { cmd: "getStatus" }, true);
    expect(status.event).toBe("status");
    expect(status.port).toBe(port);
    expect(typeof status.uptimeMs).toBe("number");

    // stop command
    await sendLine(sockPath, { cmd: "stop" }, false).catch(() => null);

    // Keeper unlinks sidecar + socket on child exit.
    const cleanedUp = await waitUntil(() => !existsSync(pidPath) && !existsSync(sockPath), 8000);
    expect(cleanedUp).toBe(true);
  }, 20_000);
});
