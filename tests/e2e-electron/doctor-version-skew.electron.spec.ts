/**
 * Electron-E2E: Doctor "Attached server version" row (task 7.5).
 *
 * Launches the packaged app attached to a fake `/api/health` reporting a
 * version DIFFERENT from the bundled app version, opens the Doctor window via
 * the loading page's "Open Doctor" button, and asserts the version-skew row
 * renders as a WARN with the launch-source-appropriate suggestion.
 *
 * See change: electron-attach-ownership-fixes.
 */

import fs from "node:fs";
import { type ElectronApplication, expect, test } from "@playwright/test";
import {
  FAKE_PORT,
  type FakeHealthServer,
  isPortInUse,
  launchElectron,
  makeThrowawayHome,
  openDoctorViaIpc,
  startFakeHealthServer,
} from "./electron-lifecycle.js";

let server: FakeHealthServer | undefined;
let app: ElectronApplication | undefined;
let home: string | undefined;

test.beforeAll(async () => {
  test.skip(await isPortInUse(FAKE_PORT), `port ${FAKE_PORT} in use — stop your local dashboard first`);
});

test.afterEach(async () => {
  if (app) { await app.close().catch(() => {}); app = undefined; }
  if (server) { await server.close().catch(() => {}); server = undefined; }
  if (home) { fs.rmSync(home, { recursive: true, force: true }); home = undefined; }
});

test("Doctor shows a WARN version-skew row for a standalone mismatch", async () => {
  // Standalone server one patch behind the bundled app → npm-upgrade suggestion.
  server = await startFakeHealthServer({
    pid: 4242,
    version: "0.0.1-stale",
    launchSource: "standalone",
    launchSourceEffective: "standalone",
    starter: "Standalone",
    bootParentPid: process.pid,
    ppid: process.pid,
    bootParentAlive: true,
    activeBridgeCount: 0,
    mode: "production",
  });
  home = makeThrowawayHome(server.port);
  app = await launchElectron({ home, zombiePrompt: false });
  await app.firstWindow();

  // Open Doctor via the registered IPC rather than the loading-page button:
  // once the fake server is healthy the loading page redirects to its URL,
  // discarding the transient #doctor-btn.
  const [doctorWin] = await Promise.all([
    app.waitForEvent("window"),
    openDoctorViaIpc(app),
  ]);

  // Doctor auto-runs on load. Wait for the version-skew row.
  const row = doctorWin.locator("tr", { has: doctorWin.locator(".check-name", { hasText: "Attached server version" }) });
  await expect(row).toBeVisible({ timeout: 30_000 });

  // WARN pill + launch-source-appropriate (standalone → npm) suggestion.
  await expect(row.locator(".pill")).toHaveText("WARN");
  await expect(row.locator(".suggestion")).toContainText("npm i -g @blackbelt-technology/pi-dashboard@");
});
