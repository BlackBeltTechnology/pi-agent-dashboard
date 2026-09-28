/**
 * Electron-E2E: local folder link (test-plan X13, task 8.5).
 *
 * Launches the REAL packaged app with no dashboard running, so it cold-launches
 * its bundled server. Then drives App menu → Runtime → Use Local Folder… with
 * `dialog.showOpenDialog` stubbed to return this repo checkout, and asserts:
 *   - `/api/health.runtime` reports `origin:"local"` and `gitSha` = HEAD;
 *   - after a server-source edit + `POST /api/restart`, the restarted server
 *     runs the edited checkout code (a marker line lands in server.log).
 *
 * The checkout must be installed and its client built (`packages/client/dist`),
 * which the Electron package step provides in CI. `/api/restart` under
 * Electron is respawned by the app (exit code 75), so origin stays `local`. The edited file is restored
 * in `finally`.
 *
 * See change: electron-runtime-overlay-updates.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ElectronApplication } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { isPortInUse, launchElectron, makeThrowawayHome, REPO_ROOT, resolvePackagedBinary } from "./electron-lifecycle.js";

const PORT = Number(process.env.PW_ELECTRON_LOCAL_LINK_PORT ?? 18_950);
const CLI = path.join(REPO_ROOT, "packages", "server", "src", "cli.ts");

interface RuntimeHealth {
  origin?: string;
  id?: string;
  gitSha?: string | null;
}

async function runtimeHealth(): Promise<{ pid?: number; runtime?: RuntimeHealth } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok ? ((await res.json()) as { pid?: number; runtime?: RuntimeHealth }) : null;
  } catch {
    return null;
  }
}

/** Click a menu item by label anywhere in the application menu (the native menu can't be clicked). */
async function clickAppMenu(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate(({ Menu }, wanted) => {
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const i of items) {
        if (i.label === wanted) return i;
        const sub = i.submenu ? find(i.submenu.items) : undefined;
        if (sub) return sub;
      }
      return undefined;
    };
    const item = find(Menu.getApplicationMenu()?.items ?? []);
    if (!item) throw new Error(`menu item not found: ${wanted}`);
    item.click();
  }, label);
}

/**
 * The app's own bundled server (`resources/server/…/cli.ts`). CI's electron-e2e
 * job packages with `electron-forge package` only (no `bundle-server`), so that
 * app cannot cold-launch a server; X13 needs a full `npm run electron:build`.
 */
function hasBundledServer(): boolean {
  const bin = resolvePackagedBinary();
  const resources =
    process.platform === "darwin" ? path.resolve(path.dirname(bin), "..", "Resources") : path.join(path.dirname(bin), "resources");
  return fs.existsSync(
    path.join(resources, "server", "node_modules", "@blackbelt-technology", "pi-dashboard-server", "src", "cli.ts"),
  );
}

let app: ElectronApplication | undefined;
let home: string | undefined;

test.beforeAll(async () => {
  test.skip(await isPortInUse(PORT), `port ${PORT} in use`);
  test.skip(!hasBundledServer(), "packaged app has no bundled server (forge package only) — run `npm run electron:build`");
  const ready =
    fs.existsSync(path.join(REPO_ROOT, "packages", "client", "dist", "index.html")) &&
    fs.existsSync(path.join(REPO_ROOT, "node_modules"));
  // In CI the checkout must be linkable; locally, say what's missing instead of failing.
  if (!process.env.CI) test.skip(!ready, "checkout not linkable: run `pnpm install` and `npm run build` first");
  else expect(ready, "checkout must be installed and built for X13").toBe(true);
});

test.afterEach(async () => {
  if (app) {
    // app.close() skips the graceful quit, so stop our server explicitly.
    await fetch(`http://127.0.0.1:${PORT}/api/shutdown`, { method: "POST" }).catch(() => {});
    await app.close().catch(() => {});
    app = undefined;
  }
  if (home) {
    if (process.env.PW_KEEP_HOME) console.log(`[x13] kept HOME ${home}`);
    else fs.rmSync(home, { recursive: true, force: true });
    home = undefined;
  }
});

test("X13: link this checkout from the app menu, then edit + restart runs the edited code", async () => {
  test.setTimeout(600_000);
  home = makeThrowawayHome(PORT);
  app = await launchElectron({ home });
  await app.firstWindow();

  // Cold launch with nothing on PORT → the app's own bundled server.
  await expect.poll(async () => (await runtimeHealth())?.runtime?.origin, { timeout: 90_000 }).toBe("bundled");

  const checkout = fs.realpathSync(REPO_ROOT);
  await app.evaluate(({ dialog }, dir) => {
    const g = globalThis as { __notReady?: number };
    g.__notReady = 0;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
    // /api/health answers before the app finishes its cold launch; until then the
    // menu refuses with "not managed by this app yet". Count those and retry.
    const orig = dialog.showMessageBox.bind(dialog);
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const opts = (args.length === 1 ? args[0] : args[1]) as { message?: string };
      if (opts?.message?.includes("not managed by this app yet")) {
        g.__notReady = (g.__notReady ?? 0) + 1;
        return { response: 0, checkboxChecked: false };
      }
      return (orig as (...a: unknown[]) => Promise<Electron.MessageBoxReturnValue>)(...args);
    }) as typeof dialog.showMessageBox;
  }, checkout);
  const notReady = (): Promise<number> => app!.evaluate(() => (globalThis as { __notReady?: number }).__notReady ?? 0);
  await expect
    .poll(async () => {
      const before = await notReady();
      await clickAppMenu(app!, "Use Local Folder…");
      await new Promise((r) => setTimeout(r, 1_000));
      return (await notReady()) === before; // accepted: no new "not ready" refusal
    }, { timeout: 240_000, intervals: [4_000] })
    .toBe(true);

  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  await expect.poll(async () => (await runtimeHealth())?.runtime?.origin, { timeout: 120_000 }).toBe("local");
  const linked = (await runtimeHealth())?.runtime;
  expect(linked?.id).toBe(`local:${checkout}`);
  expect(linked?.gitSha).toBe(head);

  // Edit the checkout's server code, restart, and see the edit run.
  const marker = `[e2e-local-link] marker ${randomUUID()}`;
  const original = fs.readFileSync(CLI, "utf8");
  try {
    fs.writeFileSync(CLI, `${original}\nconsole.log(${JSON.stringify(marker)});\n`);
    const before = (await runtimeHealth())?.pid;
    await fetch(`http://127.0.0.1:${PORT}/api/restart`, { method: "POST" });
    await expect
      .poll(async () => {
        const h = await runtimeHealth();
        return h?.pid !== undefined && h.pid !== before ? h.runtime?.origin : undefined;
      }, { timeout: 120_000 })
      .toBe("local");
    // The app respawned it (ELECTRON_RESTART_EXIT_CODE) — no recovery/loading page.
    const win = await app.firstWindow();
    expect(win.url()).not.toContain("loading.html");
    const log = path.join(home, ".pi", "dashboard", "server.log");
    await expect.poll(() => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").includes(marker) : false), { timeout: 30_000 }).toBe(true);
  } finally {
    fs.writeFileSync(CLI, original);
  }
});
