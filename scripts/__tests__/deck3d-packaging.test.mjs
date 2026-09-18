// R1 (add-deck3d-presentation-package): packaging completeness of
// @blackbelt-technology/pi-dashboard-deck3d. The proposal contract is a
// "publishable pi package with a deck3d CLI", and the published `bin/deck3d`
// falls back to `dist/cli.js` when `tsx` (a devDependency) is absent — so the
// build must emit it. The tarball must carry the bin shim, the built CLI, the
// source tree and the assets, and never the tests.
//
// Same shape as kb-packaging.test.mjs: a real `npm run build` followed by
// `npm pack --dry-run --json` replicates the publish shape (prepublishOnly
// builds). ci-level, behind RUN_CI_SCENARIOS=1 — a full package build must not
// sit inside the parallel unit suite.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CI_SCENARIOS = process.env.RUN_CI_SCENARIOS === "1";
const PKG = join(import.meta.dirname, "..", "..", "packages", "deck3d");

describe("deck3d packaging completeness (R1)", () => {
  it.skipIf(!CI_SCENARIOS)(
    "build emits a runnable dist/cli.js, and npm pack ships bin + dist + src + assets with no tests",
    () => {
      execFileSync("npm", ["run", "build"], { cwd: PKG, encoding: "utf8" });
      expect(existsSync(join(PKG, "dist", "cli.js")), "dist/cli.js must be built").toBe(true);
      expect(existsSync(join(PKG, "dist", "runtime.js")), "dist/runtime.js must be built").toBe(true);

      // The bundle's own entry guard only fires for a real `node dist/cli.js`
      // invocation, which is exactly how `bin/deck3d` runs it.
      const help = execFileSync("node", [join(PKG, "dist", "cli.js"), "--help"], { cwd: PKG, encoding: "utf8" });
      expect(help).toContain("Usage: deck3d <command>");

      const out = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: PKG, encoding: "utf8" }));
      const files = out[0].files.map((f) => f.path);
      const has = (p) => files.some((f) => f === p);
      expect(has("bin/deck3d"), "bin shim must ship").toBe(true);
      expect(has("dist/cli.js"), "built CLI must ship").toBe(true);
      expect(files.some((f) => f.startsWith("src/")), "src tree must ship").toBe(true);
      expect(files.some((f) => f.startsWith("assets/")), "assets must ship").toBe(true);
      expect(files.some((f) => f.includes("__tests__")), "tests must not ship").toBe(false);
    },
    300_000,
  );
});
