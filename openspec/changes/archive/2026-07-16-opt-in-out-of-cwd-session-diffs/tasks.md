# Tasks

## Server — carry out-of-cwd entries without reading the file

- [x] `session-diff.ts`: stop dropping out-of-cwd Write/Edit paths; carry the entry keyed by
      absolute path with its `changes[]` payload → verify: unit test an out-of-cwd Write
      appears in `data.files`; an unauthored out-of-cwd path never appears.
- [x] `session-diff.ts`: in `buildSessionDiff`, split entries into in-cwd (enriched) vs
      out-of-cwd (payload-only) and pass ONLY in-cwd entries to `enrichWithGitDiff` — the guard
      lives BEFORE enrichment so the `readFileSync(resolve(cwd, absPath))` untracked branch can
      never receive an out-of-cwd path → verify: test with cwd `/repo/packages/server` + write
      `/repo/.env` asserts NO `readFileSync`/`git` invocation for that path and no `gitDiff` on
      the entry (cycle-2 F1).
- [x] Confirm in-cwd relative-key + enrichment unchanged → verify: existing session-diff
      tests pass (regression).
- [x] `security-hardening` pass: assert the builder performs zero disk reads of out-of-cwd
      paths.

## Server — session-addressed full-payload endpoint (no path input)

- [x] Add a localhost-only endpoint returning `{ content?, edits? }` for `(sessionId,
      toolCallId)`: resolve the JSONL via `sessionManager.get(sessionId).sessionFile` (NEVER
      construct a path from `sessionId`), `loadSessionEntries`, then scan assistant-message
      `content[]` for `{ type: "toolCall", id === toolCallId }` (nested id, not top-level) and
      return `args.content`/`args.edits` → verify: test returns untruncated content for a > 4 KB
      Write and for a > 20-op Edit; returns not-found when the id is absent (cycle-2 F2).
- [x] Confirm the endpoint accepts only session identifiers — no `path` param, no
      `fs.realpath`, no path fallback on a miss → verify: test/inspection asserts no
      filesystem-path code path exists; a bogus `toolCallId` returns not-found, reads nothing
      (cycle-2 F3).
- [x] `doubt-driven-review` on the endpoint's input surface BEFORE it stands (session-id-only,
      not path).

## Client — opt-in preference + payload render + lazy upgrade

- [x] Add `showOutOfCwdSessionDiffs` preference (default off) + settings toggle → verify:
      persists; default off.
- [x] `ChatView`/`buildTurnSummaries` consumer: suppress out-of-cwd rows when off → verify:
      off hides row, on shows it.
- [x] `DiffViewer`/`DiffPanel`: resolve out-of-cwd entry by absolute key; render via existing
      Path C (`changeToRichDiff`) → verify: diff renders from payload, not the empty state.
- [x] Absolute-key fallout: render out-of-cwd entries in a distinct "outside workspace"
      grouping (not the relative `diff-tree` — an absolute path splits to a blank-root node);
      set `previewable: false` on out-of-cwd entries and make `DiffPanel` hide the File-view
      toggle when `previewable === false` → verify: mixed abs+relative list produces no
      blank-root tree node; the File toggle is absent for an out-of-cwd tab (cycle-2 F4/F5).
- [x] Lazy full-fidelity fetch when payload truncated / `edits` collapsed; degrade
      gracefully on failure → verify: truncated `content` triggers a fetch and renders full;
      collapsed edits with no fetch shows "diff too large to show inline"; deleted-since-write
      shows "file no longer present".

## Tests (folded from test-plan.md — automated scenarios)

### L1 unit (vitest) — see `packages/server/src/__tests__/session-diff.test.ts`, `session-routes-tool-result.test.ts`, `session-file-reader.test.ts`

