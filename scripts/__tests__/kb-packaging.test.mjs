// C2 (test-plan #C2, ci level — fix-kb-eval-measurement-integrity): packaging
// completeness of @blackbelt-technology/pi-dashboard-kb. The published artifact
// must carry the bin shim, the committed engine fingerprint, the built CLI and
// the source tree — and never the tests. `npm pack --dry-run` after a real
// `npm run build` replicates the publish shape (prepublishOnly builds).
//
// ci-level, behind RUN_CI_SCENARIOS=1 (`npm run test:ci-scenarios`, wired in
// ci.yml) — same starvation rule as the other npm-pack-spawning scenarios:
// ~10s of tsc + tarball CPU must not sit inside the parallel unit suite.
// Exemplar: scripts/verify-published-imports.mjs packaging assertions.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CI_SCENARIOS = process.env.RUN_CI_SCENARIOS === "1";
const PKG = join(import.meta.dirname, "..", "..", "packages", "kb");

describe("kb packaging completeness (C2)", () => {
  it.skipIf(!CI_SCENARIOS)("npm pack carries bin shim + fingerprint + dist CLI + src, and no __tests__", () => {
    execFileSync("npm", ["run", "build"], { cwd: PKG, encoding: "utf8" });
    const out = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: PKG, encoding: "utf8" }));
    const files = out[0].files.map((f) => f.path);
    const has = (p) => files.some((f) => f === p);
    expect(has("bin/kb.mjs"), "bin shim must ship").toBe(true);
    expect(has("bin/lib/engine-fingerprint.mjs"), "the shim's fingerprint lib must ship").toBe(true);
    expect(has("engine-fingerprint.json"), "committed fingerprint must ship").toBe(true);
    expect(has("dist/cli.js"), "built CLI must ship").toBe(true);
    expect(files.some((f) => f.startsWith("src/")), "src tree must ship").toBe(true);
    expect(files.some((f) => f.includes("__tests__")), "tests must not ship").toBe(false);
  });
});
