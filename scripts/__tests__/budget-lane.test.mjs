/**
 * Budget lane structural check + vitest wrapper (change: stabilize-blocking-test-lanes, design.md D1).
 *
 * `scripts/check-budget-lane.mjs` is the blocking check that keeps `*.budget.test.*` files out of
 * every blocking vitest run and refuses a budget file the nightly lane would not run. This file
 * (a) is the wrapper `npm test` runs on the REAL tree, spawning the check with the lane variable and
 * every `VITEST*` variable removed (E11), and (b) drives the check against fixture mini-workspaces
 * (`--root`) for each failure mode (E6–E8, E10, E12, E13, E9).
 *
 * The lane variable's name is assembled below, never written literally: this file must hold no
 * assignment of it (E4 greps for one), only deletions from an env object.
 *
 * Test-plan: E2–E13, X4 (the `real-tree` blocks need the eight A9 budget files only for their
 * counts; every assertion here is derived from `git ls-files`, so they hold before and after the move).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { driftFindings } from "../check-budget-lane.mjs";
import { scanBudgetFiles } from "../select-affected-tests.mjs";
import { isBudgetFile } from "../test-selection/decide.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CHECK = path.join(repoRoot, "scripts", "check-budget-lane.mjs");
const LANE_VAR = ["RUN", "BUDGET", "TESTS"].join("_");
const VITEST_BIN = path.join(path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");

/** The parent's environment without the lane variable and without any VITEST* variable (we run in a worker). */
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env[LANE_VAR];
  for (const k of Object.keys(env)) if (k.startsWith("VITEST")) delete env[k];
  delete env.GITHUB_ACTIONS;
  return { ...env, ...extra };
}

