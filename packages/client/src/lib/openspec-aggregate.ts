import type { OpenSpecData, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Aggregated OpenSpec view for a folder group whose member sessions may live in
 * separate working trees (git worktrees). Each working copy keeps a distinct
 * `openspec/changes/<name>/tasks.md`, so the server keys `openspecMap` by cwd.
 * This unions those per-cwd entries into one card-level view.
 *
 * See change: fix-openspec-worktree-cwd-keying.
 */
export interface AggregatedOpenSpec extends OpenSpecData {
  /** Changes tagged with the `sourceCwd` they were discovered under. */
  changes: OpenSpecChange[];
}

/**
 * Union OpenSpec data across `groupCwd` plus every distinct member-session cwd.
 *
 * - Changes are tagged with `sourceCwd` (the cwd they were found under).
 * - De-duped by change name; `groupCwd` wins on collision (canonical copy).
 * - `initialized` / `pending` / `hasOpenspecDir` OR-fold across member cwds.
 *
 * `groupCwd` is always considered first so its entries win collisions and its
 * changes appear before worktree-only ones.
 */
export function aggregateOpenSpec(
  groupCwd: string,
  sessionCwds: string[],
  openspecMap: Map<string, OpenSpecData> | undefined,
): AggregatedOpenSpec {
  // group cwd first → wins collisions + sorts ahead of worktree-only changes
  const memberCwds = [groupCwd, ...sessionCwds.filter((c) => c !== groupCwd)];
  const seenCwds = new Set<string>();

  const changes: OpenSpecChange[] = [];
  const seenNames = new Set<string>();
  let initialized = false;
  let pending = false;
  let hasOpenspecDir = false;

  for (const cwd of memberCwds) {
    if (seenCwds.has(cwd)) continue;
    seenCwds.add(cwd);
    const data = openspecMap?.get(cwd);
    if (!data) continue;
    initialized = initialized || data.initialized;
    pending = pending || !!data.pending;
    hasOpenspecDir = hasOpenspecDir || !!data.hasOpenspecDir;
    for (const change of data.changes) {
      if (seenNames.has(change.name)) continue; // group cwd wins on collision
      seenNames.add(change.name);
      changes.push({ ...change, sourceCwd: cwd });
    }
  }

  return { initialized, pending, hasOpenspecDir, changes };
}
