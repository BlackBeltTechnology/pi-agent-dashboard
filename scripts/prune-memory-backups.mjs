/**
 * Recurring maintenance: trim the pi-hermes memory store's disposable files.
 *
 * The store (`~/.pi/agent/pi-hermes-memory/`) accrues two classes of garbage it
 * never prunes itself:
 *   - `sessions.db.corrupt-*` — quarantined SQLite copies (plus `-shm`/`-wal`
 *     sidecars) left behind after a corruption recovery. Never re-read.
 *   - `sessions.db.bak.auto-<YYYYMMDD>-<HHMMSS>` — weekly auto-backups, ~700MB
 *     each and growing. Only the newest few have any recovery value.
 *
 * Left alone these reached 5.7GB / 78 corrupt files on a real machine and
 * contributed to a full disk.
 *
 * Dry-run by default; pass `--write` to actually delete. Idempotent. The live
 * `sessions.db` (+ `-wal`/`-shm`) and non-auto backups (`.bak.cleanup-*`,
 * `.bak.trim-*`) are never candidates.
 *
 * Usage:
 *   node scripts/prune-memory-backups.mjs                 # dry-run
 *   node scripts/prune-memory-backups.mjs --write         # apply, keep 2
 *   node scripts/prune-memory-backups.mjs --write --keep 4
 *   node scripts/prune-memory-backups.mjs --dir <path>    # non-default store
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Auto-backups retained by default. */
export const DEFAULT_KEEP = 2;

export const DEFAULT_DIR = join(homedir(), ".pi", "agent", "pi-hermes-memory");

const CORRUPT = /^sessions\.db\.corrupt-/;
/** Only the timestamped *auto* rotation — hand-made .bak.cleanup/.bak.trim are spared. */
const AUTO_BACKUP = /^sessions\.db\.bak\.auto-(\d{8}-\d{6})$/;

/**
 * Pure: split directory entry names into delete/keep sets.
 * @param {string[]} names directory entry names
 * @param {number} keep how many newest auto-backups to retain
 * @returns {{corrupt: string[], backups: string[], kept: string[]}}
 */
export function planPrune(names, keep = DEFAULT_KEEP) {
  const corrupt = names.filter((n) => CORRUPT.test(n)).sort();

  // Newest first — the timestamp format sorts lexicographically.
  const autos = names.filter((n) => AUTO_BACKUP.test(n)).sort().reverse();

  return { corrupt, backups: autos.slice(keep), kept: autos.slice(0, keep) };
}

function sizeOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/**
 * Apply (or preview) the prune.
 * @param {{dir?: string, keep?: number, write?: boolean}} opts
 */
export function prune({ dir = DEFAULT_DIR, keep = DEFAULT_KEEP, write = false } = {}) {
  if (!existsSync(dir)) return { plan: { corrupt: [], backups: [], kept: [] }, deleted: [], bytes: 0, missing: true };

  const plan = planPrune(readdirSync(dir), keep);
  const targets = [...plan.corrupt, ...plan.backups];

  let bytes = 0;
  const deleted = [];
  for (const name of targets) {
    const full = join(dir, name);
    bytes += sizeOf(full);
    if (write) {
      rmSync(full, { force: true });
      deleted.push(name);
    }
  }
  return { plan, deleted, bytes, missing: false };
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(0)}MB`;

function main(argv) {
  const write = argv.includes("--write");
  const keepIdx = argv.indexOf("--keep");
  const keep = keepIdx === -1 ? DEFAULT_KEEP : Number(argv[keepIdx + 1]);
  const dirIdx = argv.indexOf("--dir");
  const dir = dirIdx === -1 ? DEFAULT_DIR : argv[dirIdx + 1];

  if (!Number.isInteger(keep) || keep < 0) {
    console.error(`[prune-memory] --keep must be a non-negative integer, got: ${argv[keepIdx + 1]}`);
    process.exitCode = 1;
    return;
  }

  const { plan, bytes, missing } = prune({ dir, keep, write });
  if (missing) {
    console.log(`[prune-memory] no store at ${dir} — nothing to do.`);
    return;
  }

  const total = plan.corrupt.length + plan.backups.length;
  if (total === 0) {
    console.log(`[prune-memory] ${dir} already clean (${plan.kept.length} backup(s) kept).`);
    return;
  }

  console.log(
    `[prune-memory] ${dir}\n` +
      `  corrupt quarantine : ${plan.corrupt.length} file(s)\n` +
      `  surplus backups    : ${plan.backups.length} file(s) (keeping ${plan.kept.length})\n` +
      `  reclaims           : ~${mb(bytes)}`,
  );
  for (const n of plan.kept) console.log(`  keep    ${n}`);
  for (const n of [...plan.corrupt, ...plan.backups]) {
    console.log(`  ${write ? "removed" : "would remove"} ${n}`);
  }
  if (!write) console.log(`[prune-memory] dry-run complete. Re-run with --write to apply.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
