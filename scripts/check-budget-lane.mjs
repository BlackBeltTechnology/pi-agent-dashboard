#!/usr/bin/env node
/**
 * Blocking budget-lane structural check (change: stabilize-blocking-test-lanes, design.md D1).
 *
 *   node scripts/check-budget-lane.mjs [--root <dir>]
 *
 * A `*.budget.test.*` file runs ONLY in the nightly budget lane
 * (`RUN_BUDGET_TESTS=1`); every vitest config whose project collects one spreads
 * `BUDGET_TEST_EXCLUDE` (vitest.workers.ts) into `test.exclude`. This check closes
 * the hole a config that forgets the spread leaves, from vitest's own collection
 * and resolved configs rather than config text. It exits 1 when:
 *   (1) `vitest list --filesOnly` (root config, and
 *       packages/server/vitest.real-process.config.ts when present) lists a budget file;
 *   (2) a git-tracked budget file is in no root-config project that excludes it with
 *       the budget entry (it would run nowhere: `test:budget` runs the root config only);
 *   (3) that static include/exclude judgement disagrees with vitest's own collection
 *       on the other tracked test files (fail closed on matcher drift).
 * A budget file is a code file only: `x.budget.test.ts.snap` is ignored (owner decision C3).
 *
 * This script never sets RUN_BUDGET_TESTS; it deletes it from its own environment and
 * from every child's. `--root <dir>` points it at a fixture mini-workspace (tests).
 * Under GITHUB_ACTIONS each finding is also printed as `::error file=<path>::`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isBudgetFile } from "./test-selection/decide.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..");
/** The exclude entry a project must hold for the lane switch to apply (vitest.workers.ts). */
export const BUDGET_EXCLUDE_ENTRY = "**/*.budget.test.*";
const REAL_PROCESS_CONFIG = "packages/server/vitest.real-process.config.ts";
const TEST_NAME_RE = /\.(test|spec)\./;

const posix = (p) => p.split(path.sep).join("/");

/** Environment for a child process: the parent's, without the lane variable. */
function childEnv() {
  const env = { ...process.env };
  delete env.RUN_BUDGET_TESTS;
  return env;
}

/** Git-tracked paths of `root` that still exist on disk (a deleted-but-tracked file is not collected). */
export function trackedFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return out.split("\0").filter((f) => f && fs.existsSync(path.join(root, f)));
}

/** Drift comparator (part 3): static judgement vs vitest's own listing, both as path collections. */
export function driftFindings(staticSet, listedSet) {
  const stat = new Set(staticSet);
  const listed = new Set(listedSet);
  const findings = [];
  for (const file of [...stat].sort()) {
    if (!listed.has(file)) findings.push({ file, message: `static include/exclude judgement selects ${file} but vitest does not collect it (matcher drift)` });
  }
  for (const file of [...listed].sort()) {
    if (!stat.has(file)) findings.push({ file, message: `vitest collects ${file} but the static include/exclude judgement does not select it (matcher drift)` });
  }
  return findings;
}

/** Tracked file in a project's scope? `exclusive` drops the project's budget-entry exclude from the test. */
function matchesProject(project, relToDir, { ignoreBudgetEntry }) {
  if (relToDir.startsWith("../") || relToDir === ".." || path.isAbsolute(relToDir)) return false;
  if (!project.include.some((g) => path.matchesGlob(relToDir, g))) return false;
  return !project.exclude.some((g) => !(ignoreBudgetEntry && g === BUDGET_EXCLUDE_ENTRY) && path.matchesGlob(relToDir, g));
}

/** The vitest CLI entry of THIS checkout's vitest (the fixture workspace has no install of its own). */
function vitestBin() {
  const pkg = createRequire(import.meta.url).resolve("vitest/package.json");
  return path.join(path.dirname(pkg), "vitest.mjs");
}

/** `vitest list --filesOnly` → { files: repo-relative paths, error?: string }. */
function listFiles(root, config) {
  const args = [vitestBin(), "list", "--filesOnly", ...(config ? ["--config", config] : [])];
  const r = spawnSync(process.execPath, args, { cwd: root, env: childEnv(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    const detail = String(r.error?.message ?? `${r.stderr ?? ""}${r.stdout ?? ""}`)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" | ");
    return { files: [], error: `\`vitest list --filesOnly\` failed (${config ?? "root config"}, exit ${r.status ?? "none"}): ${detail}` };
  }
  const files = [];
  for (const raw of r.stdout.split("\n")) {
    const line = raw.trim().replace(/^\[[^\]]*\]\s+/, "");
    if (!line || /\s/.test(line)) continue;
    files.push(posix(path.isAbsolute(line) ? path.relative(root, line) : line));
  }
  return { files };
}

