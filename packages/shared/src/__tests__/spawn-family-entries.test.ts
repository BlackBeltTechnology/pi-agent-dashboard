/**
 * Tests for `resolvedFamilyEntries` — per-member entry FILES of a resolved
 * runtime's node/npm/npx family (design D3: a family member is an entry
 * file, never a directory-sibling assumption).
 *
 * Real tmp-dir fixtures (no fs mocks): the probe order is observable
 * through which layout wins, matching spawn-runtime.test.ts's touch-helper
 * style.
 *
 * See change: unify-pi-runtime-identity (task 3.3, test-plan E13 npmEntry
 * half; spec managed-node-runtime scenarios "Extension install uses the
 * resolved family" + "Bundled-only machine stays coherent").
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ResolvedRuntime,
  resolvedFamilyEntries,
} from "../platform/spawn-runtime.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "spawn-family-entries-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Touch a file (and parents) so the `existsSync` probe finds it. */
function touch(p: string): string {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, "");
  return p;
}

/** Minimal ResolvedRuntime fixture rooted at a bin dir. */
function runtimeAt(binDir: string, source: ResolvedRuntime["source"] = "system"): ResolvedRuntime {
  return {
    nodeBinary: path.join(binDir, "node"),
    nodeBinDir: binDir,
    version: "v25.0.0",
    abi: 141,
    source,
    rung: "user",
    arm: "npm",
    piFloor: "22.19.0",
    piFloorSource: "fallback",
    identity: null,
    trail: [],
    resolvedAt: new Date().toISOString(),
  };
}

describe("resolvedFamilyEntries (test-plan E13 npmEntry half)", () => {
  it("user nvm-style runtime → npm-cli.js from the lib/ layout", () => {
    // ~/.nvm/versions/node/v25.8.1/bin/node →
    // ../lib/node_modules/npm/bin/npm-cli.js
    const binDir = path.join(tmp, "home", ".nvm", "versions", "node", "v25.8.1", "bin");
    touch(path.join(binDir, "node"));
    const npmCli = touch(
      path.join(binDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    );

    const entries = resolvedFamilyEntries(runtimeAt(binDir));

    expect(entries.nodeEntry).toBe(path.join(binDir, "node"));
    expect(entries.npmEntry).toBe(npmCli);
  });

  it("bundled-electron runtime → POSIX bundle layout entry", () => {
    // <resources>/node/bin/node → <resources>/node/lib/node_modules/npm/bin/npm-cli.js
    const binDir = path.join(tmp, "resources", "node", "bin");
    touch(path.join(binDir, "node"));
    const npmCli = touch(
      path.join(binDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    );

    const entries = resolvedFamilyEntries(
      runtimeAt(binDir, "bundled-electron"),
    );

    // Spec scenario "Bundled-only machine stays coherent": the bundled npm
    // is the family member, so install and load agree.
    expect(entries.npmEntry).toBe(npmCli);
    // POSIX bundle ships no npx → npxEntry stays undefined.
    expect(entries.npxEntry).toBeUndefined();
  });

  it("Windows layout (platform win32) → node_modules/ beside the node dir", () => {
    // <resources>/node/node.exe → <resources>/node/node_modules/npm/bin/npm-cli.js
    const nodeDir = path.join(tmp, "resources", "node");
    touch(path.join(nodeDir, "node.exe"));
    const npmCli = touch(
      path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    );

    const rt = { ...runtimeAt(nodeDir), nodeBinary: path.join(nodeDir, "node.exe") };
    const entries = resolvedFamilyEntries(rt, { platform: "win32" });

    expect(entries.npmEntry).toBe(npmCli);
  });

  it("lib/ layout outranks the sibling layout when both exist", () => {
    const binDir = path.join(tmp, "bin");
    const libCli = touch(
      path.join(binDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    );
    touch(path.join(binDir, "npm-cli.js"));

    expect(resolvedFamilyEntries(runtimeAt(binDir)).npmEntry).toBe(libCli);
  });

  it("missing npm-cli.js files → bin-dir shim fallback", () => {
    const binDir = path.join(tmp, "bin");
    touch(path.join(binDir, "node"));

    const entries = resolvedFamilyEntries(runtimeAt(binDir));
    expect(entries.npmEntry).toBe(path.join(binDir, "npm"));
    // No npx-cli.js and no npx shim → npxEntry undefined.
    expect(entries.npxEntry).toBeUndefined();

    const winEntries = resolvedFamilyEntries(runtimeAt(binDir), { platform: "win32" });
    expect(winEntries.npmEntry).toBe(path.join(binDir, "npm.cmd"));
  });

  it("npx entry resolves via npx-cli.js, then via an existing shim", () => {
    const binDir = path.join(tmp, "bin");
    const npxCli = touch(
      path.join(binDir, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
    );
    touch(path.join(binDir, "npx"));

    expect(resolvedFamilyEntries(runtimeAt(binDir)).npxEntry).toBe(npxCli);

    // Without npx-cli.js, the existing bin-dir shim wins.
    rmSync(path.dirname(npxCli), { recursive: true, force: true });
    expect(resolvedFamilyEntries(runtimeAt(binDir)).npxEntry).toBe(path.join(binDir, "npx"));
  });
});
