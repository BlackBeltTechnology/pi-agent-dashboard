/**
 * Tailwind `@source` coverage for plugin client code.
 *
 * Plugin `@source` lines are generated from the plugin manifests into
 * `packages/client/src/generated/plugin-sources.css` (committed, like
 * `plugin-registry.tsx`); `index.css` imports it and names no plugin directory.
 * This test asserts against the manifest-derived set (client entry dirs and every
 * claim `module` dir, including ones outside `src/client`) and fails when the
 * committed file differs from a fresh generation.
 *
 * test-plan #E13 (per-plugin lines), #E14 (index.css lists no plugin dir; file is
 * tracked and its import resolves), #X2 (missing directive names the package), and
 * the earlier #E25 (hermes-memory/kb) and wave-2 #E32 (settings-section) guards.
 *
 * See change: decouple-plugins-from-core (tasks 2.11, 8.20-8.22),
 * retro-ux-plugin-settings-forms (design D2 risk),
 * retro-ux-plugin-settings-wave-2 (design D6).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generatePluginSourcesContent } from "../../../../dashboard-plugin-runtime/src/vite-plugin/index.js";

const CLIENT_SRC = join(import.meta.dirname, "..", "..");
const PACKAGES = join(CLIENT_SRC, "..", "..");
const REPO_ROOT = join(PACKAGES, "..");
const GENERATED_DIR = join(CLIENT_SRC, "generated");
const COMMITTED = readFileSync(join(GENERATED_DIR, "plugin-sources.css"), "utf8");
const INDEX_CSS = readFileSync(join(CLIENT_SRC, "index.css"), "utf8");

/** `@source "../../../<x>"` (relative to `generated/`) → `<x>` (relative to `packages/`). */
function sourceRoots(text: string): string[] {
  return [...text.matchAll(/^@source\s+"\.\.\/\.\.\/\.\.\/([^"]+)";/gm)].map((m) => m[1].replace(/\/$/, ""));
}

interface Claim {
  slot?: string;
  module?: string;
}

interface Dir {
  pkg: string;
  dir: string;
}

