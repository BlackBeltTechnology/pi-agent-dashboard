## Why

File edits get lost in the chat stream. A session makes many Edit/Write tool calls
across many turns; each renders as a collapsed card that expands to a diff. There is no
glanceable answer to "what did this session touch, and how much?" — the user must scroll
the whole stream or leave for the `Changed Files` takeover view. OpenAI Codex solves this
with a compact per-turn change table (files + `+adds −dels` + open link). This change
brings that to the dashboard, **fully deterministic — no LLM** (numbers come from data the
dashboard already has, not a model that can miscount).

Two facts make this cheap:
- The client already models turns (`turnStats`, `turnCount`, per-message `turnIndex`,
  `turnSeparator` rows) and already receives every Edit/Write tool call with its
  `oldText`/`newText` payload. Per-turn line deltas are derivable client-side with **zero
  server work**.
- The server already ships `session-diff.ts` (`enrichWithGitDiff`, `GET /api/session-diff`)
  and a `parseShortstat` helper. Net-vs-baseline line counts need only a `git diff
  --numstat HEAD` call — the archived `session-file-diff-view` proposal *claimed* "+/- lines"
  stats but `DiffFileTree.tsx` never implemented them, so this also closes that gap.

## What Changes

- **Per-turn inline summary block** in the chat stream. At each assistant turn boundary,
  render a compact table of files that turn changed: status glyph (● modified / + added),
  path, `+adds −dels`, and an open link. Derived **purely from the Edit/Write events already
  on the client**, grouped by `turnIndex`. Counts computed from `oldText`/`newText` line
  deltas. Works live, works with no git, no network round-trip.
- **Changed Files migrated from a takeover to an integrated split surface.** Today
  `FileDiffView` is a top-level branch in `App.tsx` that *replaces* `SessionSplitView` (chat +
  split pane). This change **integrates** it into the split editor pane instead of a
  self-contained tab (decision: *integrate*): changed files render as a **Changes section**
  pinned atop the pane's existing project-tree rail, and clicking one opens that file's diff
  as a per-file **`diff`-viewer tab** (sibling to normal file tabs). A new `openChanges()`
  helper on `SplitWorkspaceContext` opens the split and reveals/scrolls the Changes section
  (mirroring `openLiveTarget`). Chat stays in the left pane — no takeover.
- **The old takeover survives as a fallback** (decision: *keep as fallback*). The
  `/session/:id/diff` route continues to mount the standalone `FileDiffView` for deep-links
  and very narrow mobile where a split is impractical; it renders the same enriched tree.
- **Roll-up and tree merged into one rail.** Because the changed files now live in the pane
  rail, the separate pinned roll-up dock is **retired**. Its session aggregate
  (`N files · +X −Y`) becomes the **Changes-section header**, and the section rows carry
  per-file net `+adds −dels`. One rail answers "how much overall?", "which files?", and
  "browse the repo." A compact summary chip in the session header
  (`Changed files +X −Y · N`) calls `openChanges()`; each row reuses the existing
  `openInSplit` / `OpenFileButton` path.
- **Server: numstat enrichment.** `session-diff.ts` runs `git diff --numstat HEAD` once and
  attaches `additions`/`deletions` per `FileDiffEntry` plus `totalAdditions`/`totalDeletions`
  on `SessionDiffResponse` (optional fields, backwards-compatible). Mirrors the existing
  `worktreeDiffStat` idiom.
- **Deliberate distinction, clearly labeled.** Per-turn deltas ("what this turn did") and
  the roll-up ("net state vs baseline") intentionally differ when a line is added then later
  removed. Same as Codex per-turn deltas vs. `git status` net. The UI labels each so they
  never read as contradictory.
- **Non-git fallback.** Per-turn always works (event-derived). When `isGitRepo` is false the
  roll-up falls back to summed per-turn deltas instead of numstat.

- **On/off via a display-preference axis (overridable as others).** The per-turn block
  is gated by a new `DisplayPrefs` boolean `changeSummaryTable`, wired through the existing
  global + per-session-override machinery (`display-prefs.ts` / `mergeDisplayPrefs`,
  `PATCH /api/preferences/display`, `setSessionDisplayPrefs`). It appears in the Settings
  panel display section (global, deferred Save) AND as a row in the ⚙ View popover
  (`ChatViewMenu`, per-session, instant apply, "Use global settings" reset) — exactly like
  `toolResults` / `tokenStatsBar`. No new button, no new endpoint. Preset defaults: off in
  `simple`, on in `standard` / `everything`; legacy prefs backfill to `true`.

Explicitly **out of scope**: any LLM-generated prose summary of changes. Numbers only.

## Capabilities

### New Capabilities
- `change-summary-table`: Deterministic per-turn inline change table (client-side, grouped
  by `turnIndex`, line counts from Edit/Write event payloads; default expanded). No LLM.
  Integrates the Changed Files view into the split editor pane as a Changes section over the
  project-tree rail, opening per-file `diff`-viewer tabs; merges the session roll-up into the
  Changes-section header (aggregate + per-file `+adds −dels`). The standalone
  `/session/:id/diff` takeover is retained as a fallback. Per-file open links throughout.

