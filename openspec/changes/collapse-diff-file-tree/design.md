# Design

Revised after a two-cycle doubt-driven review (single-model + cross-model on `@propose-review-1`). Findings and their resolutions are folded in below.

## D1 — Path matching: tree row ↔ diff entry

`EditorFileTree` rows carry a cwd-relative POSIX `rel` (built by `joinRel`). The server normalizes `FileDiffEntry.path` to cwd-relative POSIX (`session-diff.ts` `normalizePath`), so the two match directly. Build one `Map<string, FileDiffEntry>` from `data.files` (session-owned only) and look up by `rel`.

- **No `normalizeUnderCwd` retry** — `joinRel` never produces an absolute path, and the server already POSIX-normalizes, so the retry that `DiffViewer` needs (for absolute `diff:` paths from chat) is dead code here. Verified against `session-diff.ts`.
- `otherChanges` are NOT in the map (they render only in the bottom group, D5).
- **Folder dots**: a directory row shows a change dot when any `file.path` in the map has `rel + "/"` as a prefix. Pure string test over the already-loaded path list — no directory fetch.

## D2 — No auto-expand (rejected)

Auto-expanding changed-file ancestors was **rejected** (user decision). It would have required a new exported reducer action (`mergeRoots` is a private helper; no action merges arbitrary roots), seed-once tracking to avoid re-expanding user-collapsed dirs when the changed set grows, and would have persisted the seeded roots (`treeOpenRoots` is written to localStorage every state change) plus triggered a burst of `/api/file/tree` fetches.

Consequence: a changed file inside a collapsed directory shows no inline row until the user expands it. **Folder change dots (D1)** + the summary count are the discovery signals. The lazy-tree invariant (fetch a dir only when in `treeOpenRoots`) is untouched.

## D3 — Rail-local `sessionOnly` (not global)

`DiffFileTree` owns `sessionOnly` as local `useState`, and `FileDiffView` (the full-screen takeover) renders `DiffFileTree` **outside** `SplitWorkspaceProvider` — it calls `useSessionDiff` directly. Lifting `sessionOnly` into `SplitWorkspaceContext` would make `DiffFileTree` throw there.

Resolution: keep `sessionOnly` **rail-local** — `EditorPane` owns a `useState(false)` and passes it (value + setter) to the summary bar (`ChangesRailSection`) and the bottom group. `DiffFileTree` keeps its own local `sessionOnly` for the takeover, unchanged. No global context change; the takeover and the rail are independent surfaces, so independent toggles are acceptable.

## D4 — Preview mode (changed regions of the current file)

Preview is derived from the unified `gitDiff` already cached on `FileDiffEntry`:

- Parse hunks; keep context (` `) and added (`+`) lines, drop removed (`-`) lines; emit in new-file (`+n2`) line-number order; added lines subtly tinted.
- **Scope is changed regions only** — a unified diff carries just the context around hunks, so Preview intentionally does NOT show unchanged code far from any change. It is not "the whole current file."
- **Coexists with the shipped `File` mode.** `DiffPanel` already has `viewMode: "diff" | "file"` where `File` fetches the *whole* file from `/api/session-file` (change `fix-session-diff-open-nongit-and-preview`, tested in `DiffPanelPreview.test.tsx`). Preview is a third, offline, changed-regions view. The toggle labels (`Diff` / `File` / `Preview`) distinguish them. This overlap is an accepted trade-off (user chose the diff-derived Preview knowingly).
- No server round-trip, no new endpoint. When `gitDiff` is absent (non-git, summed per-turn deltas) or unparseable (binary "Binary files differ" → zero hunks), the `Preview` control is disabled. Mode is component-local `useState`, not persisted.

## D5 — Other-changes bottom group

The server **skips pure deletions** (`session-diff.ts:195`) and marks every `data.files` row `previewable` (on disk via `/api/session-file`), so there are no not-on-disk session-owned rows — a deleted-files subsection would always be empty and is dropped.

That leaves `otherChanges` (working-tree changes this session did not make), which render as a muted, collapsed group at the **bottom of the rail's scroll region** (the last block inside the tree's scroll container — "bottom of content", not a sticky overlay). `EditorFileTree` already consumes the diff (D1), so it renders this group after the tree nodes as a flat path list (tree expansion irrelevant). The `this session only` toggle hides it. This mirrors `DiffFileTree`'s existing other-changes group, relocated to the merged tree.

## D6 — `openChanges()` invariant corrected

`openChanges()` today only reveals the rail (opens the split, bumps `changesRevealSignal`); it does **not** open a diff tab. Opening a specific file's diff comes from the chat file-link path (`ChatView` → `openDiffTab(normalizeUnderCwd(...))`), which is unchanged. The spec scenario is corrected to state exactly that: `openChanges` reveals the rail; the diff tab opens via the (unchanged) `openDiffTab` path.

## D7 — `DiffFileTree` is not deleted

`DiffFileTree` is removed from the **rail** but still imported by `FileDiffView` (takeover) and referenced by `DiffPanel` for its `FileSelection` type. Only `ChangesRailSection`'s use goes away. The inline markers in `EditorFileTree` are **new** row code (status dot, `CountBadges`, event expansion, folder dots), reusing `DiffFileTree`'s origin/`hasEdits` classification for the `+`/`●` indicator (tool-origin → `●`), not a lift-and-move — kept minimal per `code-simplification`.

## Rejected

- **Lift `sessionOnly` / `Diff-Preview` mode into a shared or persisted store** — breaks `FileDiffView` (D3) and matches no existing rail persistence.
- **Auto-expand changed-file ancestors** — reducer/seed/persistence/fetch cost (D2); replaced by folder dots.
- **Reconstruct the whole current file for Preview** — the cached `gitDiff` only has hunk context; the shipped `File` mode already covers whole-file view.
- **Second parallel tree filtered to changes** — reintroduces the duplication this change removes.
