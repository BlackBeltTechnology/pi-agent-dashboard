/**
 * Pure fs/mtime helpers shared by `directory-service.ts` and
 * `openspec-poll-worker.ts`. Extracted so the worker can import these without
 * pulling all of `directory-service.ts` (which carries SessionManager /
 * PreferencesStore couplings) into its module graph.
 *
 * See change: offload-openspec-poll-to-worker.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export function statMtimeOr(p: string): number | undefined {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * Maximum mtime across a fixed list of paths. Missing paths (ENOENT) are
 * skipped — they don't poison the result. Returns `undefined` only when
 * every input is missing.
 *
 * Used by the change-detection gate to catch in-place file edits that don't
 * bump any parent directory's mtime on POSIX. See change:
 * fix-openspec-mtime-gate-blind-spots.
 */
export function effectiveMtimeOr(paths: string[]): number | undefined {
  let max: number | undefined;
  for (const p of paths) {
    const m = statMtimeOr(p);
    if (m === undefined) continue;
    if (max === undefined || m > max) max = m;
  }
  return max;
}

/**
 * File set tracked by the per-change effective-mtime computation.
 *
 * Base set: the change dir itself plus the three top-level artifact files.
 * The `specs/` fan-out catches multi-spec authoring:
 *   - `<change>/specs/`               — advances on capability dir create/remove
 *   - `<change>/specs/<cap>/`         — advances when `spec.md` is created inside
 *   - `<change>/specs/<cap>/spec.md`  — advances on in-place edits
 *
 * `readdirSync` is wrapped in try/catch so missing `specs/` (or any fs error)
 * yields an empty fan-out rather than throwing.
 *
 * See change: fix-openspec-specs-mtime-gate-blind-spot.
 */
export function perChangeArtifactPaths(changesRoot: string, name: string): string[] {
  const dir = path.join(changesRoot, name);
  const base = [
    dir,
    path.join(dir, "tasks.md"),
    path.join(dir, "proposal.md"),
    path.join(dir, "design.md"),
  ];
  const specsDir = path.join(dir, "specs");
  const specsExtras: string[] = [specsDir];
  try {
    const entries = fs.readdirSync(specsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const capDir = path.join(specsDir, e.name);
        specsExtras.push(capDir);
        specsExtras.push(path.join(capDir, "spec.md"));
      }
    }
  } catch {
    // ENOENT, permission denied, etc. — leave specsExtras with just specsDir
    // (its own statMtimeOr will return undefined and be excluded from max).
  }
  return [...base, ...specsExtras];
}
