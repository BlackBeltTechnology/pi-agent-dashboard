/**
 * Pin the Windows-only `appVersion` override in `forge.config.ts`.
 *
 * Background: @electron/packager's `dist/win32.js` wires the PE
 * VERSIONINFO fields like this:
 *
 *   productVersion: this.opts.appVersion              // ← no override path
 *   fileVersion:    this.opts.buildVersion || appVersion
 *
 * Both run through `parseVersionString`, which requires
 * MAJOR.MINOR.BUILD[.REVISION] integer components and rejects SemVer
 * prereleases like the slug ci-electron.yml produces. Setting
 * `packagerConfig.buildVersion` alone only fixes FileVersion;
 * ProductVersion still throws on the SemVer slug because the only
 * source path is `opts.appVersion`.
 *
 * The fix in forge.config.ts:
 *   ...(isWindowsBuildHost ? { appVersion: buildVersion } : {}),
 *
 * This test parses forge.config.ts as text (the file evaluates env
 * + process.platform at import time, so we keep this textual-pin
 * pattern consistent with the existing forge-config-dmg-naming
 * test). The regex must continue to match so a future refactor
 * doesn't silently drop the Windows override.
 *
 * See change: fix-ci-electron-windows-resedit.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FORGE_CONFIG_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "forge.config.ts",
);

/**
 * @structural-pin forge.config.ts evaluates env at load and needs packager internals; the Windows appVersion override is pinned in its text
 */
