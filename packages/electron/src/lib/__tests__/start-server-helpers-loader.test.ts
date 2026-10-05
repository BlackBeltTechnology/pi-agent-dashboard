/**
 * Repo-lint: the manual launch helpers `start-server.{sh,cmd,ps1}` default to
 * the bundled Node-native TypeScript loader at its fixed bundle-layout path,
 * and switch to jiti only on `PI_DASHBOARD_TS_LOADER=jiti`. Shell scripts
 * cannot resolve packages, so the path is pinned here, together with the
 * shared package actually shipping the file (`files` keeps `src/`).
 * Harness pattern: `packages/shared/src/__tests__/jiti-packages-parity.test.ts`.
 *
 * See change: fix-appimage-cold-boot-latency (test-plan E22, design D2).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..", "..");
const HELPERS = path.join(REPO_ROOT, "packages/electron/scripts/server-launch-helpers");
const NATIVE_REL = "node_modules/@blackbelt-technology/pi-dashboard-shared/src/platform/native-ts-register.mjs";
const JITI_REL = "node_modules/jiti/lib/jiti-register.mjs";

const read = (f: string) => readFileSync(path.join(HELPERS, f), "utf-8");
const fwd = (s: string) => s.replace(/\\/g, "/");

describe("start-server helpers default to the native TS loader (E22)", () => {
  it.each(["start-server.sh", "start-server.cmd", "start-server.ps1"])("%s references the native register path and gates jiti on the env var", (file) => {
    const text = fwd(read(file));
    expect(text).toContain(NATIVE_REL);
    expect(text).toContain(JITI_REL);
    expect(text).toContain("PI_DASHBOARD_TS_LOADER");
    // The jiti path appears only after (inside) a `== jiti` comparison branch.
    const jitiCmp = text.search(/PI_DASHBOARD_TS_LOADER[^\n]*jiti/);
    expect(jitiCmp).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(JITI_REL)).toBeGreaterThan(jitiCmp);
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
