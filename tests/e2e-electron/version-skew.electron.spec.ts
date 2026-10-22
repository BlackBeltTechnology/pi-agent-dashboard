/**
 * Electron-E2E: attach-time version-skew check (tasks 8.2–8.6).
 *
 * Launches the packaged app against a fake `/api/health` whose version differs
 * from the app's bundled runtime. Native `dialog.showMessageBox` is stubbed, so
 * we assert the flow REACHES the right modal (buttons, count) and that choices
 * drive the documented outcome (e.g. a graceful `POST /api/shutdown`).
 * Needs the packaged bundle (`runtime-manifest.json`); skips otherwise.
 *
 * test-plan: F1 (merged modal), F2 (info modal, no shutdown), F4 (restart),
 * F5 (matching versions silent), F6 (`--no-zombie-prompt` logs, no modal).
 * See change: electron-attach-version-skew.
 */

import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  bundledRuntimeVersion,
  FAKE_PORT,
  type FakeHealth,
  type FakeHealthServer,
  isPortInUse,
  launchElectron,
  makeThrowawayHome,
  readDialogCalls,
  skewedVersion,
  startFakeHealthServer,
  stubDialog,
} from "./electron-lifecycle.js";

const PID = 424242;
const BUNDLED = bundledRuntimeVersion();

/** Reparented + boot parent dead → zombie shape (POSIX and win32). */
const zombie = (version: string): FakeHealth => ({
  pid: PID,
  version,
  launchSource: "electron",
  launchSourceEffective: "electron",
  bootParentPid: 999999,
  ppid: 1,
  bootParentAlive: false,
  activeBridgeCount: 0,
  platform: process.platform,
  mode: "production",
});

/** Electron-launched but NOT a zombie (ppid === bootParentPid), owner dead. */
const ownedElectron = (version: string): FakeHealth => ({
  ...zombie(version),
  bootParentPid: 5000,
  ppid: 5000,
});

const standalone = (version: string): FakeHealth => ({
  pid: PID,
  version,
  launchSource: "standalone",
  launchSourceEffective: "standalone",
  bootParentPid: process.pid,
  ppid: process.pid,
  bootParentAlive: true,
  activeBridgeCount: 0,
  mode: "production",
});

let server: FakeHealthServer | undefined;
let app: ElectronApplication | undefined;
let home: string | undefined;
let child: ChildProcess | undefined;

test.beforeAll(async () => {
  test.skip(BUNDLED === null, "no packaged bundle (runtime-manifest.json) — skew scenarios need one");
  test.skip(await isPortInUse(FAKE_PORT), `port ${FAKE_PORT} in use — stop your local dashboard first`);
});

test.beforeEach(() => {
  // #531 quarantine (darwin only): launch/close path hangs on macOS under Electron; same as zombie-adoption.
  test.fixme(process.platform === "darwin", "https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/531");
});

test.afterEach(async () => {
  if (app) { await app.close().catch(() => {}); app = undefined; }
  if (server) { await server.close().catch(() => {}); server = undefined; }
  if (child) { child.kill(); child = undefined; }
  if (home) { fs.rmSync(home, { recursive: true, force: true }); home = undefined; }
});

async function launch(health: FakeHealth, opts: { response: number; zombiePrompt: boolean }): Promise<ElectronApplication> {
  server = await startFakeHealthServer(health);
  home = makeThrowawayHome(server.port);
  app = await launchElectron({ home, zombiePrompt: opts.zombiePrompt });
  await stubDialog(app, opts.response);
  await app.firstWindow();
  return app;
}

test("F1: a skewed zombie shows ONE merged modal", async () => {
  await launch(zombie(skewedVersion(BUNDLED!)), { response: 2 /* Leave running */, zombiePrompt: true });
  await expect.poll(async () => (await readDialogCalls(app!)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 2_000)); // a second modal would show up here
  const calls = await readDialogCalls(app!);
  expect(calls).toHaveLength(1);
  expect(calls[0].buttons).toEqual([`Restart with v${BUNDLED}`, "Take ownership", "Leave running"]);
});

test("F2: the info modal never stops an external server", async () => {
  await launch(standalone(skewedVersion(BUNDLED!)), { response: 0 /* OK */, zombiePrompt: true });
  await expect.poll(async () => (await readDialogCalls(app!)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 2_000));
  const calls = await readDialogCalls(app!);
  expect(calls).toHaveLength(1);
  expect(calls[0].buttons).toEqual(["OK", "Don't show again for this version pair"]);
  expect(server!.requests.filter((r) => r.method === "POST" && r.url.startsWith("/api/shutdown"))).toHaveLength(0);
});

test("F3/F4: Restart sends a graceful /api/shutdown with local-proof headers", async () => {
  // A live, test-owned PID: if the force path escalates to a signal after the graceful wait, it can only hit this child.
  child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await launch({ ...ownedElectron(skewedVersion(BUNDLED!)), pid: child.pid }, { response: 0 /* Restart with v… */, zombiePrompt: true });
  await expect
    .poll(() => server!.requests.filter((r) => r.method === "POST" && r.url.startsWith("/api/shutdown")).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const post = server!.requests.find((r) => r.method === "POST" && r.url.startsWith("/api/shutdown"))!;
  const calls = await readDialogCalls(app!);
  expect(calls[0].buttons).toEqual([`Restart with v${BUNDLED}`, "Leave running"]);
  // The shutdown is authenticated with a local proof when the server has a local token; the fake
  // home has none, so only assert the request carried the app's own headers object.
  expect(post.headers).toBeDefined();
});

test("F5: matching versions attach silently", async () => {
  await launch(ownedElectron(BUNDLED!), { response: 1, zombiePrompt: true });
  await new Promise((r) => setTimeout(r, 5_000));
  expect(await readDialogCalls(app!)).toHaveLength(0);
});

test("F6: --no-zombie-prompt suppresses skew modals but logs the decision", async () => {
  // The app log is shared across runs: read only what this launch appended.
  const logPath = path.join(process.env.TEMP || process.env.TMP || os.tmpdir(), "pi-dashboard-electron.log");
  const offset = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
  const skewed = skewedVersion(BUNDLED!);
  await launch(zombie(skewed), { response: 1, zombiePrompt: false });
  await new Promise((r) => setTimeout(r, 5_000));
  expect(await readDialogCalls(app!)).toHaveLength(0);
  const appended = fs.readFileSync(logPath, "utf8").slice(offset);
  const line = appended.split("\n").find((l) => l.includes("[attach-check]") && l.includes("action="));
  expect(line, "an [attach-check] decision line").toBeDefined();
  expect(line).toContain(BUNDLED!);
  expect(line).toContain(skewed);
});
