/**
 * Real-process bare `pi-dashboard` against the desktop app's server: the second
 * foreground fails fast with the already-running verdict, exits 1, and leaves the
 * running server's identity files untouched.
 * See change: fix-cli-control-electron-server (test-plan #X10; design D5).
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const WRAPPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/pi-dashboard.mjs");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => res(port));
    });
  });
}

async function answers(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

async function waitFor(pred: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return true;
    await delay(200);
  }
  return false;
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

describe("bare pi-dashboard against the desktop app's server (real processes)", () => {
  it("X10: second foreground → already running + desktop-app mention, exit 1, identity files untouched", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "fg-real-x10-"));
    cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
    const port = await freePort();
    const piPort = await freePort();
    const args = ["--port", String(port), "--pi-port", String(piPort)];
    const env = { ...process.env, HOME: home, USERPROFILE: home };

    // The "desktop app's" server: DASHBOARD_STARTER=Electron; this test process is its live parent.
    const first: ChildProcess = spawn(process.execPath, [WRAPPER, ...args, "--no-tunnel"], {
      stdio: "ignore",
      env: { ...env, DASHBOARD_STARTER: "Electron" },
    });
    cleanup.push(() => first.kill("SIGKILL"));
    expect(await waitFor(() => answers(port), 60_000), `server did not boot on :${port}`).toBe(true);

    const dash = path.join(home, ".pi", "dashboard");
    const files = ["server.pid", "server.lock.meta.json", path.join("instances", `${piPort}.id`)];
    const snapshot = () => files.map((f) => fs.readFileSync(path.join(dash, f), "utf-8"));
    const before = snapshot();
    const meta = JSON.parse(fs.readFileSync(path.join(dash, "server.lock.meta.json"), "utf-8")) as { pid: number };

    const t0 = Date.now();
    const second = spawnSync(process.execPath, [WRAPPER, ...args, "--no-tunnel"], {
      env,
      encoding: "utf-8",
      timeout: 60_000,
    });
    expect(Date.now() - t0).toBeLessThan(10_000 + 20_000); // classify budget + boot slack

    expect(second.status).toBe(1);
    expect(second.stdout).toMatch(new RegExp(`already running \\(pid ${meta.pid}\\)`));
    expect(second.stdout).toMatch(/desktop app/i);
    expect(second.stderr).not.toContain("Failed to start dashboard");
    expect(snapshot()).toEqual(before);
    expect(await answers(port)).toBe(true);
  }, 150_000);
});
