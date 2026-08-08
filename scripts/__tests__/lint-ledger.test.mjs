/**
 * Ledger guards for the promise-rule ladder (test-plan #E5, #E6).
 *
 * Harness glue mirrors `scripts/__tests__/verify-release-deps-openspec-floor.test.mjs`
 * (drive the exported rule fns directly; the live-Biome case shells out once).
 *
 * See change: cleanup-client-plugin-promises.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  enumerateSites,
  findOrphanSites,
  sitesOwnedBy,
} from "../lint-ledger.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Git-tracked files only.
 *
 * The suite runs in parallel and sibling tests write transient fixtures INTO
 * the source tree — `biome-undeclared-dependencies.test.mjs` drops
 * `packages/shared/src/__oracle_probe__.ts` for the duration of its run. A
 * repo-wide Biome invocation sees whatever happens to be on disk at that
 * instant, so the ledger must be judged against committed source, not the
 * working tree. Without this the assertion is a race, not a ledger check.
 */
let trackedFiles = new Set();
beforeAll(() => {
  const out = execFileSync("git", ["ls-files"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  trackedFiles = new Set(out.split("\n").filter(Boolean));
});

function liveSites(rule) {
  const out = execFileSync(
    "npx",
    ["biome", "lint", `--only=lint/nursery/${rule}`, ".", "--max-diagnostics=20000", "--reporter=json"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
  return enumerateSites(JSON.parse(out)).filter((site) =>
    trackedFiles.has(site.slice(0, site.lastIndexOf(":"))),
  );
}

describe("E5: site enumeration covers every linted extension", () => {
  it("counts what Biome counted, including a .cjs site", () => {
    // The exact shape that produced the historical undercount: a `.cjs` site
    // among `.ts` ones. An extension filter would silently drop it.
    const report = {
      diagnostics: [
        { location: { path: "packages/client/src/App.tsx", start: { line: 10 } } },
        { location: { path: "packages/server/src/rpc-keeper/keeper.cjs", start: { line: 141 } } },
        { location: { path: "scripts/nightly-verdaccio-serve.mjs", start: { line: 70 } } },
      ],
    };

    const sites = enumerateSites(report);

    expect(sites).toHaveLength(report.diagnostics.length);
    expect(sites).toContain("packages/server/src/rpc-keeper/keeper.cjs:141");
  });

  it("an empty report enumerates to zero sites, not a crash", () => {
    expect(enumerateSites({ diagnostics: [] })).toEqual([]);
    expect(enumerateSites({})).toEqual([]);
  });
});

describe("E6: every live diagnostic site is owned by exactly one rung", () => {
  it("flags a site outside every claimed scope as an orphan", () => {
    // `scripts/` IS claimed; a bare repo-root file is not — the class of
    // blocker that made noFloatingPromises ungraduatable.
    expect(findOrphanSites(["scripts/nightly-verdaccio-serve.mjs:70"])).toEqual([]);
    expect(findOrphanSites(["some-root-file.mjs:3"])).toEqual(["some-root-file.mjs:3"]);
  });

  it("no rung claims the same site twice", () => {
    const site = "packages/client/src/App.tsx:1";
    const owners = ["cleanup-client-plugin-promises", "cleanup-async-semantics-server-extension"]
      .filter((c) => sitesOwnedBy([site], c).length > 0);
    expect(owners).toEqual(["cleanup-client-plugin-promises"]);
  });

  it("the live repo has no orphan floating- or misused-promise site", () => {
    for (const rule of ["noFloatingPromises", "noMisusedPromises"]) {
      expect(findOrphanSites(liveSites(rule)), `${rule} orphans`).toEqual([]);
    }
  }, 120_000);

  it("this change's claimed scope is clear of both rules", () => {
    // The graduation assertion for cleanup-client-plugin-promises: its own
    // packages must report zero for both rules. The sibling's remaining sites
    // are not this change's business.
    for (const rule of ["noFloatingPromises", "noMisusedPromises"]) {
      const mine = sitesOwnedBy(liveSites(rule), "cleanup-client-plugin-promises");
      expect(mine, `${rule} still open in this change's scope`).toEqual([]);
    }
  }, 120_000);
});