### Modified Capabilities
- `session-diff-extraction`: `SessionDiffResponse` / `FileDiffEntry` gain optional
  `additions` / `deletions` (per file) and `totalAdditions` / `totalDeletions` (aggregate),
  populated from `git diff --numstat HEAD`. Backwards-compatible; absent for non-git repos.

## Impact

- **Types**: `packages/shared/src/diff-types.ts` — 4 optional numeric fields.
  `packages/shared/src/display-prefs.ts` — new `changeSummaryTable` boolean on `DisplayPrefs`
  + `PartialDisplayPrefs` + `mergeDisplayPrefs` + all 3 `DISPLAY_PRESETS`.
- **Server**: `packages/server/src/preferences-store.ts` — backfill `changeSummaryTable`
  (default `true`) for legacy prefs; no new endpoint (reuses `PATCH /api/preferences/display`).
- **Server**: `packages/server/src/session-diff.ts` — one `git diff --numstat` call +
  parse; reuses `parseShortstat`-style logic. No new endpoint, no protocol change, no bridge
  change.
- **Client**:
  - new `ChangeSummaryBlock` (per-turn, pure event derivation, default expanded) + a
    `lineDelta` util, wired into the chat stream at turn boundaries, **gated on effective
    `displayPrefs.changeSummaryTable`**;
  - `ChatViewMenu` (⚙ View popover) + `SettingsPanel` display section gain the
    `changeSummaryTable` row (per-session override + global), reusing the existing
    display-prefs toggle rows — no new control type;
  - new `ChangesRailSection` mounted atop the editor-pane project-tree rail (aggregate
    header + per-file rows), fed by `useSessionDiff` + the numstat fields;
  - new `ViewerKind` `diff` (added to the union AND to `VALID_VIEWERS` so persisted diff
    tabs survive reload) + a `DiffViewer` in `viewer-registry.tsx`; diff tabs open under a
    **virtual path** `diff:<relPath>` (mirrors `live:<url>`) so they coexist with a monaco
    tab of the same file (path-keyed dedup/React-key would otherwise collide);
  - new `SessionDiffProvider` (context) hoisting one `useSessionDiff` per session so
    `DiffViewer` / `ChangesRailSection` / fallback `FileDiffView` share ONE fetch (no
    per-tab fetch — `ViewerProps` carries no diff data, the context is the channel);
  - new `openChanges()` on `SplitWorkspaceContext` (opens the split, reveals the Changes
    section); Changes rows open a `diff` tab via `openFile(\`diff:${relPath}\`, "diff")`;
  - `DiffFileTree` gains per-file `+adds −dels` + the aggregate header (reused by both the
    rail section and the fallback `FileDiffView`);
  - `App.tsx`: `SessionHeader` "Changed Files" button becomes the summary chip calling
    `openChanges()`; the `diffMatch` takeover branch is **retained** as the
    `/session/:id/diff` fallback route.
- **Reused unchanged**: `useSessionDiff`, `@git-diff-view/react`, `OpenFileButton`,
  split-state / editor-pane-state, status-glyph logic, theme tokens.
- **No new dependencies.** No protocol / bridge change.

## Discipline Skills

- `performance-optimization` — per-turn derivation runs over the session event stream on
  each turn; keep it memoized/incremental so large sessions don't recompute the world.
- `code-simplification` — two surfaces share one data model; guard against duplicating
  derivation logic between the inline block and the roll-up.

## Mockups

Dark-theme tokens mirror the live dashboard (`_tokens.css` ← real `--bg-*/--text-*`
variables). Verify in browser before implementation.

- [`mockups/split.html`](mockups/split.html) — **the chosen direction (integrated)**: chat
  (left) + editor pane (right) with the Changes section over the project-tree rail, per-file
  `diff` tabs, the merged Changes-section roll-up header, the entry points, and the mobile
  stacked layout.
- [`mockups/index.html`](mockups/index.html) — the per-turn inline block in the chat stream,
  plus an early standalone-roll-up sketch (superseded by `split.html`'s merged rail header).
  Shows status glyphs, the `+adds −dels` columns, aggregate line, open links.
- [`mockups/states.html`](mockups/states.html) — edge states: empty (no changes),
  single-file turn, multi-file turn with overflow, non-git fallback, and the **net-vs-turn
  reconciliation** (added-then-removed → per-turn shows activity, roll-up shows net 0).

## Resolved Decisions

1. **ChangesViewer internals → integrate.** Changed files render as a Changes section atop
   the editor pane's project-tree rail; per-file diffs open as `diff`-viewer tabs. Not a
   self-contained mega-tab.
2. **Takeover → keep as fallback.** `/session/:id/diff` retains the standalone `FileDiffView`
   for deep-links and very narrow mobile; it renders the same enriched tree.
3. **Per-turn block default state → expanded** (with a collapse affordance to the one-line
   `N files · +X −Y` summary).
4. **Non-git roll-up → shown.** The Changes-section header shows summed per-turn deltas with
   a `summed` badge (never hidden).
5. **On/off → a `DisplayPrefs` axis, overridable as others.** The per-turn block is gated by
   a new `changeSummaryTable` boolean on `DisplayPrefs`, exposed in the Settings panel
   (global) and the ⚙ View popover (per-session override) via the existing display-prefs
   plumbing. No standalone toggle button. Preset defaults: `simple` off, `standard` /
   `everything` on.
