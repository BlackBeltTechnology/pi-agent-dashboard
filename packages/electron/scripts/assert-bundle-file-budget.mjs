#!/usr/bin/env node
/**
 * Packaged file-count budget gate.
 *
 * The Windows NSIS install is slow because of how many files it writes (one NTFS
 * create + one Defender scan each), not how many bytes. This counts the regular
 * files of a PACKAGED `resources/` directory and fails when the count exceeds the
 * per-leg budget, so a dependency bump that quietly adds thousands of files is
 * caught on the PR instead of by a user's install time.
 *
 * Counting: regular files only — `Dirent` types, so symlinks are neither counted
 * nor followed. Scope: the WHOLE `resources/` dir (server, plugins, node/, win32
 * git/): drift in the bundled Node or git trees is part of the budget. The NSIS
 * smoke step counts the installed tree with the same predicate.
 *
 * A leg with no pinned budget (and no `--budget`) reports the count and passes.
 *
 * Usage: node assert-bundle-file-budget.mjs <resourcesDir> --platform <p> --arch <a> [--budget <n>]
 *   --budget  override the pinned budget (local runs, tests)
 * Exit 0 within budget / no budget pinned; 1 over budget (lists the 20 directories
 * with the most files); 2 usage or missing resources dir.
 *
 * See change: slim-windows-install-file-count (design D3).
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Pinned budgets, keyed `<platform>-<arch>` (the CI matrix legs). Each is the leg's
 * measured post-change regular-file count + 5%. Unpinned legs report only.
 */
// Measured on the change branch's ci-electron run (run 41044784633, 2026-10-30): the packaged
// `resources/` regular-file count per leg, then +5%.
//   darwin-arm64 27478 · darwin-x64 27478 · linux-arm64 27478 · linux-x64 27480
//   win32-arm64  28500 · win32-x64  28368
export const BUDGETS = {
  "darwin-arm64": 28852,
  "darwin-x64": 28852,
  "linux-arm64": 28852,
  "linux-x64": 28854,
  "win32-arm64": 29925,
  "win32-x64": 29787,
};

const TOP_N = 20;

/** Regular-file count per directory (direct children only), symlinks skipped. */
export function countFilesByDir(root) {
  const perDir = new Map();
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    let here = 0;
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(dir, e.name));
      else if (e.isFile()) here += 1;
    }
    if (here > 0) perDir.set(dir, here);
    total += here;
  }
  return { total, perDir };
}

/** The `n` directories holding the most files, descending (ties by path). */
export function topDirs(perDir, root, n = TOP_N) {
  return [...perDir.entries()]
    .map(([dir, count]) => ({ dir: path.relative(root, dir).split(path.sep).join("/") || ".", count }))
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir))
    .slice(0, n);
}

function parseArgs(argv) {
  const out = { resourcesDir: undefined, platform: undefined, arch: undefined, budget: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--platform") out.platform = argv[++i];
    else if (a === "--arch") out.arch = argv[++i];
    else if (a === "--budget") out.budget = Number(argv[++i]);
    else if (!a.startsWith("--") && out.resourcesDir === undefined) out.resourcesDir = a;
  }
  return out;
}

/** CLI entry. Returns the exit code (injectable for tests). */
export function main(argv, deps = {}) {
  const log = deps.log ?? ((m) => console.log(m));
  const budgets = deps.budgets ?? BUDGETS;
  const args = parseArgs(argv);
  if (!args.resourcesDir || (args.budget !== undefined && !Number.isFinite(args.budget))) {
    log("usage: assert-bundle-file-budget.mjs <resourcesDir> --platform <p> --arch <a> [--budget <n>]");
    return 2;
  }
  const root = path.resolve(args.resourcesDir);
  if (!existsSync(root)) {
    // A mistyped CI path must not read as "0 files, within budget".
    log(`\u2717 resources dir not found: ${root}`);
    return 2;
  }
  const leg = `${args.platform ?? process.platform}-${args.arch ?? process.arch}`;
  const { total, perDir } = countFilesByDir(root);
  const budget = args.budget ?? budgets[leg];

  if (budget === undefined) {
    log(`bundle file count ${total} (${leg}) — no budget pinned`);
    return 0;
  }
  if (total <= budget) {
    log(`\u2713 bundle file count ${total} within budget ${budget} (${leg})`);
    return 0;
  }
  log(`\u2717 bundle file count ${total} exceeds budget ${budget} (${leg}) by ${total - budget}`);
  log(`  Top ${TOP_N} directories by file count:`);
  for (const { dir, count } of topDirs(perDir, root)) log(`  ${String(count).padStart(6)}  ${dir}`);
  log("  Reduce the file count (prune rules: scripts/lib/prune-bundle.mjs) or, for an intended increase,");
  log("  re-pin the leg's budget in BUDGETS with the measured count + 5%.");
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
