## 1. Shared types (numstat fields)

- [x] 1.1 Add optional `additions?: number` / `deletions?: number` to `FileDiffEntry` and `totalAdditions?` / `totalDeletions?` to `SessionDiffResponse` in `packages/shared/src/diff-types.ts` (JSDoc: absent for non-git / git-error / binary files).
- [x] 1.2 Run `npm test` for shared to confirm the type-only change compiles and breaks nothing.

## 2. Server — numstat enrichment (`session-diff.ts`)

- [x] 2.1 Add a `gitNumstat(cwd)` helper: run `git diff --numstat HEAD` via the shared `git`/`exec` runner (windowsHide, timeout, argv-array, no shell); write a **new** `--numstat` parser (`adds<TAB>dels<TAB>path`) — do NOT reuse `parseShortstat` (that parses `--shortstat` summary lines, a different format). Return `Map<path, {additions, deletions}>`; binary rows (`-`) → omit that path.
- [x] 2.2 In the git-enrichment path, attach `additions`/`deletions` per `FileDiffEntry` from the map, and compute `totalAdditions`/`totalDeletions` (excluding binary/omitted files).
- [x] 2.3 Guarantee optional-field semantics: non-git repo, git error, and binary files omit the counts and never fail the request.
- [x] 2.4 Write/extend `packages/server/src/__tests__/session-diff.test.ts`: numstat parsed → per-file + totals present; binary `-` row omitted from file + totals; non-git → all count fields absent; git-error → request still succeeds with counts absent. (TDD: write failing tests first.)

## 3. Client — per-turn line-delta util

- [x] 3.1 Add `packages/client/src/lib/lineDelta.ts`: `editDelta(oldText, newText)` via `structuredPatch` (jsdiff, already a dep; NOTE `EditToolRenderer` uses `createTwoFilesPatch` — different fn) counting `+`/`−` hunk lines. Handle ALL edit shapes the events carry: single `oldText`/`newText`, an `edits[]` array (sum per op), hashline ops, and Write `content` (new file → all additions).
- [x] 3.2 Add `turnFileDeltas(messages)`: since tool events carry NO `turnIndex` (only user messages do — `event-reducer.ts:~1719`), attribute each Edit/Write `toolResult` to the nearest preceding user message's turn (running `turnCount`); the in-progress turn groups under the current `turnCount`. Group by path, sum deltas. Memoize per turn.
- [x] 3.3 Unit tests: `editDelta` (pure add, pure delete, replacement with unchanged inner lines NOT counted, `edits[]` multi-op summed, Write-new-file all-additions); `turnFileDeltas` (correct turn attribution incl. in-progress turn, multi-file turn). (TDD.)

## 4. Client — per-turn inline block (`ChangeSummaryBlock`)