/** Root-config projects as `{ name, dir, include, exclude }`, via an in-process createVitest (as graph.mjs). */
async function loadProjects(root) {
  const { createVitest } = await import("vitest/node");
  const vitest = await createVitest("test", { watch: false, run: false, reporters: [], root });
  try {
    return vitest.projects.map((p) => ({
      name: p.name,
      dir: fs.realpathSync(p.config.dir || p.config.root),
      include: p.config.include ?? [],
      exclude: p.config.exclude ?? [],
    }));
  } finally {
    await vitest.close();
  }
}

/**
 * Run all three parts against `root`.
 * @returns {Promise<{ findings: {file: string|null, message: string}[], checked: {tracked: number, budget: number} }>}
 */
export async function analyzeBudgetLane(root) {
  const findings = [];
  const realRoot = fs.realpathSync(root);
  const tracked = trackedFiles(root);
  const budgetFiles = tracked.filter(isBudgetFile).sort();

  // (1) the commands `npm test` runs must not collect a budget file.
  const listings = [{ label: "root config", config: null }];
  if (fs.existsSync(path.join(root, REAL_PROCESS_CONFIG))) listings.push({ label: REAL_PROCESS_CONFIG, config: REAL_PROCESS_CONFIG });
  let rootListed = null;
  for (const { label, config } of listings) {
    const { files, error } = listFiles(root, config);
    if (error) {
      findings.push({ file: null, message: error });
      continue;
    }
    if (!config) rootListed = files;
    for (const f of files.filter(isBudgetFile)) {
      findings.push({ file: f, message: `${f} is collected by \`vitest list --filesOnly\` (${label}) with RUN_BUDGET_TESTS unset: its project config must spread BUDGET_TEST_EXCLUDE into test.exclude` });
    }
  }

  // (2)+(3) static judgement from the resolved root-config projects.
  let projects;
  try {
    projects = await loadProjects(root);
  } catch (e) {
    findings.push({ file: null, message: `loading the root vitest config failed: ${String(e?.message ?? e).split("\n")[0]}` });
    return { findings, checked: { tracked: tracked.length, budget: budgetFiles.length } };
  }
  const relTo = (project, file) => posix(path.relative(project.dir, path.join(realRoot, file)));
  const budgetProjects = projects.filter((p) => p.exclude.includes(BUDGET_EXCLUDE_ENTRY));
  for (const f of budgetFiles) {
    if (!budgetProjects.some((p) => matchesProject(p, relTo(p, f), { ignoreBudgetEntry: true }))) {
      findings.push({ file: f, message: `${f} is in no root-config vitest project that excludes it with "${BUDGET_EXCLUDE_ENTRY}", so no lane would run it` });
    }
  }
  if (rootListed) {
    const testFiles = tracked.filter((f) => TEST_NAME_RE.test(f) && !isBudgetFile(f));
    const staticSet = testFiles.filter((f) => projects.some((p) => matchesProject(p, relTo(p, f), { ignoreBudgetEntry: false })));
    const trackedSet = new Set(tracked);
    const listedSet = rootListed.filter((f) => trackedSet.has(f) && TEST_NAME_RE.test(f) && !isBudgetFile(f));
    findings.push(...driftFindings(staticSet, listedSet));
  }
  return { findings, checked: { tracked: tracked.length, budget: budgetFiles.length } };
}

function parseArgs(argv) {
  let root = REPO_ROOT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = path.resolve(argv[++i] ?? "");
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return { root };
}

export async function main(argv = process.argv.slice(2)) {
  delete process.env.RUN_BUDGET_TESTS;
  let result;
  try {
    result = await analyzeBudgetLane(parseArgs(argv).root);
  } catch (e) {
    result = { findings: [{ file: null, message: `budget lane check crashed: ${String(e?.message ?? e).split("\n")[0]}` }], checked: { tracked: 0, budget: 0 } };
  }
  const { findings, checked } = result;
  for (const f of findings) {
    console.error(f.message);
    if (process.env.GITHUB_ACTIONS) console.log(`::error${f.file ? ` file=${f.file}` : ""}::${f.message}`);
  }
  const summary = `${checked.budget} budget file(s) of ${checked.tracked} tracked · ${findings.length} budget-lane finding(s)`;
  (findings.length ? console.error : console.log)(`\n${summary}`);
  return findings.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
