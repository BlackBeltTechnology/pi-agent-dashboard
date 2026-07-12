/**
 * Electron-E2E: the local `build-installer.sh` DMG launches + opens the
 * dashboard (change: fix-local-electron-dmg-build, task 5.2 automated).
 *
 * `npm run electron:build` now produces the macOS DMG via
 * `electron-forge package` → `electron-builder --mac dmg --prepackaged`
 * (mirrors CI `_electron-build.yml`). This spec proves the produced DMG is
 * runnable: it MOUNTS the DMG, launches the REAL `.app` binary from the
 * read-only volume via Playwright `_electron`, and asserts the packaged binary
 *   1. boots + runs the bootstrap health-probe (fake `/api/health` hit), and
 *   2. opens the dashboard window (fake server serves the page GET),
 *   3. with no zombie/error modal — a clean launch. There is no first-run
 *      wizard (removed by auto-launch-first-run-skip-welcome), so a clean
 *      dashboard open IS "no wizard".
 *
 * darwin-only (DMG is macOS). Skipped when no DMG exists (build first:
 * `npm run electron:build`) or when :8000 is already bound (a live dashboard).
 *
 * Determinism reuses the electron-lifecycle harness: a FakeHealthServer on
 * :8000 + a throwaway HOME pinned to it. We point the shared
 * `resolvePackagedBinary()` at the mounted DMG via `PW_ELECTRON_BINARY`.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  ELECTRON_DIR,
  type FakeHealth,
  type FakeHealthServer,
  launchElectron,
  makeThrowawayHome,
  readDialogCalls,
  startFakeHealthServer,
} from "./electron-lifecycle.js";

/** An OS-assigned free TCP port. Avoids colliding with a live dashboard. */
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

/** Close the packaged app; force-kill if graceful close hangs (tray/updaters). */
async function closeApp(a: ElectronApplication): Promise<void> {
  const proc = a.process();
  await Promise.race([
    a.close().catch(() => {}),
    new Promise((r) => setTimeout(r, 8_000)),
  ]);
  try {
    proc.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

// Benign (non-zombie) health so the attach arm opens the dashboard cleanly.
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

/** Locate the DMG produced by build-installer.sh under out/make/. */
function findDmg(): string | null {
  const makeDir = path.join(ELECTRON_DIR, "out", "make");
  if (!fs.existsSync(makeDir)) return null;
  const dmg = fs.readdirSync(makeDir).find((f) => f.endsWith(".dmg"));
  return dmg ? path.join(makeDir, dmg) : null;
}

/** Mount a DMG read-only; return the mount point (a /Volumes/... path). */
function mountDmg(dmg: string): string {
  const out = execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", dmg], {
    encoding: "utf8",
  });
  // Last line carries the mount point in its final tab-separated column.
  const line = out.trim().split("\n").pop() ?? "";
  const mount = line.split("\t").pop()?.trim() ?? "";
  if (!mount || !fs.existsSync(mount)) {
    throw new Error(`[dmg-e2e] could not parse mount point from hdiutil output:\n${out}`);
  }
  return mount;
}

function detachDmg(mount: string): void {
  try {
    execFileSync("hdiutil", ["detach", mount, "-quiet"], { stdio: "ignore" });
  } catch {
    /* best-effort unmount */
  }
}

/** The .app binary path inside a mounted DMG volume. */
function appBinaryUnder(mount: string): string {
  const app = fs.readdirSync(mount).find((d) => d.endsWith(".app"));
  if (!app) throw new Error(`[dmg-e2e] no .app under mounted volume ${mount}`);
  const name = app.replace(/\.app$/, "");
  return path.join(mount, app, "Contents", "MacOS", name);
}

let server: FakeHealthServer | undefined;
let app: ElectronApplication | undefined;
let home: string | undefined;
let mount: string | undefined;
let prevBinaryOverride: string | undefined;

test.beforeAll(async () => {
  test.skip(process.platform !== "darwin", "DMG launch is macOS-only");
  const dmg = findDmg();
  test.skip(!dmg, "no DMG under packages/electron/out/make — run `npm run electron:build` first");

  mount = mountDmg(dmg as string);
  // Point the shared binary resolver at the mounted DMG's .app.
  prevBinaryOverride = process.env.PW_ELECTRON_BINARY;
  process.env.PW_ELECTRON_BINARY = appBinaryUnder(mount);
});

test.afterAll(async () => {
  if (mount) {
    detachDmg(mount);
    mount = undefined;
  }
  if (prevBinaryOverride === undefined) delete process.env.PW_ELECTRON_BINARY;
  else process.env.PW_ELECTRON_BINARY = prevBinaryOverride;
});

test.afterEach(async () => {
  if (app) { await closeApp(app); app = undefined; }
  if (server) { await server.close().catch(() => {}); server = undefined; }
  if (home) { fs.rmSync(home, { recursive: true, force: true }); home = undefined; }
});

test("mounted DMG app launches and opens the dashboard (no wizard)", async () => {
  // Free ephemeral port so the fake server never collides with a live :8000
  // dashboard; the app probes this port via the throwaway HOME config.
  const port = await getFreePort();
  server = await startFakeHealthServer(healthyHealth, { port });
  home = makeThrowawayHome(server.port);
  // zombiePrompt:false → guarantees no adoption modal; this test validates the
  // build artifact boots, not the (unrelated) zombie-adoption feature.
  app = await launchElectron({ home, zombiePrompt: false });

  // 1. A window opens → the DMG-packaged binary is executable and booted.
  const win = await app.firstWindow();
  expect(win).toBeTruthy();

  // 2. Bootstrap ran: the packaged binary health-probed the fake server.
  await expect
    .poll(() => server!.requests.some((r) => r.method === "GET" && r.url.startsWith("/api/health")), {
      timeout: 30_000,
    })
    .toBe(true);

  // 3. Dashboard opens: the main window requested the dashboard page (any GET
  //    that is not an /api/* control route) from the fake server.
  await expect
    .poll(() => server!.requests.some((r) => r.method === "GET" && !r.url.startsWith("/api/")), {
      timeout: 30_000,
    })
    .toBe(true);

  // 4. Clean launch: no zombie/error modal fired.
  await new Promise((r) => setTimeout(r, 3_000));
  expect(await readDialogCalls(app)).toHaveLength(0);
});
