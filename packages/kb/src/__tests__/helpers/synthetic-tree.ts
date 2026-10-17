// Scaled-down synthetic trees for the walk / pre-scan liveness tests
// (change: bound-kb-search-freshness, K1/K3). Full scale is recorded once in design.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** `groups` top-level dirs × `perGroup` leaf dirs. Every `ignoredEvery`-th group is
 *  named `skip-<n>` and gitignored (its subtree is never descended). One tiny md
 *  per non-ignored group so the walk selects something. Returns the dir count. */
export function makeDeepTree(root: string, opts: { groups: number; perGroup: number; ignoredEvery: number }): { dirs: number; ignoredDirs: number; selected: number } {
  let dirs = 0;
  let ignoredDirs = 0;
  let selected = 0;
  writeFileSync(join(root, ".gitignore"), "skip-*/\n");
  for (let g = 0; g < opts.groups; g++) {
    const ignored = g % opts.ignoredEvery === 0;
    const gd = join(root, ignored ? `skip-${g}` : `g${g}`);
    mkdirSync(gd, { recursive: true });
    dirs++;
    if (ignored) ignoredDirs++;
    for (let i = 0; i < opts.perGroup; i++) {
      mkdirSync(join(gd, `d${i}`));
      dirs++;
      if (ignored) ignoredDirs++;
    }
    if (!ignored) {
      writeFileSync(join(gd, "note.md"), `# Group ${g}\n\nA note body long enough to be a chunk of its own in the synthetic tree number ${g}, padded out a little.\n`);
      selected++;
    }
  }
  return { dirs, ignoredDirs, selected };
}

/** One directory with `entries` direct children (R10 wide-directory case). */
export function makeWideDir(dir: string, entries: number, ext = "txt"): void {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < entries; i++) writeFileSync(join(dir, `f${i}.${ext}`), "x");
}

/** `n` flat files (non-markdown by default → counted by the walk, never selected). */
export function makeFlatFiles(dir: string, n: number, ext = "txt"): void {
  makeWideDir(dir, n, ext);
}

/** `n` empty child directories directly under `dir`. */
export function makeFlatDirs(dir: string, n: number): void {
  for (let i = 0; i < n; i++) mkdirSync(join(dir, `c${i}`), { recursive: true });
}