function runCheck(args = [], env = cleanEnv()) {
  const r = spawnSync(process.execPath, [CHECK, ...args], { cwd: repoRoot, env, encoding: "utf8", timeout: 170_000 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function vitestList(args, env) {
  const r = spawnSync(process.execPath, [VITEST_BIN, "list", "--filesOnly", ...args], { cwd: repoRoot, env, encoding: "utf8", timeout: 170_000, maxBuffer: 64 * 1024 * 1024 });
  const files = r.stdout
    .split("\n")
    .map((l) => l.trim().replace(/^\[[^\]]*\]\s+/, ""))
    .filter((l) => l && !/\s/.test(l));
  return { status: r.status, files };
}

const trackedBudgetFiles = () =>
  execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter((f) => f && isBudgetFile(f) && fs.existsSync(path.join(repoRoot, f)))
    .sort();

describe("real tree: the budget lane is off in every blocking run", () => {
  it("E2: with the lane variable unset, neither command `npm test` runs lists a budget file", () => {
    for (const [args, minimum] of [[[], 1000], [["--config", "packages/server/vitest.real-process.config.ts"], 1]]) {
      const { status, files } = vitestList(args, cleanEnv());
      expect(status, `vitest list ${args.join(" ")}`).toBe(0);
      expect(files.length).toBeGreaterThanOrEqual(minimum);
      expect(files.filter((f) => /\.budget\.test\./.test(f))).toEqual([]);
    }
  }, 180_000);

  it("E3: with the lane on, `vitest list --filesOnly .budget.test.` lists exactly the tracked budget files", () => {
    const { status, files } = vitestList([".budget.test."], cleanEnv({ [LANE_VAR]: "1" }));
    expect(status).toBe(0);
    expect(files.every((f) => /\.budget\.test\./.test(f))).toBe(true);
    expect([...new Set(files)].sort()).toEqual(trackedBudgetFiles());
  }, 120_000);
});

describe("lane variable is assigned in exactly one place (E4)", () => {
  const ASSIGN = new RegExp(`${LANE_VAR}["']?\\s*(?:=(?!=)|:)`);
  const walk = (dir, accept, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, accept, out);
      else if (accept(e.name)) out.push(p);
    }
    return out;
  };
  const rel = (p) => path.relative(repoRoot, p).split(path.sep).join("/");
  /** Lines that assign the variable; YAML/JS comment-only lines are prose, not assignments. */
  const assignments = (file) =>
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l) && ASSIGN.test(l));

  it("only the test:budget script in package.json assigns it", () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts;
    expect(Object.entries(scripts).filter(([, cmd]) => ASSIGN.test(cmd)).map(([name]) => name)).toEqual(["test:budget"]);
    expect(scripts["test:budget"]).toMatch(new RegExp(`^${LANE_VAR}=1 `));
  });

  it("no vitest config, workflow, script or selector file assigns it", () => {
    const packagesDir = path.join(repoRoot, "packages");
    const configs = [
      ...fs.readdirSync(repoRoot).filter((f) => /^vitest[^/]*\.(ts|mjs)$/.test(f)).map((f) => path.join(repoRoot, f)),
      ...fs.readdirSync(packagesDir).flatMap((pkg) =>
        fs
          .readdirSync(path.join(packagesDir, pkg))
          .filter((f) => /^vitest[^/]*\.(ts|mjs)$/.test(f))
          .map((f) => path.join(packagesDir, pkg, f)),
      ),
    ];
    const workflows = walk(path.join(repoRoot, ".github", "workflows"), (n) => /\.ya?ml$/.test(n));
    // scripts/__tests__ is skipped by `walk`: test sources quote the variable as data, they run nowhere in CI.
    const scripts = walk(path.join(repoRoot, "scripts"), (n) => n.endsWith(".mjs"));
    const offenders = [...configs, ...workflows, ...scripts].filter((f) => assignments(f).length > 0).map(rel);
    expect(offenders).toEqual([]);
    for (const required of ["scripts/select-affected-tests.mjs", "scripts/test-selection/decide.mjs", ".github/workflows/ci.yml", ".github/workflows/publish.yml"]) {
      expect(fs.existsSync(path.join(repoRoot, required)), `${required} is scanned`).toBe(true);
    }
  });

  it("the check and this wrapper hold no assignment; the check deletes it from its own and its children's env", () => {
    for (const f of ["scripts/check-budget-lane.mjs", "scripts/__tests__/budget-lane.test.mjs"]) {
      expect(assignments(path.join(repoRoot, f)), f).toEqual([]);
    }
    const checkSrc = fs.readFileSync(CHECK, "utf8");
    expect(checkSrc).toContain(`delete process.env.${LANE_VAR}`);
    expect(checkSrc).toContain(`delete env.${LANE_VAR}`);
  });
});

