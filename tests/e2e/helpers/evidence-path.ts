import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve where a change's recorded measurements live — WITHOUT creating it.
 *
 * Both measurement specs used to hardcode
 * `openspec/changes/verify-subagent-pull-under-load/measurements.json` and call
 * `mkdirSync(..., { recursive: true })`. Once the change was archived, that
 * combination CONJURED the pre-archive directory back into existence: tooling
 * that enumerates `openspec/changes/*` then saw a phantom active change, and —
 * worse for evidence integrity — the write landed somewhere other than the
 * archived `heap-evidence.md`'s source of truth, so a re-measure looked like it
 * left the archived numbers unchanged while actually recording different ones
 * elsewhere. That is precisely the staleness the evidence file exists to
 * prevent. See issue #549.
 *
 * So this resolver never creates anything. It reports where the change
 * genuinely is, and throws when it cannot tell — a misdirected write must be
 * loud, not silent.
 */

/** The recorded-measurements file inside a change directory. */
export const EVIDENCE_FILENAME = "measurements.json";

/** Repo root, derived from this file rather than from cwd (specs run from varying cwds). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Archived changes are `archive/<YYYY-MM-DD>-<name>`. Anchored at both ends so
 * `verify-x` does not match `verify-x-followup`.
 */
function archiveEntryMatcher(changeName: string): RegExp {
  const escaped = changeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escaped}$`);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Directory of `changeName`: the active one, else the NEWEST archived one.
 * Returns `null` when the change exists in neither place.
 */
export function findChangeDir(changeName: string, repoRoot: string = REPO_ROOT): string | null {
  const changesDir = join(repoRoot, "openspec", "changes");

  const active = join(changesDir, changeName);
  if (isDirectory(active)) return active;

  const archiveDir = join(changesDir, "archive");
  let entries: string[];
  try {
    entries = readdirSync(archiveDir);
  } catch {
    return null;
  }

  const matcher = archiveEntryMatcher(changeName);
  // A reopened change can be archived more than once; the date prefix is fixed
  // width, so a lexicographic sort puts the newest last.
  const matches = entries
    .filter((entry) => matcher.test(entry))
    .filter((entry) => isDirectory(join(archiveDir, entry)))
    .sort();

  const newest = matches.at(-1);
  return newest ? join(archiveDir, newest) : null;
}

/**
 * Absolute path of `changeName`'s measurements file.
 * Throws when the change is in neither the active nor the archived location —
 * never creates the directory, which is what produced the phantom change dir.
 */
export function resolveEvidencePath(changeName: string, repoRoot: string = REPO_ROOT): string {
  const dir = findChangeDir(changeName, repoRoot);
  if (dir === null) {
    throw new Error(
      `Cannot record measurements: change "${changeName}" was found in neither\n` +
        `  ${join(repoRoot, "openspec", "changes", changeName)}\n` +
        `  ${join(repoRoot, "openspec", "changes", "archive")}/<YYYY-MM-DD>-${changeName}\n` +
        "Refusing to create it — a measurement written to a conjured directory is invisible " +
        "to the evidence file it is supposed to update (see issue #549).",
    );
  }
  return join(dir, EVIDENCE_FILENAME);
}

/**
 * Append one recorded measurement so the change's evidence file is transcribed,
 * not invented. Merges into any existing keys; throws (never creates) when the
 * change directory is gone.
 */
export function recordMeasurement(changeName: string, key: string, value: unknown): void {
  const path = resolveEvidencePath(changeName);
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    /* first write */
  }
  current[key] = value;
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`);
}
