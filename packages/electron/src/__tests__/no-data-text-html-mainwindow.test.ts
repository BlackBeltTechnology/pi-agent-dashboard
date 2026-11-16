/**
 * Repo-lint: forbid loading a `data:text/html` URL into the main BrowserWindow
 * (`mainWindow`) in `packages/electron/src/main.ts`. The loading page MUST be
 * a real HTML resource so a preload script can attach.
 *
 * `splashWindow` and the legacy `buildLegacyLoadingDataUrl` fallback are
 * exempt — splash is intentionally inline and the legacy fallback only runs
 * if the packaged HTML resource is missing.
 *
 * See change: electron-server-launch-controls (task 5.4).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_TS = path.resolve(__dirname, "..", "main.ts");

/**
 * @structural-pin repo lint on electron main.ts: the loading page must be a real HTML resource so a preload can attach; main.ts imports electron and cannot be loaded
 */
describe("no-data-text-html-mainwindow", () => {
  it("main.ts does not load a data:text/html URL into mainWindow", () => {
    const src = readFileSync(MAIN_TS, "utf-8");
    // Strip line comments to avoid false positives in commentary.
    const stripped = src.replace(/^\s*\/\/.*$/gm, "");
    const lines = stripped.split("\n");
    const offenders: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes("mainWindow")) continue;
      if (!line.includes("loadURL")) continue;
      // Look at this line plus the next 2 for the data: URL.
      const window = lines.slice(i, i + 3).join("\n");
      if (/data:text\/html/.test(window)) {
        offenders.push(`L${i + 1}: ${line.trim()}`);
      }
    }
    expect(offenders, `mainWindow.loadURL("data:text/html…") is forbidden — use loadFile(loading.html)\n${offenders.join("\n")}`).toEqual([]);
  });
});

/**
 * E83: default-session permission policy is installed before any window or the splash.
 * @structural-pin repo lint on electron main.ts: ordering of installDefaultSessionPermissions vs whenReady/showSplash/new BrowserWindow; main.ts imports electron and cannot be loaded
 * See change: close-local-listener-and-egress-gaps (D3).
 */
describe("main.ts installs default-session permissions early", () => {
  it("whenReady < installDefaultSessionPermissions(session.defaultSession, …) < showSplash() and first window", () => {
    const src = readFileSync(MAIN_TS, "utf-8");
    const body = src.indexOf("await app.whenReady()");
    expect(body).toBeGreaterThan(-1);
    const install = src.indexOf("installDefaultSessionPermissions(session.defaultSession,", body);
    expect(install).toBeGreaterThan(body);
    expect(install).toBeLessThan(src.indexOf("showSplash();", body));
    expect(src.slice(body, install)).not.toMatch(/new BrowserWindow\(/);
  });
});
