/**
 * Electron-E2E: the REAL packaged app applies the grouped Windows/Linux application
 * menu (Dashboard / Edit / View / Help). Win/Linux hosts only — the macOS menu is
 * unchanged and has its own top-level labels.
 *
 *  - S32: top-level labels are exactly ["Dashboard","Edit","View","Help"].
 *  - S33: the Dashboard menu's last item is the `quit` role, labelled by Electron
 *    ("Quit" on Linux, "Exit" on Windows) — a unit test with a mocked `Menu` can't see it.
 *  - S34: the Servers submenu is rebuilt in the real app when the keyring changes
 *    (pairing a remote dashboard through the real remote-connect + connecting windows),
 *    and the top level stays at four menus.
 *
 * See change: electron-menu-submenus.
 */
import fs from "node:fs";
import { type ElectronApplication, expect, type Page, test } from "@playwright/test";
import {
  clickAppMenuItem,
  FAKE_PORT,
  type FakeHealthServer,
  type FakeRemoteDashboard,
  firstNonInternalIPv4,
  isPortInUse,
  launchElectron,
  makeThrowawayHome,
  readServersMenu,
  startFakeHealthServer,
  startFakeRemoteDashboard,
  stubDialog,
} from "./electron-lifecycle.js";

let local: FakeHealthServer | undefined;
let remote: FakeRemoteDashboard | undefined;
let app: ElectronApplication | undefined;
let home: string | undefined;

test.beforeAll(async () => {
  test.skip(process.platform !== "win32" && process.platform !== "linux", "grouped menu is Windows/Linux only");
  test.skip(await isPortInUse(FAKE_PORT), `port ${FAKE_PORT} in use — stop your local dashboard first`);
});

test.afterEach(async () => {
  if (app) {
    await app.close().catch(() => {});
    app = undefined;
  }
  if (local) {
    await local.close().catch(() => {});
    local = undefined;
  }
  if (remote) {
    await remote.close().catch(() => {});
    remote = undefined;
  }
  if (home) {
    fs.rmSync(home, { recursive: true, force: true });
    home = undefined;
  }
});

const BENIGN_HEALTH = {
  pid: 4242,
  version: "0.0.0",
  launchSource: "standalone",
  launchSourceEffective: "standalone",
  bootParentPid: process.pid,
  ppid: process.pid,
  bootParentAlive: true,
  activeBridgeCount: 0,
  mode: "production",
};

async function launch(): Promise<ElectronApplication> {
  local = await startFakeHealthServer(BENIGN_HEALTH);
  home = makeThrowawayHome(local.port);
  app = await launchElectron({ home, zombiePrompt: false });
  await app.firstWindow();
  return app;
}

const topLevelLabels = (a: ElectronApplication) =>
  a.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? []).map((i) => i.label));

async function windowWhere(a: ElectronApplication, match: (url: string) => boolean, timeout = 30_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = a.windows().find((w) => !w.isClosed() && match(w.url()));
    if (found) return found;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`[electron-e2e] window not found; open windows: ${JSON.stringify(a.windows().map((w) => (w.isClosed() ? "(closed)" : w.url())))}`);
}

test("S32: the packaged app applies the grouped menu (Dashboard, Edit, View, Help)", async () => {
  const a = await launch();
  await expect.poll(() => topLevelLabels(a)).toEqual(["Dashboard", "Edit", "View", "Help"]);
});

test("S33: the Dashboard menu ends with the platform-native quit label", async () => {
  const a = await launch();
  await expect.poll(() => topLevelLabels(a)).toContain("Dashboard");
  const last = await a.evaluate(({ Menu }) => {
    const dash = (Menu.getApplicationMenu()?.items ?? []).find((i) => i.label === "Dashboard");
    const items = dash?.submenu?.items ?? [];
    return items[items.length - 1]?.label;
  });
  expect(last).toBe(process.platform === "win32" ? "Exit" : "Quit");
});

test("S34: the Servers submenu is rebuilt live when a server is paired", async () => {
  test.skip(!firstNonInternalIPv4(), "no non-internal IPv4 address on this machine");
  const a = await launch();
  remote = await startFakeRemoteDashboard();
  await stubDialog(a, 2); // "Close" for any main-owned dialog
  const before = await readServersMenu(a);
  expect(before.some((l) => l.startsWith(remote!.host))).toBe(false);

  await clickAppMenuItem(a, "Connect to Remote Dashboard…");
  const rc = await windowWhere(a, (u) => u.endsWith("remote-connect.html"));
  await rc.fill("#remote-url", remote.origin);
  await rc.click("#window-btn");
  const connecting = await windowWhere(a, (u) => u.endsWith("connecting.html"));
  await expect(connecting.locator("#full-fp")).toHaveText(remote.fingerprint);
  await connecting.click("#btn-send");
  await expect(connecting.locator("#code")).toHaveText("4821 7730");

  await expect.poll(async () => (await readServersMenu(a)).some((l) => l.startsWith(remote!.host)), { timeout: 45_000 }).toBe(true);
  expect(await topLevelLabels(a)).toEqual(["Dashboard", "Edit", "View", "Help"]);
});
