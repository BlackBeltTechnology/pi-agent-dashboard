/**
 * Electron-E2E: the packaged main window exposes `window.piDashboard`
 * (test-plan F1, refresh-electron-bundled-components).
 *
 * Forge 8's Vite plugin emits preloads as `[name].cjs`, while the main process loads
 * `preload-main.js` and silently runs the window WITHOUT a preload when the file is
 * missing. The preload Vite configs pin the `.js` filename; this spec proves it on
 * the REAL packaged app: launch via Playwright `_electron` against a fake dashboard
 * server, wait for the dashboard main window, and read the bridge from the page.
 *
 * Determinism reuses the electron-lifecycle harness: a throwaway HOME (first-run
 * marker, pinned port) and a benign fake `/api/health` on a free ephemeral port, so
 * it never collides with a live dashboard.
 *
 * See change: refresh-electron-bundled-components.
 */

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  type FakeHealth,
  type FakeHealthServer,
  launchElectron,
  makeThrowawayHome,
  startFakeHealthServer,
} from "./electron-lifecycle.js";

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** Close the packaged app; force-kill if the graceful close hangs (tray/updaters). */
async function closeApp(a: ElectronApplication): Promise<void> {
  const proc = a.process();
  await Promise.race([a.close().catch(() => {}), new Promise((r) => setTimeout(r, 8_000))]);
  try {
    proc.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

const healthyHealth: FakeHealth = {
  pid: process.pid,
  version: "0.5.4",
  launchSource: "cli",
  launchSourceEffective: "cli",
  starter: "CLI",
  bootParentAlive: true,
  activeBridgeCount: 1,
  platform: process.platform,
  mode: "production",
};

let server: FakeHealthServer | undefined;
let app: ElectronApplication | undefined;
let home: string | undefined;

test.afterEach(async () => {
  if (app) {
    await closeApp(app);
    app = undefined;
  }
  if (server) {
    await server.close().catch(() => {});
    server = undefined;
  }
  if (home) {
    fs.rmSync(home, { recursive: true, force: true });
    home = undefined;
  }
});

test("F1: the packaged main window exposes window.piDashboard (requestLaunch + openDoctor)", async () => {
  const port = await getFreePort();
  server = await startFakeHealthServer(healthyHealth, { port });
  home = makeThrowawayHome(server.port);
  // Own user-data dir => own single-instance lock: runs beside an installed, running app.
  app = await launchElectron({ home, zombiePrompt: false, userDataDir: path.join(home, "user-data") });

  // The dashboard main window = the one that loaded the fake server's origin. The app
  // addresses its server as `localhost`, so match on the pinned port, not the host.
  const onFakeServer = (url: string) => new URL(url).port === String(port);
  await expect
    .poll(() => app!.windows().some((w) => onFakeServer(w.url())), { timeout: 60_000 })
    .toBe(true);
  const win = app.windows().find((w) => onFakeServer(w.url()))!;

  const shape = await win.evaluate(() => {
    const api = (window as unknown as { piDashboard?: Record<string, unknown> }).piDashboard;
    return {
      type: typeof api,
      requestLaunch: typeof api?.requestLaunch,
      openDoctor: typeof api?.openDoctor,
    };
  });
  expect(shape).toEqual({ type: "object", requestLaunch: "function", openDoctor: "function" });
});
