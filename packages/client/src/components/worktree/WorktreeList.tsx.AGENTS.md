# WorktreeList.tsx — index

Shared worktree list, two modes. `mode="spawn"` = whole-row `<button>` → `onSpawn(path, entry)`. `mode="manage"` = NON-button container (interactive elements cannot nest, design D9) hosting a selection checkbox + `✕`, a bulk bar (`Remove N worktrees`, `Select all N shown`, `Delete branch too`), per-row failure strips (icon + text + border, never colour alone), and a repo-global prune footer.

Filtering is client-side, derived from wire fields only (design D1). Default predicate `isMain || (!detached && inTree)`. `inTree` comes from the main entry's path with `\` → `/` normalisation — WITHOUT it every Windows row classifies out-of-tree and the default view collapses to the main row alone. A non-empty text query searches EVERY entry and overrides the default predicate; it guards `branch: string | null` so detached/bare rows never throw.

Chip coverage is an INVARIANT: every hidden row is revealable by at least one chip (`+ detached N` / `+ out of tree N`, sign states the ACTION). The `N of M shown` count is a UNION, not a sum — a row can be both detached and out-of-tree.

Row text uses `--text-primary` (branch) + `--text-secondary` (path) ONLY: `--text-muted` fails AA on dark, `--text-tertiary` fails on light (design D6).

`missing` is `exists === false`, NEVER falsy — `undefined` (new client, older server) means "unknown, treat as present", else every remove control silently disables. Missing rows swap `✕` for a prune affordance and are excluded from selection. The main row gets neither checkbox nor `✕`.

Exports `WorktreeList`, plus pure helpers `normalisePath`, `basenameOf`, `isInTree`, `suppressPathLine`, `elidePath`, `stripWorktreesPrefix`, `buildRows`, `matchesDefault`, `isVisible`, `hiddenCounts`. Path suppression is `inTree && branch != null && basename(path) === slugifyBranch(branch)` (design D7); elision is JS segment-wise, never CSS `direction:rtl` (bidi relocates leading punctuation). See change: manage-worktrees-filter-cleanup. Selection self-prunes on an `entries` change (effect): a completed bulk removal must not leave ghost selections that re-send dead paths.
