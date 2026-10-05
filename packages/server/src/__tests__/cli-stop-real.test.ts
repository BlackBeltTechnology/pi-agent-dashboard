/**
 * Real-process `pi-dashboard stop`: a foreign HOME must not kill a live
 * listener; `--force` must; a HOME stops its own dashboard.
 * See change: fix-cli-stop-foreign-home-kill (test-plan X4-X6).
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const WRAPPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/pi-dashboard.mjs");
const REPO_TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return true;
    await delay(200);
  }
  return false;
}

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

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

/** A non-dashboard-owned listener answering /api/health with a foreign instanceId. */
async function foreignListener(port: number): Promise<ChildProcess> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `require("http").createServer((q,r)=>r.end(JSON.stringify({ok:true,pid:process.pid,instanceId:"other"}))).listen(${port},"127.0.0.1")`,
    ],
    { stdio: "ignore" },
  );
  cleanup.push(() => child.kill("SIGKILL"));
  expect(await waitFor(() => answers(port), 10_000)).toBe(true);
  return child;
}

function runStop(home: string, args: string[]) {
  return spawnSync(process.execPath, [WRAPPER, "stop", ...args], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf-8",
    timeout: 60_000,
  });
}

function outsideTmpHome(): string {
  const home = fs.mkdtempSync(path.join(REPO_TMP, ".tmp-stop-real-"));
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

describe("pi-dashboard stop (real processes)", () => {
  it("X4: foreign HOME leaves a live listener running and says why", async () => {
    const port = await freePort();
    const listener = await foreignListener(port);
    const r = runStop(outsideTmpHome(), ["--port", String(port), "--pi-port", String(port + 1)]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`held by pid ${listener.pid}`);
    expect(r.stdout).toContain("--force");
    expect(await answers(port)).toBe(true);
  }, 90_000);

  it("X5: --force kills the foreign listener and warns", async () => {
    const port = await freePort();
    await foreignListener(port);
    const r = runStop(outsideTmpHome(), ["--port", String(port), "--pi-port", String(port + 1), "--force"]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain("NOT owned by this HOME");
    expect(await waitFor(async () => !(await answers(port)), 6_000)).toBe(true);
  }, 90_000);

  // E2 (review B1): the real entry point, temp HOME, no port flags — no bind-refusal
  // warning (main() passes the no-op warn) and the 8000 default is never swept.
  it("E2: `stop` under a temp HOME prints no [isolation] line and sweeps no production port", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "stop-real-e2-"));
    cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
    const r = runStop(home, []);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain("[isolation]");
    expect(r.stdout).toContain("Dashboard server is not running");
    expect(r.stdout).not.toContain("held by pid");
  }, 90_000);

  it("X6: a temp HOME stops its own dashboard", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "stop-real-own-"));
    cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }));
    const port = await freePort();
    const proc = spawn(process.execPath, [WRAPPER, "--port", String(port), "--pi-port", String(port + 1), "--no-tunnel"], {
      stdio: "ignore",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    cleanup.push(() => proc.kill("SIGKILL"));
    expect(await waitFor(() => answers(port), 60_000), `dashboard did not boot on :${port}`).toBe(true);

    const r = runStop(home, ["--port", String(port), "--pi-port", String(port + 1)]);
    expect(r.stdout).not.toContain("not owned by this HOME");
    expect(await waitFor(async () => !(await answers(port)), 6_000)).toBe(true);
  }, 150_000);
});
