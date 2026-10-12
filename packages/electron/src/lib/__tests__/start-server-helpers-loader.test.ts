/**
 * Repo-lint: the manual launch helpers `start-server.{sh,cmd,ps1}`
 * launch with the bundled Node-native TypeScript loader at its fixed
 * bundle-layout path, and only that loader (no jiti fallback, no
 * `PI_DASHBOARD_TS_LOADER` handling). Shell scripts cannot resolve packages,
 * so the path is pinned here, together with the shared package actually
 * shipping the file (`files` keeps `src/`).
 *
 * See changes: fix-appimage-cold-boot-latency (test-plan E22, design D2),
 * strip-only-native-ts-loader.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..", "..");
const HELPERS = path.join(REPO_ROOT, "packages/electron/scripts/server-launch-helpers");
const NATIVE_REL = "node_modules/@blackbelt-technology/pi-dashboard-shared/src/platform/native-ts-register.mjs";

const read = (f: string) => readFileSync(path.join(HELPERS, f), "utf-8");
const fwd = (s: string) => s.replace(/\\/g, "/");

describe("start-server helpers use the native TS loader only (E22)", () => {
  it.each(["start-server.sh", "start-server.cmd", "start-server.ps1"])("%s references the native register path and nothing else", (file) => {
    const text = fwd(read(file));
    expect(text).toContain(NATIVE_REL);
    expect(text).not.toMatch(/jiti/i);
    expect(text).not.toContain("PI_DASHBOARD_TS_LOADER");
  });

  it("README documents only the native loader", () => {
    const text = read("README.md");
    expect(text).toContain("native-ts-register.mjs");
    expect(text).not.toMatch(/jiti-register/);
  });

  it("the referenced native register exists in the shared package and is shipped", () => {
    const sharedRoot = path.join(REPO_ROOT, "packages/shared");
    const rel = NATIVE_REL.replace("node_modules/@blackbelt-technology/pi-dashboard-shared/", "");
    expect(existsSync(path.join(sharedRoot, rel))).toBe(true);
    expect(existsSync(path.join(sharedRoot, "src/platform/native-ts-hooks.mjs"))).toBe(true);
    const pkg = JSON.parse(readFileSync(path.join(sharedRoot, "package.json"), "utf-8")) as { name: string; files: string[] };
    expect(pkg.name).toBe("@blackbelt-technology/pi-dashboard-shared");
    expect(pkg.files).toContain("src/");
    // No negation pattern drops the loader files.
    for (const f of pkg.files.filter((p) => p.startsWith("!"))) {
      expect(f).not.toMatch(/\.mjs|platform/);
    }
  });
});
