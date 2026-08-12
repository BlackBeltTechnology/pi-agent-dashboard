/**
 * Knip entry-point rooting (test-plan #G1, #G2, #G4, #D1, #P2).
 *
 * These are the assertions that stop the config regressing to the state the
 * spike measured it in: with no rooting, Knip reported 723 findings and 90
 * unused files, most of them live code. The rooted graph reports 437 and 10.
 *
 * Set-based over every workspace, not a sampled subset — a plugin added
 * tomorrow is covered here with no edit.
 *
 * See change: add-knip-dead-code-oracle.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveEntries, missingEntries, normalizeEntry, owningWorkspace, readWorkspacePackages } from "../knip-config.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const readJson = (p) => JSON.parse(readFileSync(join(REPO_ROOT, p), "utf8"));
const config = readJson("knip.json");
const packages = readWorkspacePackages(REPO_ROOT);

describe("deriveEntries", () => {
  it("#G1 derives every pi-dashboard-plugin client/server/bridge path", () => {
    const entries = deriveEntries({
      "pi-dashboard-plugin": { client: "src/client/index.tsx", server: "src/server/index.ts", bridge: "src/bridge/index.ts" },
    });
    expect(entries).toEqual(["src/client/index.tsx", "src/server/index.ts", "src/bridge/index.ts"]);
  });

  it("#G2 derives pi.extensions paths", () => {
    expect(deriveEntries({ pi: { extensions: ["src/bridge.ts"] } })).toEqual(["src/bridge.ts"]);
  });

  it("ignores bin/main/exports, which Knip reads natively", () => {
    // Demanding an explicit entry for these reports gaps that are not gaps:
    // packages/kb's src/cli.ts is rooted via `bin` and is correctly absent
    // from the unused-files list.
    expect(deriveEntries({ bin: { foo: "src/cli.ts" }, main: "dist/index.js" })).toEqual([]);
  });

  it("maps built output back to source", () => {
    expect(normalizeEntry("dist/index.js")).toBe("src/index.ts");
    expect(normalizeEntry(".vite/build/main.js")).toBe("src/main.ts");
  });
});

describe("owningWorkspace", () => {
  it("attributes a root-declared path to the workspace that roots it", () => {
    // The ROOT manifest declares pi.extensions -> packages/extension/src/bridge.ts,
    // which the packages/extension workspace roots, not the root workspace.
    expect(owningWorkspace(config, "packages/extension/src/bridge.ts")).toBe("packages/extension");
  });

  it("falls back to the root workspace for an unowned path", () => {
    expect(owningWorkspace(config, "scripts/knip-config.mjs")).toBe(".");
  });
});

describe("the committed knip.json", () => {
  it("#G1/#G2 roots every manifest-declared entry in the real workspace", () => {
    expect(missingEntries(config, packages)).toEqual([]);
  });

  it("#G4 fails when a declared plugin entry is absent from the config", () => {
    const broken = structuredClone(config);
    broken.workspaces["packages/flows-plugin"].entry = broken.workspaces["packages/flows-plugin"].entry.filter(
      (e) => !e.includes("bridge"),
    );
    const missing = missingEntries(broken, packages);
    expect(missing).toContainEqual({ workspace: "packages/flows-plugin", entry: "src/bridge/index.ts" });
  });

  it("#G4 names the package and the missing entry", () => {
    const missing = missingEntries({ workspaces: {} }, [
      { dir: "packages/new-plugin", pkg: { "pi-dashboard-plugin": { bridge: "src/bridge/index.ts" } } },
    ]);
    expect(missing).toEqual([{ workspace: ".", entry: "packages/new-plugin/src/bridge/index.ts" }]);
  });

  it("#G5 treats shell-invoked scripts as entries", () => {
    // scripts/ab-context/*.mjs are run by finish.sh, and
    // scripts/lib/smoke-spawn-session.mjs by test-standalone-npm-install-docker.sh.
    // Knip cannot see a shell edge, so without this they read as dead.
    expect(config.workspaces["."].entry).toContain("scripts/**/*.{mjs,cjs,ts}");
  });

  it("#D1 disables every dependency class, deferring to Biome", () => {
    // biome.json's noUndeclaredDependencies is the single owning engine.
    for (const cls of ["unlisted", "binaries", "dependencies", "devDependencies", "optionalPeerDependencies"]) {
      expect(config.rules[cls], `${cls} must defer to Biome`).toBe("off");
    }
  });

  it("#D1 records the owning engine in the config comment", () => {
    expect(readFileSync(join(REPO_ROOT, "scripts/knip-ratchet.mjs"), "utf8")).toMatch(/noUndeclaredDependencies/);
  });
});

describe("#P2 the per-change loop", () => {
  it("never reaches Knip", () => {
    const pkg = readJson("package.json");
    const chain = new Set();
    const walk = (name, depth = 0) => {
      const body = pkg.scripts?.[name];
      if (!body || depth > 6) return;
      chain.add(body);
      for (const m of body.matchAll(/(?:npm|pnpm) run ([\w:-]+)/g)) walk(m[1], depth + 1);
    };
    walk("quality:changed");
    expect(chain.size).toBeGreaterThan(0);
    for (const body of chain) expect(body).not.toMatch(/\bknip\b/);
  });
});
