/**
 * Electron-E2E: tray ownership-aware menu (task 7.2).
 *
 * The tray context menu is a NATIVE OS menu (not DOM, not clickable by
 * automation). The real gap is: does the LIVE app, attached to a server it
 * does not own, build the disabled "Server managed externally" row instead of
 * "Restart server"? We assert that by monkeypatching `Menu.buildFromTemplate`
 * in the main process and inspecting the template the tray actually built — no
 * native clicker, no production test seam.
 *
 * In the attach arm `storedSpawnedPid === null`, so `decideOwnership` returns
 * "foreign" for ANY reachable server — exactly the power-user scenario (a
 * `pi-dashboard start` terminal / pi-session server on :8000).
 *
 * See change: electron-attach-ownership-fixes.
 */
import fs from "node:fs";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  captureMenuTemplates,
  FAKE_PORT,
  type FakeHealthServer,
  isPortInUse,
  launchElectron,
  makeThrowawayHome,
  readMenuTemplates,
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

test("foreign server → tray builds disabled 'Server managed externally', never 'Restart server'", async () => {
  // Not a zombie (bootParentAlive true, standalone) so the zombie modal never
  // fires. A generous health delay widens the window to install the Menu
  // capture before the tray's first foreign rebuild.
  server = await startFakeHealthServer(
    {
      pid: 4242,
      version: "0.5.4",
      launchSource: "standalone",
      launchSourceEffective: "standalone",
      starter: "Standalone",
      bootParentPid: process.pid,
      ppid: process.pid,
      bootParentAlive: true,
      activeBridgeCount: 0,
      mode: "production",
    },
    // < the 1 s getServerOwnership fetch timeout, so the probe resolves to
    // "foreign" instead of timing out to "unknown"; still ample time to install
    // the Menu-capture before the tray's first foreign rebuild.
    { healthDelayMs: 600 },
  );
  home = makeThrowawayHome(server.port);
  app = await launchElectron({ home, zombiePrompt: false });
  // Install the capture before the tray's ownership poll classifies foreign.
  await captureMenuTemplates(app);
  await app.firstWindow();

  // The tray rebuilds when ownership resolves to "foreign" → a template with the
  // disabled informational row and no launch action.
  await expect
    .poll(
      async () => {
        const templates = await readMenuTemplates(app!);
        return templates.some(
          (t) =>
            t.some((i) => i.label === "Server managed externally" && i.enabled === false) &&
            !t.some((i) => i.label === "Restart server"),
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  // The tray must NEVER have offered a Restart action against the foreign server.
  const templates = await readMenuTemplates(app);
  expect(templates.some((t) => t.some((i) => i.label === "Restart server"))).toBe(false);
});