/** Client entry dirs and claim `module` dirs per plugin, as `<pkg>/<dir>` relative to `packages/`. */
function manifestDirs(packagesDir: string, only?: (c: Claim) => boolean): { clientDirs: Dir[]; claimDirs: Dir[] } {
  const clientDirs: Dir[] = [];
  const claimDirs: Dir[] = [];
  for (const pkg of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, pkg, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))["pi-dashboard-plugin"];
    if (!manifest) continue;
    if (manifest.client) {
      clientDirs.push({ pkg, dir: posix.join(pkg, dirname(String(manifest.client).replace(/^\.\//, ""))) });
    }
    for (const c of (manifest.claims ?? []) as Claim[]) {
      if (!c.module || (only && !only(c))) continue;
      claimDirs.push({ pkg, dir: posix.join(pkg, dirname(c.module.replace(/^\.\//, ""))) });
    }
  }
  return { clientDirs, claimDirs };
}

function uncovered(dirs: Dir[], roots: string[]): string[] {
  return [
    ...new Set(dirs.filter(({ dir }) => !roots.some((r) => dir === r || dir.startsWith(`${r}/`))).map(({ pkg }) => pkg)),
  ];
}

describe("generated plugin-sources.css (E13)", () => {
  const roots = sourceRoots(COMMITTED);

  it("matches a fresh generation from the manifests", () => {
    expect(COMMITTED).toBe(generatePluginSourcesContent(REPO_ROOT));
  });

  it("lists lines sorted", () => {
    expect(roots).toEqual([...roots].sort());
  });

  it.each(["goal-plugin", "automation-plugin"])("%s is covered by its src/client line", (pkg) => {
    expect(roots).toContain(`${pkg}/src/client`);
  });

  it.each(["grammar-plugin", "quota-plugin", "roles-plugin", "demo-plugin"])(
    "%s (client code directly under src/) is covered by its src line",
    (pkg) => {
      expect(roots).toContain(`${pkg}/src`);
    },
  );

  it.each([
    "apple-tools",
    "blackhole-plugin",
    "browser-plugin",
    "chat-gateway",
    "cost-estimator",
    "roles-plugin",
    "demo-plugin",
  ])("previously missing plugin %s is covered", (pkg) => {
    expect(roots.some((r) => r === pkg || r.startsWith(`${pkg}/`))).toBe(true);
  });

  it("every emitted @source directory exists", () => {
    for (const line of COMMITTED.matchAll(/^@source\s+"([^"]+)";/gm)) {
      expect(existsSync(resolve(GENERATED_DIR, line[1])), line[1]).toBe(true);
    }
  });

  it.each(["hermes-memory-plugin", "kb-plugin"])("has an @source line for %s/src/client (E25)", (pkg) => {
    expect(COMMITTED).toContain(`@source "../../../${pkg}/src/client";`);
  });
});

describe("every manifest client entry and claim module dir is covered (E32)", () => {
  const { clientDirs, claimDirs } = manifestDirs(PACKAGES);
  const roots = sourceRoots(COMMITTED);

  it("finds the client-bearing plugins and their claim modules", () => {
    expect(clientDirs.map((d) => d.pkg)).toEqual(expect.arrayContaining(["goal-plugin", "quota-plugin", "demo-plugin"]));
    expect(claimDirs.map((d) => d.pkg)).toEqual(expect.arrayContaining(["quota-plugin", "grammar-plugin", "apple-tools"]));
  });

  it("every client entry dir is covered by a generated @source line", () => {
    expect(uncovered(clientDirs, roots)).toEqual([]);
  });

  it("every claim module dir (including outside src/client) is covered by a generated @source line", () => {
    expect(uncovered(claimDirs, roots)).toEqual([]);
  });
});

describe("a missing directive names the package (X2)", () => {
  const { claimDirs } = manifestDirs(PACKAGES, (c) => c.slot === "settings-section");

  it("finds settings-section claims", () => {
    expect(claimDirs.length).toBeGreaterThan(0);
  });

  it("names quota-plugin when its line is removed from the generated file", () => {
    const without = COMMITTED.replace('@source "../../../quota-plugin/src";', "");
    expect(uncovered(claimDirs, sourceRoots(without))).toContain("quota-plugin");
  });

  it("names the package of a settings-section claim outside every emitted dir", () => {
    const tmp = [{ pkg: "tmp-plugin", dir: "tmp-plugin/src/panels" }];
    expect(uncovered(tmp, sourceRoots(COMMITTED))).toEqual(["tmp-plugin"]);
  });
});

describe("index.css imports the generated file (E14)", () => {
  it("imports ./generated/plugin-sources.css", () => {
    expect(INDEX_CSS).toContain('@import "./generated/plugin-sources.css";');
  });

  it("names no plugin package in an @source directive and keeps the non-plugin lines", () => {
    const sources = [...INDEX_CSS.matchAll(/^@source\s+"([^"]+)";/gm)].map((m) => m[1]);
    expect(sources).toEqual(["../../client-utils/src", "../../dashboard-plugin-runtime/src"]);
    const pluginPkgs = manifestDirs(PACKAGES).clientDirs.map((d) => d.pkg);
    for (const s of sources) {
      expect(pluginPkgs.some((p) => s.includes(`/${p}/`))).toBe(false);
    }
  });

  it("the import resolves to an existing file", () => {
    expect(existsSync(resolve(CLIENT_SRC, "generated/plugin-sources.css"))).toBe(true);
  });

  it("generated/.gitignore un-ignores plugin-sources.css and git tracks it (fresh checkout resolves the import)", () => {
    expect(readFileSync(join(GENERATED_DIR, ".gitignore"), "utf8")).toContain("!plugin-sources.css");
    const tracked = execFileSync("git", ["ls-files", "--", "packages/client/src/generated/plugin-sources.css"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(tracked.trim()).toBe("packages/client/src/generated/plugin-sources.css");
  });
});
