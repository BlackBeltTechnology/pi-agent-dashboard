/**
 * One-shot maintenance: remove orphan `.worktrees/*` husks — directories that
 * exist on disk but are absent from `git worktree list`. These accrue when a
 * live kb DB handle recreates `<wt>/.pi/dashboard/kb/{index.db,-wal,-shm}` after
 * `git worktree remove` deletes the worktree (see change:
 * sweep-worktree-residual-on-remove).
 *
 * Dry-run by default; pass `--write` to actually delete. Idempotent: never
 * touches a registered worktree or the main checkout, and is hard-guarded to
 * the parent repo's `.worktrees/` subtree (symlink-resolved).
 *
 * Usage:
 *   npx tsx scripts/prune-orphan-worktrees.ts            # dry-run (list only)
 *   npx tsx scripts/prune-orphan-worktrees.ts --write    # delete husks
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const WRITE = process.argv.includes("--write");

/** Absolute paths of every registered worktree (main + linked). */
function registeredWorktrees(repoRoot: string): Set<string> {
  const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  const paths = new Set<string>();
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      const p = line.slice("worktree ".length).trim();
      try {
        paths.add(fs.realpathSync(p));
      } catch {
        paths.add(path.resolve(p));
      }
    }
  }
  return paths;
}

/** Repo root (parent of the common git dir), from any cwd inside the repo. */
function resolveRepoRoot(cwd: string): string {
  const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd,
    encoding: "utf-8",
  }).trim();
  const abs = path.isAbsolute(commonDir) ? commonDir : path.resolve(cwd, commonDir);
  return path.dirname(abs);
}

function main(): void {
  const repoRoot = resolveRepoRoot(process.cwd());
  const worktreesRoot = path.join(repoRoot, ".worktrees");
  if (!fs.existsSync(worktreesRoot)) {
    console.log(`[prune] no .worktrees/ under ${repoRoot} — nothing to do.`);
    return;
  }
  const realRoot = fs.realpathSync(worktreesRoot);
  const rootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  const registered = registeredWorktrees(repoRoot);
  const realMain = fs.realpathSync(repoRoot);

  const entries = fs.readdirSync(worktreesRoot, { withFileTypes: true });
  const husks: string[] = [];
  for (const e of entries) {
    const full = path.join(worktreesRoot, e.name);
    let real: string;
    try {
      real = fs.realpathSync(full);
    } catch {
      continue;
    }
    // Guards: inside .worktrees/, not the root, not main, not registered.
    if (real === realMain || real === realRoot) continue;
    if (!real.startsWith(rootWithSep)) continue; // symlink escape
    if (registered.has(real)) continue; // live worktree
    husks.push(full);
  }

  if (husks.length === 0) {
    console.log(`[prune] no orphan worktree husks under ${worktreesRoot}.`);
    return;
  }

  console.log(
    `[prune] ${husks.length} orphan husk(s) under ${worktreesRoot}${WRITE ? " (deleting):" : " (dry-run — pass --write to delete):"}`,
  );
  for (const h of husks) {
    if (WRITE) {
      try {
        fs.rmSync(fs.realpathSync(h), { recursive: true, force: true });
        console.log(`  removed  ${h}`);
      } catch (err) {
        console.error(`  FAILED   ${h}: ${(err as Error).message}`);
      }
    } else {
      console.log(`  would remove  ${h}`);
    }
  }
  if (!WRITE) console.log(`[prune] dry-run complete. Re-run with --write to apply.`);
}

main();