describe("forge.config.ts Windows VERSIONINFO override", () => {
  const source = fs.readFileSync(FORGE_CONFIG_PATH, "utf8");

  it("imports deriveWindowsBuildVersion from src/lib/build-version.js", () => {
    expect(source).toMatch(
      /import\s+\{\s*deriveWindowsBuildVersion\s*\}\s+from\s+["']\.\/src\/lib\/build-version\.js["']/,
    );
  });

  it("computes buildVersion from pkgVersion + GITHUB_RUN_NUMBER", () => {
    // Trailing comma after the last arg is allowed (matches the
    // multi-line, comma-suffixed Prettier style of the actual call).
    expect(source).toMatch(
      /deriveWindowsBuildVersion\s*\(\s*pkgVersion\s*,\s*process\.env\.GITHUB_RUN_NUMBER\s*,?\s*\)/,
    );
  });

  it("declares isWindowsBuildHost from process.platform === 'win32'", () => {
    expect(source).toMatch(
      /isWindowsBuildHost\s*=\s*process\.platform\s*===\s*["']win32["']/,
    );
  });

  it("sets packagerConfig.buildVersion unconditionally", () => {
    // Match `buildVersion,` inside packagerConfig (shorthand for buildVersion: buildVersion).
    expect(source).toMatch(/^\s*buildVersion\s*,/m);
  });

  it("sets packagerConfig.appVersion only on Windows build host", () => {
    expect(source).toMatch(
      /\.\.\.\s*\(\s*isWindowsBuildHost\s*\?\s*\{\s*appVersion\s*:\s*buildVersion\s*\}\s*:\s*\{\}\s*\)/,
    );
  });

  it("documents why the override is Windows-only (productVersion has no other escape hatch)", () => {
    // The comment must mention productVersion and the win32.js source
    // so future readers don't undo this without context.
    expect(source).toMatch(/productVersion/i);
    expect(source).toMatch(/win32\.js|VERSIONINFO|parseVersionString/);
  });

  it("sets appCopyright to a BlackBelt-branded string", () => {
    // Without this override, @electron/packager copies the Electron
    // framework's default "Copyright (C) 2015 GitHub, Inc." string into
    // Windows VERSIONINFO `LegalCopyright` and macOS
    // `NSHumanReadableCopyright`. The pin is a regex (year-tolerant) so a
    // future year bump doesn't break the test, but the BlackBelt token
    // must remain.
    expect(source).toMatch(
      /appCopyright\s*:\s*["']Copyright\s+\u00a9\s+\d{4}\s+BlackBelt Technology["']/,
    );
  });
});

/**
 * test-plan E11 (refresh-electron-bundled-components): every macOS floor literal
 * encoded in `forge.config.ts` and `_electron-build.yml` equals
 * `MACOS_FLOOR_MARKETING`. The floor lives in five source sites; moving one
 * without the others lets CI verify a different floor than the plist declares.
 *
 * @structural-pin text of forge.config.ts + _electron-build.yml: the floor literals are source constants
 */
describe("macOS floor literals agree across forge.config.ts and _electron-build.yml (E11)", () => {
  const WORKFLOW_PATH = path.resolve(__dirname, "..", "..", "..", "..", ".github", "workflows", "_electron-build.yml");

  /** Every floor literal, tagged by the site that encodes it. */
  function floorSites(forgeSource: string, workflowText: string): { site: string; value: string }[] {
    const sites: { site: string; value: string }[] = [];
    const add = (site: string, text: string, re: RegExp) => {
      for (const m of text.matchAll(re)) sites.push({ site, value: m[1] });
    };
    add("forge.config.ts LSMinimumSystemVersion", forgeSource, /LSMinimumSystemVersion\s*:\s*["']([\d.]+)["']/g);
    add("workflow MACOSX_DEPLOYMENT_TARGET (GITHUB_ENV)", workflowText, /MACOSX_DEPLOYMENT_TARGET=([\d.]+)/g);
    add("workflow MACOSX_DEPLOYMENT_TARGET (env)", workflowText, /MACOSX_DEPLOYMENT_TARGET:\s*["']([\d.]+)["']/g);
    add("workflow plist equality check", workflowText, /"\$MIN_OS"\s*!=\s*"([\d.]+)"/g);
    add("workflow floor step name", workflowText, /Verify macOS deployment target floor \(([\d.]+)\)/g);
    return sites;
  }

  it("finds all five site kinds in the real sources", async () => {
    const forge = fs.readFileSync(FORGE_CONFIG_PATH, "utf8");
    const wf = fs.readFileSync(WORKFLOW_PATH, "utf8");
    const kinds = new Set(floorSites(forge, wf).map((s) => s.site));
    expect(kinds.size).toBe(5);
  });

  it("every site equals MACOS_FLOOR_MARKETING (13.0)", async () => {
    // @ts-expect-error — plain .mjs module, no type declarations by design.
    const { MACOS_FLOOR_MARKETING } = await import("../../scripts/macos-floor.mjs");
    expect(MACOS_FLOOR_MARKETING).toBe("13.0");
    const forge = fs.readFileSync(FORGE_CONFIG_PATH, "utf8");
    const wf = fs.readFileSync(WORKFLOW_PATH, "utf8");
    const wrong = floorSites(forge, wf).filter((s) => s.value !== MACOS_FLOOR_MARKETING);
    expect(wrong, `sites not at ${MACOS_FLOOR_MARKETING}: ${wrong.map((w) => w.site).join(", ")}`).toEqual([]);
  });

  it("a fixture with one site left at 12.0 fails, naming that site", () => {
    const forge = fs.readFileSync(FORGE_CONFIG_PATH, "utf8");
    const wf = fs.readFileSync(WORKFLOW_PATH, "utf8").replace('MACOSX_DEPLOYMENT_TARGET: "13.0"', 'MACOSX_DEPLOYMENT_TARGET: "12.0"');
    const wrong = floorSites(forge, wf).filter((s) => s.value !== "13.0");
    expect(wrong.map((w) => w.site)).toEqual(["workflow MACOSX_DEPLOYMENT_TARGET (env)"]);
  });
});

/**
 * test-plan E1 (refresh-electron-bundled-components, design D2): both preload Vite
 * configs pin `rollupOptions.output.entryFileNames: "[name].js"`.
 *
 * Forge 8's Vite plugin emits preloads as `[name].cjs`; `main.ts` and
 * `remote-connect-window.ts` load `preload-main.js` / `preload.js` and silently run
 * WITHOUT a preload when the file is missing. The Forge plugin merges the user
 * config last, so the pin wins.
 *
 * @structural-pin preload Vite config text: the emitted filename is a loader contract with main.ts
 */
describe("preload Vite configs pin the .js output filename (E1)", () => {
  const PIN = /rollupOptions\s*:\s*\{[\s\S]*?output\s*:\s*\{[\s\S]*?entryFileNames\s*:\s*["']\[name\]\.js["']/;
  const electronRoot = path.resolve(__dirname, "..", "..");

  it.each(["vite.preload.config.ts", "vite.preload-main.config.ts"])("%s pins entryFileNames", (file) => {
    expect(fs.readFileSync(path.join(electronRoot, file), "utf8")).toMatch(PIN);
  });

  it("a config without the pin fails the assertion (non-vacuous)", () => {
    const unpinned = `export default { build: { rollupOptions: { external: [] } } };`;
    expect(unpinned).not.toMatch(PIN);
    const cjsPinned = `export default { build: { rollupOptions: { output: { entryFileNames: "[name].cjs" } } } };`;
    expect(cjsPinned).not.toMatch(PIN);
  });
});