describe("check-budget-lane.mjs on the real tree", () => {
  it("E11 wrapper: with the lane and every VITEST* variable removed the check exits 0", () => {
    const { status, out } = runCheck();
    expect(out).toMatch(/budget-lane finding\(s\)/);
    expect(status, out).toBe(0);
  }, 180_000);

  it("E5: a parent shell exporting the lane variable changes nothing (it is removed before both `vitest list` calls)", () => {
    const { status, out } = runCheck([], { ...cleanEnv(), [LANE_VAR]: "1" });
    expect(status, out).toBe(0);
    expect(out).not.toMatch(/\.budget\.test\./);
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------
// Fixture mini-workspaces
// ---------------------------------------------------------------------------------------------

const fixtureDirs = [];
afterAll(() => {
  for (const d of fixtureDirs) fs.rmSync(d, { recursive: true, force: true });
  try {
    fs.rmdirSync(FIXTURE_BASE); // only when empty: a concurrent run may own another workspace
  } catch {
    /* not empty or already gone */
  }
});

const WORKERS_COPY = fs.readFileSync(path.join(repoRoot, "vitest.workers.ts"), "utf8");
const TEST_SRC = 'import { it } from "vitest";\nit("passes", () => {});\n';

/** A project config that spreads the lane exclusion exactly like the real ones. */
const withSpread = (include, extraExclude = "") => `import { configDefaults, defineConfig } from "vitest/config";
import { BUDGET_TEST_EXCLUDE } from "../../vitest.workers";
export default defineConfig({ test: { include: ${JSON.stringify(include)}, exclude: [...configDefaults.exclude${extraExclude}, ...BUDGET_TEST_EXCLUDE] } });
`;
const withoutSpread = (include) => `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ${JSON.stringify(include)} } });
`;

/**
 * Fixtures live in the gitignored install cache, not `os.tmpdir()`: on macOS `vitest list` under
 * `/var/folders/...` takes ~23 s per call (observed), here ~0.15 s.
 */
const FIXTURE_BASE = path.join(repoRoot, "node_modules", ".cache", "budget-lane-fixtures");

/**
 * Build a git-initialised mini workspace under FIXTURE_BASE. `files` maps relative path → content;
 * `untracked` lists paths left out of the index. node_modules is a symlink to this checkout's install.
 */
function makeFixture(files, { untracked = [], projects = ["packages/*/vitest.config.ts"] } = {}) {
  fs.mkdirSync(FIXTURE_BASE, { recursive: true });
  const root = fs.realpathSync(fs.mkdtempSync(path.join(FIXTURE_BASE, "ws-")));
  fixtureDirs.push(root);
  const all = {
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { projects: ${JSON.stringify(projects)} } });\n`,
    "vitest.workers.ts": WORKERS_COPY,
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(root, "node_modules"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
  git("add", "-A");
  for (const u of untracked) git("rm", "-q", "--cached", u);
  return root;
}

const check = (root, env = cleanEnv()) => runCheck(["--root", root], env);

describe("fixture workspaces (--root)", () => {
  const CLIENT_BUDGET = "packages/client/src/__tests__/zz.budget.test.ts";

  it("E6: a budget file collected by a project without the spread fails, naming the file and the root config (part 1)", () => {
    const root = makeFixture({
      "packages/client/vitest.config.ts": withoutSpread(["src/**/__tests__/**/*.test.ts"]),
      [CLIENT_BUDGET]: TEST_SRC,
    });
    const { status, out } = check(root);
    expect(status).toBe(1);
    expect(out).toContain(CLIENT_BUDGET);
    expect(out).toMatch(/root config/);
  }, 180_000);

  it("E7: a tracked budget file outside every project's include fails as 'runs nowhere' (part 2)", () => {
    const root = makeFixture({
      "packages/scripts/vitest.config.ts": withSpread(["__tests__/**/*.test.mjs"]),
      "packages/scripts/zz.budget.test.mjs": TEST_SRC,
    });
    const { status, out } = check(root);
    expect(status).toBe(1);
    expect(out).toContain("packages/scripts/zz.budget.test.mjs");
    expect(out).toMatch(/no lane would run it/);
  }, 180_000);

  it("E8: a budget file listed in a server-like project's real-process list fails; only root-config projects count", () => {
    const BUDGET = "packages/server/src/access/__tests__/ladder-perf.budget.test.ts";
    const listed = "src/access/__tests__/ladder-perf.budget.test.ts";
    const root = makeFixture({
      // Main phase: excludes the real-process list literally AND the budget glob (as the real server config does).
      "packages/server/vitest.config.ts": withSpread(["src/**/__tests__/**/*.test.ts"], `, ${JSON.stringify(listed)}`),
      // The real-process config is not in the root `projects`, so it never counts for lane membership.
      "packages/server/vitest.real-process.config.ts": `import { configDefaults, defineConfig } from "vitest/config";
import { BUDGET_TEST_EXCLUDE } from "../../vitest.workers";
export default defineConfig({ test: { root: __dirname, include: [${JSON.stringify(listed)}], exclude: [...configDefaults.exclude, ...BUDGET_TEST_EXCLUDE] } });
`,
      [BUDGET]: TEST_SRC,
    });
    const { status, out } = check(root);
    expect(status).toBe(1);
    expect(out).toContain(BUDGET);
    expect(out).toMatch(/no lane would run it/);
    // The real-process listing itself is clean: the failure is part 2 only.
    expect(out).not.toMatch(/collected by `vitest list --filesOnly`/);
  }, 180_000);

  it("E10: an UNtracked budget file in a project lacking the spread still fails (part 1) yet is not in budgetFiles", () => {
    const root = makeFixture(
      {
        "packages/client/vitest.config.ts": withoutSpread(["src/**/__tests__/**/*.test.ts"]),
        [CLIENT_BUDGET]: TEST_SRC,
      },
      { untracked: [CLIENT_BUDGET] },
    );
    const { status, out } = check(root);
    expect(status).toBe(1);
    expect(out).toContain(CLIENT_BUDGET);
    expect(scanBudgetFiles(root)).not.toContain(CLIENT_BUDGET);
  }, 180_000);

  it("E12: a `.budget.test.ts.snap` snapshot is not a budget file (owner decision C3)", () => {
    const BASE = "packages/kb-plugin/src/server/__tests__";
    const root = makeFixture({
      "packages/kb-plugin/vitest.config.ts": withSpread(["src/**/__tests__/**/*.test.ts"]),
      [`${BASE}/kb-search-perf.budget.test.ts`]: TEST_SRC,
      [`${BASE}/__snapshots__/kb-search-perf.budget.test.ts.snap`]: "// vitest snapshot\n",
    });
    const snap = `${BASE}/__snapshots__/kb-search-perf.budget.test.ts.snap`;
    expect(isBudgetFile(snap)).toBe(false);
    expect(isBudgetFile(`${BASE}/kb-search-perf.budget.test.ts`)).toBe(true);
    expect(scanBudgetFiles(root)).toEqual([`${BASE}/kb-search-perf.budget.test.ts`]);
    const { status, out } = check(root);
    expect(status, out).toBe(0);
    expect(out).not.toContain(".snap");
  }, 180_000);

  it("X4: a project config that throws makes `vitest list` fail, so the check fails closed with an ::error line", () => {
    const root = makeFixture({
      "packages/client/vitest.config.ts": 'throw new Error("config exploded on import");\n',
      "packages/client/src/__tests__/a.test.ts": TEST_SRC,
    });
    const { status, out } = check(root, cleanEnv({ GITHUB_ACTIONS: "true" }));
    expect(status).toBe(1);
    expect(out).toMatch(/::error::/);
    expect(out).toMatch(/vitest list --filesOnly` failed/);
  }, 180_000);

  it("a compliant fixture (budget file excluded by its project's spread, inside its include) exits 0", () => {
    const root = makeFixture({
      "packages/client/vitest.config.ts": withSpread(["src/**/__tests__/**/*.test.ts"]),
      [CLIENT_BUDGET]: TEST_SRC,
      "packages/client/src/__tests__/a.test.ts": TEST_SRC,
    });
    const { status, out } = check(root);
    expect(status, out).toBe(0);
    expect(out).toMatch(/1 budget file\(s\)/);
  }, 180_000);

  it("GITHUB_ACTIONS prints `::error file=<path>::` for a finding", () => {
    const root = makeFixture({
      "packages/client/vitest.config.ts": withoutSpread(["src/**/__tests__/**/*.test.ts"]),
      [CLIENT_BUDGET]: TEST_SRC,
    });
    const { status, out } = check(root, cleanEnv({ GITHUB_ACTIONS: "true" }));
    expect(status).toBe(1);
    expect(out).toContain(`::error file=${CLIENT_BUDGET}::`);
  }, 180_000);
});

describe("drift comparator (part 3)", () => {
  it("E9: a static-only path is one finding naming it", () => {
    const findings = driftFindings(["a.test.ts", "b.test.ts"], ["a.test.ts"]);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("b.test.ts");
    expect(findings[0].message).toContain("b.test.ts");
  });

  it("a listed-only path is a finding too, and equal sets are clean", () => {
    expect(driftFindings(["a.test.ts"], ["a.test.ts", "c.test.ts"]).map((f) => f.file)).toEqual(["c.test.ts"]);
    expect(driftFindings(["a.test.ts", "b.test.ts"], ["b.test.ts", "a.test.ts"])).toEqual([]);
  });
});
