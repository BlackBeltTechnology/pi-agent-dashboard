/**
 * Repo-lint: `packages/server/bin/pi-dashboard.mjs` MUST check
 * `process.argv` for `--version` / `-v` / `version` BEFORE invoking any
 * loader resolution helper. Guards against regression of Bug B.
 *
 * See change: fix-electron-cold-launch-probe-cascade; strip-only-native-ts-loader.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const wrapperPath = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "server",
  "bin",
  "pi-dashboard.mjs",
);

describe("pi-dashboard.mjs — --version short-circuit before the loader (Bug B regression guard)", () => {
  it("checks argv for --version/-v/version BEFORE calling resolveNativeTsLoader()", () => {
    const src = fs.readFileSync(wrapperPath, "utf-8");

    const versionRegex = /process\.argv\[2\]|--version|"version"|"-v"/;
    const loaderRegex = /resolveNativeTsLoader\(/;

    const versionIdx = src.search(versionRegex);
    const loaderIdx = src.search(loaderRegex);

    expect(versionIdx).toBeGreaterThan(-1);
    expect(loaderIdx).toBeGreaterThan(-1);
    expect(versionIdx).toBeLessThan(loaderIdx);

    expect(src).toMatch(/pkg\.version|\.version/);
    expect(src).toMatch(/package\.json/);
  });
});
