/**
 * Collection completeness (change: speed-up-ci-affected-tests, D7).
 *
 * A package whose test files no root vitest project collects never runs in CI:
 * five packages (36 files) sat outside root `projects` unnoticed. The affected
 * selector inherits the same blind spot, because it selects from the projects
 * vitest resolves. This lint fails naming any `packages/*` directory that holds
 * vitest test files and is neither collected by a root project nor listed in
 * `EXCLUDED` with a reason naming the config fact that prevents collection.
 *
 * There is no per-file quarantine: a collected package's red files get fixed,
 * or the whole package is excluded.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
const ROOT_CONFIG = path.join(REPO_ROOT, "vitest.config.ts");

/** Package dir name → reason it cannot be collected by the root runner. */
const EXCLUDED: Record<string, string> = {
  electron:
    "only packages/electron/vitest.build-contract.config.ts runs under the root runner; the rest depend on ambient PATH/mocks never wired up (run via `cd packages/electron && npm test`)",
  "pi-forms-bpmn":
    "no vitest config at the package root; its tests belong to the nested non-workspace npm project .pi/skills/openforms-mui/tools (own package-lock.json, deps installed by a best-effort postinstall)",
};

const SKIP_DIRS = new Set(["node_modules", "dist", "out"]);
const TEST_FILE_RE = /\.test\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function hasTestFile(dir: string): boolean {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (hasTestFile(path.join(dir, entry.name))) return true;
    } else if (TEST_FILE_RE.test(entry.name)) {
      return true;
    }
  }
  return false;
}

/** Root `test.projects` string entries, read from the config source. */
function rootProjects(): string[] {
  const src = fs.readFileSync(ROOT_CONFIG, "utf8");
  const block = src.slice(src.indexOf("projects:"));
  const body = block.slice(block.indexOf("["), block.indexOf("],") + 1);
  return [...body.matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);
}

/** Package dirs a root project collects: `packages/<p>` or `packages/<p>/<config>`. */
function collectedPackages(projects: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of projects) {
    const m = p.match(/^packages\/([^/]+)(?:\/|$)/);
    if (m) out.add(m[1]);
  }
  return out;
}

function findUncollected(
  projects: string[],
  excluded: Record<string, string>,
  packagesDir = path.join(REPO_ROOT, "packages"),
): string[] {
  const collected = collectedPackages(projects);
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !collected.has(name) && !(name in excluded))
    .filter((name) => hasTestFile(path.join(packagesDir, name)))
    .sort();
}

describe("every test-bearing package is collected or excluded with a reason", () => {
  it("no test-bearing package is neither collected nor excluded", () => {
    expect(findUncollected(rootProjects(), EXCLUDED)).toEqual([]);
  });

  it("quota-plugin is among the root projects", () => {
    expect(rootProjects()).toContain("packages/quota-plugin");
  });

  it("removing a collected package from projects names it", () => {
    const without = rootProjects().filter((p) => p !== "packages/quota-plugin");
    expect(findUncollected(without, EXCLUDED)).toEqual(["quota-plugin"]);
  });

  it("every exclusion names a real package and carries a reason", () => {
    for (const [name, reason] of Object.entries(EXCLUDED)) {
      expect(fs.existsSync(path.join(REPO_ROOT, "packages", name)), name).toBe(true);
      expect(reason.length, name).toBeGreaterThan(20);
    }
  });

  it("never reports a package whose only test files sit under node_modules/, dist/ or out/", () => {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "coll-"));
    for (const d of ["node_modules", "dist", "out"]) {
      fs.mkdirSync(path.join(tmp, `only-${d}`, d, "x"), { recursive: true });
      fs.writeFileSync(path.join(tmp, `only-${d}`, d, "x", "a.test.ts"), "");
    }
    fs.mkdirSync(path.join(tmp, "real", "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "real", "src", "a.test.ts"), "");
    expect(findUncollected([], {}, tmp)).toEqual(["real"]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
