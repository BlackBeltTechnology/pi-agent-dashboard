/**
 * T-S1 (test-plan #S1): verify-release-deps openspec floor consistency.
 *
 * The single-source governance guard must FAIL when the extension's
 * `@fission-ai/openspec` floor diverges from the server's, and PASS when they
 * match — no root `overrides`, so the two declaration sites are the source of
 * truth. Drives the exported `checkOpenspecFloorConsistency` rule fn directly
 * with package.json fixtures (importing the module must not run the CLI).
 *
 * See change: provision-openspec-cli-in-sessions.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkOpenspecFloorConsistency,
  collectFailures,
  floorOf,
  satisfiesMinVersion,
} from "../verify-release-deps.mjs";

const serverPkg = (range) => ({ dependencies: { "@fission-ai/openspec": range } });
const extPkg = (range) => ({ dependencies: { "@fission-ai/openspec": range } });

describe("checkOpenspecFloorConsistency (T-S1)", () => {
  it("passes when server and extension floors match", () => {
    expect(checkOpenspecFloorConsistency(serverPkg("^1.6.0"), extPkg("^1.6.0"))).toBeNull();
    // caret vs tilde vs exact all floor to 1.6.0 — same floor, no drift.
    expect(checkOpenspecFloorConsistency(serverPkg("^1.6.0"), extPkg("~1.6.0"))).toBeNull();
  });

  it("fails, naming the drifted sites, when the extension floor diverges", () => {
    const err = checkOpenspecFloorConsistency(serverPkg("^1.6.0"), extPkg("^1.4.1"));
    expect(err).toBeTruthy();
    expect(err).toContain("floor drift");
    expect(err).toContain("1.6.0"); // server floor named
    expect(err).toContain("1.4.1"); // extension floor named
  });

  it("fails when a site is missing the dependency entirely", () => {
    expect(checkOpenspecFloorConsistency(serverPkg("^1.6.0"), { dependencies: {} })).toContain(
      "missing",
    );
  });

  it("floorOf strips caret/tilde and prerelease suffixes", () => {
    expect(floorOf("^1.6.0")).toBe("1.6.0");
    expect(floorOf("~1.6.0")).toBe("1.6.0");
    expect(floorOf("1.6.0")).toBe("1.6.0");
    expect(floorOf("*")).toBeNull();
  });
});

/**
 * test-plan #E16 (refresh-electron-bundled-components): the exact openspec pin
 * moves with the single-source version. `1.14.3` passes the release gate; a
 * leftover `1.11.0` declaration is reported as a `Stale pin`.
 *
 * Fixture repo: every file the gates read is copied from the real tree, then
 * the openspec declaration of server + extension is overwritten.
 *
 * See change: refresh-electron-bundled-components.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const CARRIED = [
  "packages/server/package.json",
  "packages/extension/package.json",
  "packages/shared/package.json",
  "packages/client/package.json",
  "docker/Dockerfile",
  "pnpm-workspace.yaml",
];
const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixtureWithOpenspec(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-release-deps-openspec-"));
  tmpDirs.push(root);
  for (const rel of CARRIED) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), dest);
  }
  for (const rel of ["packages/server/package.json", "packages/extension/package.json"]) {
    const dest = path.join(root, rel);
    const pkg = JSON.parse(fs.readFileSync(dest, "utf-8"));
    pkg.dependencies["@fission-ai/openspec"] = version;
    fs.writeFileSync(dest, JSON.stringify(pkg, null, 2));
  }
  return root;
}

describe("openspec exact pin is 1.14.3 (E16)", () => {
  it("passes with server + extension declaring 1.14.3", () => {
    const failures = collectFailures({ repoRoot: fixtureWithOpenspec("1.14.3") });
    expect(failures.filter((f) => f.includes("@fission-ai/openspec"))).toEqual([]);
  });

  it("reports `Stale pin` for @fission-ai/openspec when 1.11.0 is declared", () => {
    const failures = collectFailures({ repoRoot: fixtureWithOpenspec("1.11.0") });
    const stale = failures.filter(
      (f) => f.includes("Stale pin") && f.includes("@fission-ai/openspec"),
    );
    expect(stale.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Prerelease floors (CodeRabbit review on refresh-electron-bundled-components): the
 * node-pty floor is `1.2.0-beta.15`; the old check stripped the prerelease tag from the
 * floor and only looked for `1.2.0`, so the former `beta.13` pin passed.
 */
describe("satisfiesMinVersion — prerelease floors", () => {
  it("rejects an older prerelease of the same core", () => {
    expect(satisfiesMinVersion("1.2.0-beta.13", "1.2.0-beta.15")).toBe(false);
    expect(satisfiesMinVersion("^1.2.0-beta.14", "1.2.0-beta.15")).toBe(false);
  });
  it("accepts the floor, a newer prerelease and the stable release", () => {
    expect(satisfiesMinVersion("1.2.0-beta.15", "1.2.0-beta.15")).toBe(true);
    expect(satisfiesMinVersion("1.2.0-beta.16", "1.2.0-beta.15")).toBe(true);
    expect(satisfiesMinVersion("1.2.0-beta.100", "1.2.0-beta.15")).toBe(true);
    expect(satisfiesMinVersion("^1.2.0", "1.2.0-beta.15")).toBe(true);
  });
  it("keeps the loose substring semantics for a plain floor", () => {
    expect(satisfiesMinVersion("1.14.3", "1.14.3")).toBe(true);
    expect(satisfiesMinVersion("^1.14.3", "1.14.3")).toBe(true);
    expect(satisfiesMinVersion("1.11.0", "1.14.3")).toBe(false);
  });
  it("collectFailures reports the former node-pty beta.13 as a Stale pin", () => {
    const root = fixtureWithOpenspec("1.14.3");
    const serverPath = path.join(root, "packages/server/package.json");
    const pkg = JSON.parse(fs.readFileSync(serverPath, "utf-8"));
    pkg.dependencies["node-pty"] = "1.2.0-beta.13";
    fs.writeFileSync(serverPath, JSON.stringify(pkg, null, 2));
    const stale = collectFailures({ repoRoot: root }).filter((f) => f.includes("Stale pin") && f.includes("node-pty"));
    expect(stale).toHaveLength(1);
  });
});
