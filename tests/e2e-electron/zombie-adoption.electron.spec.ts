/**
 * Electron-E2E: zombie-adoption modal (tasks 4.4 / 7.3).
 *
 * Launches the packaged app against a fake `/api/health` that reports a zombie
 * (launchSourceEffective "electron", boot parent dead, reparented, no stored
 * pid). Native `dialog.showMessageBox` is stubbed in the main process, so we
 * assert the flow REACHES the modal with the right PID and that each choice
 * drives the documented outcome — the native modal UI itself cannot be clicked
 * by automation.
 *
 * See change: electron-attach-ownership-fixes.
 */

import fs from "node:fs";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  captureMenuTemplates,
  FAKE_PORT,
  type FakeHealth,
  type FakeHealthServer,
  isPortInUse,
  launchElectron,
  makeThrowawayHome,
  readDialogCalls,
  readMenuTemplates,
  startFakeHealthServer,
  stubDialog,
} from "./electron-lifecycle.js";

const ZOMBIE_PID = 424242;

// POSIX zombie shape (reparented + boot parent dead). On Windows the ppid
// gate is ignored; bootParentAlive:false alone triggers — this shape covers both.
const zombieHealth: FakeHealth = {
  pid: ZOMBIE_PID,
  version: "0.5.4",
  launchSource: "electron",
  launchSourceEffective: "electron",
  starter: "Electron",
  bootParentPid: 999999, // some prior, now-dead Electron
  ppid: 1,               // reparented away
  bootParentAlive: false,
  activeBridgeCount: 0,
  platform: process.platform,
  mode: "production",
};

let server: FakeHealthServer | undefined;
let app: ElectronApplication | undefined;
let home: string | undefined;

test.beforeAll(async () => {
  // Never clobber a live dashboard on :8000 when running locally.
  test.skip(await isPortInUse(FAKE_PORT), `port ${FAKE_PORT} in use — stop your local dashboard first`);
});

test.afterEach(async () => {
  if (app) { await app.close().catch(() => {}); app = undefined; }
  if (server) { await server.close().catch(() => {}); server = undefined; }
  if (home) { fs.rmSync(home, { recursive: true, force: true }); home = undefined; }
});

test("shows the adoption modal with the zombie PID", async () => {
  server = await startFakeHealthServer(zombieHealth);
  home = makeThrowawayHome(server.port);
  app = await launchElectron({ home, zombiePrompt: true });
  await stubDialog(app, /* "Leave running" */ 1);
  await app.firstWindow();

  await expect
    .poll(async () => (await readDialogCalls(app!)).length, { timeout: 30_000 })
    .toBeGreaterThan(0);

  const calls = await readDialogCalls(app);
  expect(calls[0].buttons).toEqual(["Take ownership", "Leave running", "Stop now"]);
  expect(calls[0].detail ?? "").toContain(String(ZOMBIE_PID));
});

test("--no-zombie-prompt suppresses the modal", async () => {
  server = await startFakeHealthServer(zombieHealth);
  home = makeThrowawayHome(server.port);
  app = await launchElectron({ home, zombiePrompt: false });
  await stubDialog(app, 1);
  await app.firstWindow();

  // Give the attach arm ample time to (not) fire the modal.
  await new Promise((r) => setTimeout(r, 5_000));
  const calls = await readDialogCalls(app);
  expect(calls.length).toBe(0);
});

test("Take ownership → tray flips to electron-owned (Restart server)", async () => {
  server = await startFakeHealthServer(zombieHealth);
  home = makeThrowawayHome(server.port);
  app = await launchElectron({ home, zombiePrompt: true });
  await stubDialog(app, /* "Take ownership" */ 0);
  await captureMenuTemplates(app);
  await app.firstWindow();

  // Modal fires → "adopt" → setSpawnedPid(health.pid).
  await expect
    .poll(async () => (await readDialogCalls(app!)).length, { timeout: 30_000 })
    .toBeGreaterThan(0);

  // Observable outcome (app.close() does NOT run the graceful-quit shutdown
  // path, so we assert the adoption took effect via ownership instead): the
  // next tray poll classifies the server "electron" (storedSpawnedPid now
  // matches health.pid) and rebuilds the menu with "Restart server".
  await expect
    .poll(
      async () => {
        const templates = await readMenuTemplates(app!);
        return templates.some((t) => t.some((i) => i.label === "Restart server"));
      },
      { timeout: 15_000 },
    )
    .toBe(true);
});