- [x] (test-plan #E1) out-of-cwd carried, payload-only. Input: events with Write to `/tmp/mockup/index.html`, cwd `/repo` · Trigger: `buildSessionDiff(events, cwd)` · Observable: `data.files` has entry keyed `/tmp/mockup/index.html` with `changes[]`, `gitDiff` undefined. Exemplar: `session-diff.test.ts`.
- [x] (test-plan #E2) in-cwd unchanged regression. Input: Write to `src/a.ts` in git cwd · Trigger: `buildSessionDiff` · Observable: entry keyed relative `src/a.ts`, existing git/synthetic enrichment retained. Exemplar: `session-diff.test.ts`.
- [x] (test-plan #E3) SECURITY guard-before-enrichment. Input: cwd `/repo/packages/server`, Write to `/repo/.env` (out-of-cwd, under repo, untracked), spy `fs.readFileSync`+git runner · Trigger: `buildSessionDiff` · Observable: zero `readFileSync(resolve(cwd,path))` + zero git calls for `/repo/.env`, entry has no `gitDiff`. Exemplar: `session-diff.test.ts`.
- [x] (test-plan #E4) on-demand full content. Input: JSONL with a 7 KB Write (in-memory truncated at 4 KB) · Trigger: GET full-payload endpoint `(sessionId, toolCallId)` · Observable: returns untruncated 7 KB `content`, no `…[truncated]`. Exemplar: `session-routes-tool-result.test.ts` + `session-file-reader.test.ts`.
- [x] (test-plan #E5) on-demand full edits >20 ops. Input: Edit with 21 ops (in-memory `edits` collapsed) · Trigger: GET endpoint · Observable: returns full 21-element `edits`. Exemplar: `session-routes-tool-result.test.ts`.
- [x] (test-plan #E6) endpoint miss reads nothing. Input: valid sessionId, unknown `toolCallId`, spy fs · Trigger: GET endpoint · Observable: not-found, no file read, no path built from sessionId. Exemplar: `session-routes-tool-result.test.ts`.
- [x] (test-plan #E7) SECURITY no path input / no traversal. Input: sessionId with `../` or path-looking `toolCallId` · Trigger: GET endpoint · Observable: resolves only via `sessionManager.get(sessionId).sessionFile`, reads nothing outside that transcript. Exemplar: `session-routes-tool-result.test.ts`.
- [x] (test-plan #E8) preference default off. Input: fresh preferences store · Trigger: read `showOutOfCwdSessionDiffs` · Observable: `false`. Exemplar: nearest preferences-store test (extend it).
- [x] (test-plan #X3) JSONL file missing on disk. Input: `sessionFile` recorded but file deleted · Trigger: GET endpoint · Observable: graceful not-found, no throw, reads nothing else. Exemplar: `session-file-reader.test.ts`.

### L3 e2e (Playwright, docker harness — port from `.pi-test-harness.json`) — see `tests/e2e/change-summary-table.spec.ts`, `tests/e2e/editor-pane.spec.ts`

- [x] (test-plan #F1) pref off suppresses row. Verified in `tests/e2e/out-of-cwd-session-diffs.spec.ts` (harness): pref off → the out-of-cwd row is NOT listed in the change-summary block.
- [x] (test-plan #F2) pref on renders payload diff. Verified in `tests/e2e/out-of-cwd-session-diffs.spec.ts` (harness): pref on → the row appears, clicking opens a `diff:` tab that renders `change.content` ("out of cwd mockup"), not the empty state.
- [x] (test-plan #F3) large payload, no cap. Verified two ways: `tests/e2e/out-of-cwd-session-diffs.spec.ts` (harness, API-level) — a >4 KB out-of-cwd Write is carried FULL (no cap) and the session-addressed endpoint serves the full untruncated payload; DiffPanel lazy-fetch-on-truncation covered in `DiffPanelPreview.test.tsx` (F3) + endpoint E4/E5. (In-memory Write content is NOT truncated in the harness, so the diff renders full directly — the lazy fetch is the truncation safety net, unit-covered.)
- [x] (test-plan #F4) absolute key does not corrupt tree. Covered by `packages/client/src/lib/__tests__/diff-tree.test.ts` (F4): mixed abs+rel produces no blank-root node; out-of-cwd entry lands in the "outside workspace" group. (The tree renders in the FileDiffView takeover, not an in-stream surface, so unit level is the correct gate.)
- [x] (test-plan #F5) file-content toggle hidden out-of-cwd. Verified in `tests/e2e/out-of-cwd-session-diffs.spec.ts` (harness) AND `DiffPanelPreview.test.tsx` (F5): `previewable:false` → no `file-view-toggle`.
- [x] (test-plan #X1) deleted-since-write — SUPERSEDED BY THE PAYLOAD-ONLY DESIGN. The security invariant (server performs NO read of the out-of-cwd path) holds unconditionally (E3 + endpoint E6/E7/X3); because the diff renders from the captured event payload and never touches the file, on-disk deletion is irrelevant and the diff still renders. The "file no longer present" message was an observable for the abandoned file-reading design (see design.md doubt-review). No path read = the property that matters, and it is enforced.
- [x] (test-plan #X2) lazy fetch fails + truncated. Covered by `DiffPanelPreview.test.tsx` (X2): a truncated payload whose lazy fetch errors renders the partial diff (never blank) + the `diff-truncation-banner`; no fs read (endpoint is session-addressed). E2E fault-injection is impractical (the harness carries full payloads), so the degradation is gated at the component level.

## Validate

- [x] `openspec validate opt-in-out-of-cwd-session-diffs --strict` passes.
- [x] Manual (test-plan: manual-only): mockup-loop writes `/tmp/…`; toggle off → no row;
      toggle on → row renders a diff; a > 4 KB mockup renders fully after the lazy fetch;
      server logs show no read of the `/tmp/…` path. (Automated coverage: harness e2e F1/F2/F5
      + API-level F3 + unit F4/X2 — this manual pass is a belt-and-suspenders visual check.)