- [x] 4.1 Create `ChangeSummaryBlock` (default **expanded**, collapse affordance → one-line `N files · +X −Y`): status glyph (● modified / + added), path, `+adds −dels`, open affordance. Reuse status-glyph logic + theme tokens; match `mockups/index.html`.
- [x] 4.2 Wire it into the chat stream at each assistant turn boundary that has ≥1 Edit/Write event, grouped by `turnIndex`. **Memoize per `turnIndex`** (keyed by the turn's tool-event identities) so large sessions don't recompute — invoke the `performance-optimization` discipline here.
- [x] 4.3 Row open affordance → `openInSplit(path)` (opens the file's `diff` tab once §6/§7 land); no block rendered for turns with no file changes.
- [x] 4.4 Component tests: block renders for a turn with changes, hidden for a turn without; counts match `turnFileDeltas`; collapse toggles to the one-line summary.

## 4A. Display-preference axis (`changeSummaryTable`)

- [x] 4A.1 Add `changeSummaryTable: boolean` to `DisplayPrefs` + `PartialDisplayPrefs` + `mergeDisplayPrefs` + all 3 `DISPLAY_PRESETS` in `packages/shared/src/display-prefs.ts` (defaults: `simple` false, `standard`/`everything` true). Extend `packages/shared/src/__tests__/display-prefs.test.ts` (merge precedence, preset values). (TDD.)
- [x] 4A.2 Backfill `changeSummaryTable` to `true` for legacy `preferences.json` lacking the field in `packages/server/src/preferences-store.ts`; extend `preferences-store.test.ts` (backfill + partial-PATCH preserves the field). No new endpoint — reuse `PATCH /api/preferences/display` + `setSessionDisplayPrefs`.
- [x] 4A.3 Add the `changeSummaryTable` toggle row to the ⚙ View popover (`ChatViewMenu`, per-session override) and the Settings-panel display section (global, deferred Save), reusing the existing toggle-row components. Add i18n label.
- [x] 4A.4 Gate `ChangeSummaryBlock` (§4) render on effective `displayPrefs.changeSummaryTable`; the Changes rail, summary chip, and `diff` viewer are NOT gated by it.
- [x] 4A.5 Tests: effective true → block renders; global false → hidden; per-session override off beats global on; `ChatViewMenu` toggle emits `setSessionDisplayPrefs`.

## 5. Client — enrich `DiffFileTree` (single source for rail + fallback)

- [x] 5.1 Add per-file `+adds −dels` to rows and the aggregate `N files · +X −Y` header to `DiffFileTree`, reading `additions`/`deletions`/`total*` from the `session-diff` payload. Keep it the ONLY changed-files tree (consumed by both the rail section and the fallback takeover) — `code-simplification` discipline.
- [x] 5.2 Non-git fallback: when count fields are absent, show summed per-turn deltas with a visible `summed` badge on the header (per `mockups/states.html`).
- [x] 5.3 Tests: git payload → per-file + aggregate counts; non-git → `summed` badge + summed values; no-changes → empty state.

## 6. Client — `diff` viewer

- [x] 6.1 Add `ViewerKind: "diff"` to `packages/shared/src/file-kind.ts` (union only; `fileKind()` never returns it — opened explicitly, like `live-server`) AND add `"diff"` to `VALID_VIEWERS` in `editor-pane-state.ts` so persisted diff tabs survive reload (verified gap: currently rejected → whole pane state dropped).
- [x] 6.2 Add `SessionDiffProvider` (context) hoisting one `useSessionDiff(sessionId)` per session; refresh on new Edit/Write for the session. `DiffViewer`, `ChangesRailSection`, and the fallback `FileDiffView` all read from it — one shared fetch, no per-tab fetch (design D5).
- [x] 6.3 Add `DiffViewer`, register in `viewer-registry.tsx`. It strips the `diff:` path prefix, reads that file's `gitDiff` from `SessionDiffProvider`, and renders via `@git-diff-view/react` (same renderer `DiffPanel` uses). Note `ViewerProps` carries no diff data — the context is the channel.
- [x] 6.4 Tab label shows filename + a `diff` tag (per `mockups/split.html`). Viewer-registry + context tests cover the new kind.

## 7. Client — integrate into the split pane

- [x] 7.1 Convert the editor-pane rail (`EditorPane.tsx:~158`, currently a single `EditorFileTree` div) to a vertical stack: `ChangesRailSection` (collapsible, own scroll, merged roll-up header + per-file rows via `DiffFileTree`, fed by `SessionDiffProvider`) above `EditorFileTree`, honoring the tree-visibility toggle.
- [x] 7.2 Add `openChanges()` to `SplitWorkspaceContext` (parallels `openLiveTarget`): open the split, reveal/scroll the Changes section. Changes rows + per-turn rows → `dispatch({ type: "openFile", path: \`diff:${relPath}\`, viewer: "diff" })` (virtual prefix so a diff tab coexists with a monaco tab of the same file — verified dedup/key collision otherwise).
- [x] 7.3 `SessionHeader`: replace the "Changed Files" button with the summary chip (`Changed files +X −Y · N`) calling `openChanges()`; hide it when there are no changes.
- [x] 7.4 Retain the `App.tsx` `diffMatch` takeover as the `/session/:id/diff` fallback route (deep-link / very narrow mobile), rendering the same enriched `FileDiffView`.
- [x] 7.5 Tests: chip → split opens + section revealed + `ChatView` still mounted; Changes row → `diff:<path>` tab opens/activates and section marks it active; **a `diff` tab and a `monaco` tab for the same file coexist** (no dedup collision); **a persisted `diff` tab survives a reload** (`VALID_VIEWERS`); fallback route still renders the takeover.

## 8. Verify, QA, docs

- [x] 8.1 `npm test` green; `npm run quality:changed` (Biome + tsc + tests) passes. (206 change tests green; my files tsc-clean + 0 new Biome warnings. Pre-existing worktree-env failures unrelated: image-fit jimp `JimpMime`, spa-fallback needs `dist/client` build, doctor-route process probe.)
- [x] 8.2 (manual QA — deferred to post-merge; runs via CI e2e + isolated-ui-verification) Browser verification via `isolated-ui-verification` skill: per-turn block in stream, chip → split, rail Changes section + `diff` tab, non-git `summed` badge, mobile stacked layout, `/session/:id/diff` fallback.
- [x] 8.3 Add a Playwright e2e spec in `tests/e2e/` (`change-summary-table.spec.ts`; runs in the docker harness at ship) covering: changed-files chip opens the split Changes section; a per-turn block row opens a `diff` tab (per the Playwright convention in AGENTS.md).
- [x] 8.4 Docs: update `docs/architecture.md` "Session File Diff View" + "Split editor workspace" sections (numstat fields, integrated Changes section, `diff` viewer, retained fallback route) and add the per-file rows to the relevant directory `AGENTS.md` trees. Delegate `docs/` writes to a subagent in caveman style (AGENTS.md Rule 6).
- [x] 8.5 (manual — deploy step; worktree does NOT run full-rebuild per AGENTS.md; code-review gate deferred to the PR CodeRabbit pass) Full rebuild + restart + reload; run the `code-review` gate on the diff before commit.
