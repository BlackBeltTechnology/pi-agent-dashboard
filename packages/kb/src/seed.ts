// Seeded first index for a linked git worktree. The docs index is location-independent
// (rows are keyed by source id + a path relative to it), so a new worktree can start its
// first index from a consistent snapshot of the MAIN checkout's index and let the normal
// incremental walk re-chunk only the files that differ. This module owns the pieces that
// are not the walk itself: main-checkout discovery, the snapshot, per-source acceptance,
// the post-walk drop and the DOX acknowledgement copy. `index-run.ts` orders them.
// Zero dependencies (kb is self-contained), so `findMainCheckout` is a local implementation
// of `git-checkout-root-resolution`. See change: add-kb-worktree-seed.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import * as sqlite from "node:sqlite";
import type { IndexGateConfig, ResolvedConfig } from "./config.js";
import { sourceIsSeedable } from "./index-gate.js";
import type { SqliteFtsStore } from "./sqlite-store.js";
import { STALENESS_VERSION } from "./staleness.js";

export type SeedSkipReason = "disabled" | "not-a-worktree" | "no-main-checkout" | "custom-dbpath" | "main-building" | "no-main-index" | "snapshot-error";

/** What a first-index caller hands `runIndexAtomic` (built by {@link seedOptionsFromConfig}). */
export interface SeedOptions {
  /** `false` ⇒ `seed-skipped=disabled` (config, `--no-seed`, explicit `--source`). */
  enabled: boolean;
  /** The resolved config's cwd (the worktree, or a directory inside it). */
  cwd: string;
  /** The resolved database path (absolute). */
  dbAbsPath: string;
  /** The path came from `--db` ⇒ `seed-skipped=custom-dbpath` once a main checkout resolved. */
  customDb?: boolean;
}

/** The one derivation of seed options from a resolved config (every docs writer uses it). */
export function seedOptionsFromConfig(
  cfg: Pick<ResolvedConfig, "seedFromMainWorktree" | "cwd" | "dbAbsPath">,
  o: { noSeed?: boolean; explicitSources?: boolean; customDb?: boolean } = {},
): SeedOptions {
  return {
    enabled: cfg.seedFromMainWorktree !== false && !o.noSeed && !o.explicitSources,
    cwd: cfg.cwd,
    dbAbsPath: cfg.dbAbsPath,
    customDb: !!o.customDb,
  };
}

// ── main-checkout discovery (design D1) ─────────────────────────────────────

const GIT_TIMEOUT_MS = 2000;
/** git's exit status for `config --get` of an unset key. */
const CONFIG_UNSET = 1;

type GitResult = { ok: true; out: string } | { ok: false; status: number | null };
function git(cwd: string, args: string[]): GitResult {
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", timeout: GIT_TIMEOUT_MS, stdio: ["ignore", "pipe", "ignore"] }).trim();
    return { ok: true, out };
  } catch (e) {
    const status = (e as { status?: unknown }).status;
    return { ok: false, status: typeof status === "number" ? status : null };
  }
}

const FOLD_CASE = process.platform === "darwin" || process.platform === "win32";
/** realpath → no trailing separator → platform case fold; falls back to the lexical path. */
function canon(p: string): string {
  let r: string;
  try {
    r = realpathSync.native(p);
  } catch {
    r = resolve(p);
  }
  while (r.length > 1 && r.endsWith(sep)) r = r.slice(0, -1);
  return FOLD_CASE ? r.toLowerCase() : r;
}

export type MainCheckout =
  | { status: "not-a-worktree" }
  | { status: "no-main-checkout" }
  | { status: "ok"; main: string; toplevel: string };

/** Resolve the main checkout of the linked worktree containing `cwd`, per
 *  `git-checkout-root-resolution` (repo-local `core.worktree`, bare-repository check). Needs
 *  git ≥ 2.31 (`--path-format`). Consumer checks included: the main path exists, is a
 *  directory other than this checkout, and shares its common git dir. */
export function findMainCheckout(cwd: string): MainCheckout {
  const dirs = git(cwd, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]);
  if (!dirs.ok) return { status: "not-a-worktree" }; // not inside git
  // git < 2.31 echoes the unknown option instead of absolute paths.
  const [gitDir, commonDir, ...extra] = dirs.out.split("\n");
  if (extra.length || !gitDir || !commonDir || !isAbsolute(gitDir) || !isAbsolute(commonDir)) return { status: "no-main-checkout" };
  if (canon(gitDir) === canon(commonDir)) return { status: "not-a-worktree" }; // main checkout / submodule checkout
  const top = git(cwd, ["rev-parse", "--path-format=absolute", "--show-toplevel"]);
  if (!top.ok || !isAbsolute(top.out)) return { status: "no-main-checkout" };

  const main = mainPathFromConfig(cwd, commonDir);
  if (main === null || !isSameRepoOtherCheckout(main, top.out, commonDir)) return { status: "no-main-checkout" };
  return { status: "ok", main, toplevel: top.out };
}

/** The main checkout path named by the common dir's repo-local config, or `null`:
 *  `core.worktree` first (a failing read means none — never fall through to the `.git`
 *  parent), else the parent of a `.git` common dir whose repo-local `core.bare` is false/unset. */
function mainPathFromConfig(cwd: string, common: string): string | null {
  const cfgFile = join(common, "config");
  const wt = git(cwd, ["config", "--file", cfgFile, "--get", "core.worktree"]);
  if (wt.ok) return resolve(common, wt.out);
  if (wt.status !== CONFIG_UNSET || basename(common) !== ".git") return null;
  const bare = git(cwd, ["config", "--file", cfgFile, "--type=bool", "--get", "core.bare"]);
  const notBare = bare.ok ? bare.out === "false" : bare.status === CONFIG_UNSET;
  return notBare ? dirname(common) : null;
}

