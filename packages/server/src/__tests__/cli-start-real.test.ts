/**
 * Real-process `pi-dashboard start` / `status` against a live, healthy-but-
 * pid-less, foreign-HOME, or FROZEN (SIGSTOP) dashboard.
 *
 * Harness glue copied from `cli-stop-real.test.ts`: temp HOME, `freePort()`,
 * the real `bin/pi-dashboard.mjs`. POSIX-only where SIGSTOP is used.
 * See change: harden-dashboard-start-detection (test-plan E1, E2, X1, X2, X18).
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
const posixOnly = process.platform === "win32";

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

async function healthPid(port: number): Promise<number | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { pid?: number };
    return typeof body.pid === "number" ? body.pid : null;
  } catch {
    return null;
  }
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function tmpHome(label: string): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `start-real-${label}-`));
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return home;
}

/** A foreground dashboard of `home` on `port`; resolves once /api/health answers. */
async function bootDashboard(home: string, port: number): Promise<{ child: ChildProcess; pid: number }> {
  const child = spawn(process.execPath, [WRAPPER, "--port", String(port), "--pi-port", String(port + 1), "--no-tunnel"], {
    stdio: "ignore",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  cleanup.push(() => {
    try { child.kill("SIGCONT"); } catch { /* gone */ }
    try { child.kill("SIGKILL"); } catch { /* gone */ }
  });
  let pid: number | null = null;
  expect(await waitFor(async () => (pid = await healthPid(port)) !== null, 90_000), `dashboard did not boot on :${port}`).toBe(true);
  // The wrapper may spawn the real server as a child: reap that pid too, and
  // make sure it is not left SIGSTOPped.
  const serverPid = pid as unknown as number;
  cleanup.push(() => {
    for (const sig of ["SIGCONT", "SIGKILL"] as const) {
      try { process.kill(serverPid, sig); } catch { /* gone */ }
    }
  });
  return { child, pid: serverPid };
}

function run(home: string, sub: "start" | "status", port: number) {
  return spawnSync(process.execPath, [WRAPPER, sub, "--port", String(port), "--pi-port", String(port + 1), "--no-tunnel"], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf-8",
    timeout: 90_000,
  });
}

const pidFileOf = (home: string) => path.join(home, ".pi", "dashboard", "server.pid");
const metaOf = (home: string) => path.join(home, ".pi", "dashboard", "server.lock.meta.json");
const lockDirOf = (home: string) => path.join(home, ".pi", "dashboard", "server.lock.lock");

describe("pi-dashboard start (real processes)", () => {
  it("E1: a healthy dashboard without server.pid counts as running — no second server", async () => {
    const home = tmpHome("e1");
    const port = await freePort();
    const { pid } = await bootDashboard(home, port);
    fs.rmSync(pidFileOf(home), { force: true });

    const r = run(home, "start", port);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain(`already running (pid ${pid})`);
    expect(await healthPid(port)).toBe(pid); // still the one dashboard
    expect(fs.existsSync(pidFileOf(home))).toBe(false);
  }, 180_000);

  it("E2: another HOME's dashboard on the port is refused, and nothing is created under this HOME", async () => {
    const homeA = tmpHome("e2a");
    const homeB = tmpHome("e2b");
    const port = await freePort();
    const { pid } = await bootDashboard(homeA, port);

    const r = run(homeB, "start", port);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout + r.stderr).toContain("not owned by this HOME");
    expect(r.stdout + r.stderr).toContain(`pid ${pid}`);
    expect(await healthPid(port)).toBe(pid);
    expect(fs.existsSync(path.join(homeB, ".pi", "dashboard", "instances"))).toBe(false);
  }, 180_000);

  it.skipIf(posixOnly)("X1: a frozen dashboard is refused, not replaced; its records are untouched", async () => {
    const home = tmpHome("x1");
    const port = await freePort();
    const { child, pid } = await bootDashboard(home, port);
    expect(fs.existsSync(metaOf(home))).toBe(true);
    const pidBefore = fs.readFileSync(pidFileOf(home));
    const metaBefore = fs.readFileSync(metaOf(home));

    process.kill(pid, "SIGSTOP");
    try {
      const r = run(home, "start", port);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout + r.stderr).toContain(`running but not responding (pid ${pid})`);
      expect(fs.readFileSync(pidFileOf(home)).equals(pidBefore)).toBe(true);
      expect(fs.readFileSync(metaOf(home)).equals(metaBefore)).toBe(true);
    } finally {
      process.kill(pid, "SIGCONT");
    }
    expect(await waitFor(async () => (await healthPid(port)) === pid, 20_000)).toBe(true);
    expect(child.exitCode).toBeNull();
  }, 180_000);

  it.skipIf(posixOnly)("X2: `status` of a frozen dashboard says so (exit 1) and leaves server.pid alone", async () => {
    const home = tmpHome("x2");
    const port = await freePort();
    const { pid } = await bootDashboard(home, port);
    const pidBefore = fs.readFileSync(pidFileOf(home));

    process.kill(pid, "SIGSTOP");
    try {
      const r = run(home, "status", port);
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(r.stdout + r.stderr).toContain("running but not responding");
      expect(fs.readFileSync(pidFileOf(home)).equals(pidBefore)).toBe(true);
    } finally {
      process.kill(pid, "SIGCONT");
    }
  }, 180_000);

  it.skipIf(posixOnly)("X18: a second server on a frozen dashboard's ports and HOME exits and leaves every record intact", async () => {
    const home = tmpHome("x18");
    const port = await freePort();
    const { pid } = await bootDashboard(home, port);
    const metaBefore = fs.readFileSync(metaOf(home));
    const pidBefore = fs.readFileSync(pidFileOf(home));
    const lockMtime = fs.statSync(lockDirOf(home)).mtimeMs;

    process.kill(pid, "SIGSTOP");
    try {
      const b = spawn(process.execPath, [WRAPPER, "--port", String(port), "--pi-port", String(port + 1), "--no-tunnel"], {
        stdio: "ignore",
        env: { ...process.env, HOME: home, USERPROFILE: home },
      });
      cleanup.push(() => { try { b.kill("SIGKILL"); } catch { /* gone */ } });
      const exited = await waitFor(() => b.exitCode !== null || b.signalCode !== null, 60_000);
      expect(exited, "the second server never exited").toBe(true);
      expect(b.exitCode).not.toBe(0);

      expect(fs.readFileSync(metaOf(home)).equals(metaBefore)).toBe(true);
      expect(fs.readFileSync(pidFileOf(home)).equals(pidBefore)).toBe(true);
      expect(fs.existsSync(lockDirOf(home))).toBe(true);
      expect(fs.statSync(lockDirOf(home)).mtimeMs).toBe(lockMtime); // frozen holder: nobody touched it
    } finally {
      process.kill(pid, "SIGCONT");
    }
    expect(await waitFor(async () => (await healthPid(port)) === pid, 20_000)).toBe(true);
  }, 240_000);
});
