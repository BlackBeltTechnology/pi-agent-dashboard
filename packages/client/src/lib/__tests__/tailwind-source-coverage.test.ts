/**
 * `packages/client/src/index.css` carries one `@source` line per client-bearing
 * plugin package whose classes the client must compile. The hermes-memory and
 * kb plugins render token classes (severity pills, focus ring) only through
 * Tailwind arbitrary values, so a missing line silently drops their styles
 * (test-plan #E25).
 *
 * Every package whose manifest declares a `settings-section` claim must have a
 * `@source` line covering the directory of that claim's module (wave 2,
 * test-plan #E32).
 *
 * See change: retro-ux-plugin-settings-forms (design D2 risk),
 * retro-ux-plugin-settings-wave-2 (design D6).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "..", "..", "index.css"), "utf8");
const PACKAGES = join(import.meta.dirname, "..", "..", "..", "..");

/** `@source "../../<x>"` → `<x>` (relative to `packages/`). */
function sourceRoots(text: string): string[] {
  return [...text.matchAll(/^@source\s+"\.\.\/\.\.\/([^"]+)";/gm)].map((m) => m[1].replace(/\/$/, ""));
}

interface Claim {
  slot?: string;
  module?: string;
}

/** Every `settings-section` claim module dir, as `<pkg>/<dir>` relative to `packages/`. */
function settingsSectionDirs(packagesDir: string): { pkg: string; dir: string }[] {
  const out: { pkg: string; dir: string }[] = [];
  for (const pkg of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, pkg, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const claims: Claim[] = manifest["pi-dashboard-plugin"]?.claims ?? [];
    for (const c of claims) {
      if (c.slot !== "settings-section" || !c.module) continue;
      out.push({ pkg, dir: posix.join(pkg, dirname(c.module.replace(/^\.\//, ""))) });
    }
  }
  return out;
}

function uncovered(dirs: { pkg: string; dir: string }[], roots: string[]): string[] {
  return [
    ...new Set(dirs.filter(({ dir }) => !roots.some((r) => dir === r || dir.startsWith(`${r}/`))).map(({ pkg }) => pkg)),
  ];
}

describe("index.css @source coverage (E25)", () => {
  it.each(["hermes-memory-plugin", "kb-plugin"])("has an @source line for %s/src/client", (pkg) => {
    expect(css).toContain(`@source "../../${pkg}/src/client";`);
  });
});

describe("settings-section plugins are covered by @source (wave-2 E32)", () => {
  const dirs = settingsSectionDirs(PACKAGES);

  it("finds the settings-section claims", () => {
    expect(dirs.map((d) => d.pkg)).toEqual(expect.arrayContaining(["quota-plugin", "grammar-plugin", "apple-tools"]));
  });

  it("every settings-section package has a covering @source line", () => {
    expect(uncovered(dirs, sourceRoots(css))).toEqual([]);
  });

  it("names the package when its @source line is removed", () => {
    const without = css.replace('@source "../../quota-plugin/src";', "");
    expect(uncovered(dirs, sourceRoots(without))).toContain("quota-plugin");
  });
});