/** Consumer checks: `main` exists, is a directory, is not this checkout, shares its common dir. */
function isSameRepoOtherCheckout(main: string, toplevel: string, common: string): boolean {
  try {
    if (!statSync(main).isDirectory()) return false;
  } catch {
    return false;
  }
  if (canon(main) === canon(toplevel)) return false;
  const theirs = git(main, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return theirs.ok && canon(theirs.out) === canon(common);
}

// ── seed preparation (design D2) ────────────────────────────────────────────

/** `realpath` of the nearest existing ancestor + the not-yet-existing remainder. */
function realpathLoose(p: string): string {
  const rest: string[] = [];
  let cur = resolve(p);
  for (;;) {
    try {
      return join(realpathSync.native(cur), ...rest.reverse());
    } catch {
      const up = dirname(cur);
      if (up === cur) return resolve(p);
      rest.push(basename(cur));
      cur = up;
    }
  }
}
const inside = (rel: string): boolean => rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);

export type SeedPrep = { ok: true; main: string; toplevel: string; cwdRel: string } | { ok: false; reason: SeedSkipReason };

function removeDb(path: string): void {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(path + ext);
    } catch {}
  }
}

/** Decide whether to seed and, if so, take the snapshot into `tmpPath` (before any store is
 *  constructed on it: `VACUUM INTO` refuses an existing non-empty target). The reason order is
 *  `disabled › not-a-worktree › no-main-checkout › custom-dbpath › main-building › no-main-index`.
 *  A throw while snapshotting leaves no tmp behind and is reported as `snapshot-error`. */
export function prepareSeed(opts: SeedOptions, tmpPath: string, isBuilding: (seedDb: string) => boolean): SeedPrep {
  if (!opts.enabled) return { ok: false, reason: "disabled" };
  const found = findMainCheckout(opts.cwd);
  if (found.status !== "ok") return { ok: false, reason: found.status };
  const dbRel = relative(realpathLoose(found.toplevel), realpathLoose(opts.dbAbsPath));
  if (opts.customDb || !inside(dbRel)) return { ok: false, reason: "custom-dbpath" };
  const seedDb = join(found.main, dbRel);
  let size = 0;
  try {
    size = statSync(seedDb).size;
  } catch {}
  if (size === 0) return { ok: false, reason: isBuilding(seedDb) ? "main-building" : "no-main-index" };

  try {
    removeDb(tmpPath); // a leftover (same PID reused, or a crashed seeded run) must not leak foreign rows
    mkdirSync(dirname(tmpPath), { recursive: true });
    // Read-write handle on purpose (a readOnly one cannot create `-shm` after a checkpoint removed
    // it), journal mode untouched, reads only: the snapshot includes WAL-only commits and excludes
    // open transactions, and no row of the main database is written.
    const db = new sqlite.DatabaseSync(seedDb);
    try {
      db.exec("PRAGMA busy_timeout=2000");
      db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
  } catch {
    removeDb(tmpPath);
    return { ok: false, reason: "snapshot-error" };
  }
  return { ok: true, main: found.main, toplevel: found.toplevel, cwdRel: relative(realpathLoose(found.toplevel), realpathLoose(opts.cwd)) };
}

// ── acceptance, post-walk drop (design D3) ──────────────────────────────────

/** Keep a snapshot's source only when this run passes it and the main checkout recorded the
 *  current schema version, options hash and kb engine for it; drop every other root. Kept
 *  files get a stale mtime so the walk compares them by content. Returns the kept roots. */
export function acceptSeed(store: SqliteFtsStore, gate: IndexGateConfig, passedRoots: string[]): string[] {
  store.reconcileChunkMap(); // drops below need a complete (root,path)→chunk map, even from an old writer
  const passed = new Set(passedRoots);
  const kept: string[] = [];
  for (const root of store.rootsPresent()) {
    if (passed.has(root) && sourceIsSeedable(store, gate, root)) kept.push(root);
    else store.dropRoot(root);
  }
  store.invalidateMtimes(kept);
  return kept;
}

/** After the walk: a seeded root whose walk reported it missing keeps stale rows — drop them and
 *  sweep nodes left without a path and without referencing edges. */
export function dropUnwalked(store: SqliteFtsStore, missingRoots: string[]): void {
  for (const r of missingRoots) store.dropRoot(r);
  store.sweepPlaceholders();
}

// ── DOX acknowledgement copy (design D5) ────────────────────────────────────

const STALENESS_REL = join(".pi", "dashboard", "kb", "dox-staleness.json");

/** Copy the main checkout's `dox-staleness.json` into the worktree iff it exists, parses, carries
 *  no version (legacy) or exactly the supported one, and the worktree has none. Never throws;
 *  a failure is logged as `seed-staleness-skipped=<code>`. */
export function copyStaleness(main: string, cwdRel: string, cwd: string, log: (line: string) => void): void {
  const src = join(main, cwdRel, STALENESS_REL);
  const target = join(cwd, STALENESS_REL);
  try {
    if (!existsSync(src) || existsSync(target)) return;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(src, "utf8"));
    } catch {
      return; // corrupt: nothing readable to carry over
    }
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return;
    const version = (raw as { version?: unknown }).version;
    if ("version" in (raw as object) && version !== STALENESS_VERSION) return;
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.tmp-${process.pid}`;
    try {
      copyFileSync(src, tmp);
      renameSync(tmp, target);
    } catch (e) {
      try {
        unlinkSync(tmp);
      } catch {}
      throw e;
    }
  } catch (e) {
    log(`[kb] seed-staleness-skipped=${(e as NodeJS.ErrnoException)?.code ?? "error"}`);
  }
}
