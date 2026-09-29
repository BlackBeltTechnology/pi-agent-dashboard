/**
 * The Electron main build (Vite/Rollup) does not resolve a shared `.mjs`
 * subpath through the generic `./*` export (vitest and Node do), so a
 * `pi-dashboard-shared/**.mjs` import in electron src must be covered by an
 * explicit `./*.mjs` export — otherwise `electron-forge make` fails while
 * every test passes. See change: electron-runtime-overlay-updates.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("shared .mjs imports from Electron main are Vite-resolvable", () => {
  it("shared package.json declares `./*.mjs` when electron src imports a shared .mjs", () => {
    const mjsImports = walk(path.join(ROOT, "packages", "electron", "src")).flatMap((f) =>
      [...fs.readFileSync(f, "utf8").matchAll(/from "@blackbelt-technology\/pi-dashboard-shared\/([^"]+\.mjs)"/g)].map((m) => m[1]),
    );
    const exportsMap = JSON.parse(fs.readFileSync(path.join(ROOT, "packages", "shared", "package.json"), "utf8")).exports;
    if (mjsImports.length) expect(exportsMap["./*.mjs"]).toBe("./src/*.mjs");
    for (const sub of mjsImports) {
      expect(fs.existsSync(path.join(ROOT, "packages", "shared", "src", sub as string)), sub).toBe(true);
    }
  });
});
