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
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_TS = path.resolve(__dirname, "..", "main.ts");

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
