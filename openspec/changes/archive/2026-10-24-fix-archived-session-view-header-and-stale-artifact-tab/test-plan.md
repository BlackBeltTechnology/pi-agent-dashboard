# Test Plan — fix-archived-session-view-header-and-stale-artifact-tab

Stage: design   Generated: 2026-10-24

HARD gate: one gap raised (frozen-underlay reachability) and answered via
`ask_user` → scenario dropped, recorded as a design.md Non-goal. No open
clarifications.

Requirement refs:
- **R-H** archived-session-listing "Read-only archived view renders the session header"
- **R-P** archived-session-listing "Read-only archived view scopes the editor pane to the archived folder"
- **R-M** internal-monaco-editor-pane "Missing artifact of an archived change offers the archived copy"
- **R-S** session-card-seek "Seek control reveals the active session's card" (MODIFIED carve-out)

L3 seeding: archived session sidecar via `docker exec` (as `tests/e2e/archive-fold.spec.ts`);
OpenSpec change moved into `openspec/changes/archive/<date>-<name>` via `docker exec`
(as `tests/e2e/archived-attachment.spec.ts`); persisted tab via `page.addInitScript`
writing `pi-dashboard:editor-pane:<id>`. Port from `.pi-test-harness.json`.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R-H (D1) | decision-table | L1 | automated | `sessions` = {live-1}; summaries = {arch-1}; rows: (live-1, ro=arch-1), (arch-1, ro=arch-1), (arch-1, ro=arch-1, no summary), (arch-1, ro=undefined), (undefined id) | `viewedSession(id, sessions, ro, summaries)` | live row by identity; synthesized row `{id:"arch-1", status:"ended", cwd:"/repo", sessionFile}`; `undefined`; `undefined`; `undefined` |
| E2 | R-M | EP | L1 | automated | `openspec/changes/add-x/proposal.md`, `openspec/changes/add-x/specs/cap/spec.md`, `openspec/changes/archive/2026-01-01-add-x/proposal.md`, `docs/proposal.md`, `openspec/changes/add-x` | `activeChangeOfPath(path)` | `add-x`, `add-x`, `null`, `null`, `null` |
| E3 | R-M | EP | L1 | automated | `openspec/changes/add-x/specs/cap/spec.md` + entries [`2026-10-22-add-x`, `2026-10-22-other`] | `archivedArtifactPath` | `openspec/changes/archive/2026-10-22-add-x/specs/cap/spec.md` (sub-path kept) |
| E4 | R-M "Newest same-name archive wins" | BVA (ordering) | L1 | automated | entries in input order [`2026-03-04-add-x`, `2026-01-02-add-x`] and reversed | `archivedArtifactPath(".../add-x/tasks.md")` | both orders → `…/archive/2026-03-04-add-x/tasks.md` (pick by `date`) |
| E5 | R-M "No archive entry" | EP | L1 | automated | path `openspec/changes/add.x/proposal.md`; entries [`2026-10-22-add-x-two`, `2026-10-22-addyx`] | `archivedArtifactPath` | `null` (exact, regex-escaped name match only) |
| E6 | R-H, R-S | decision-table | L1 | automated | `SessionHeader` with synthesized ended row (`sessionFile` set), `onRename`/`onSetTags`/`onSeekToCard`/`onResume` undefined, desktop width | render, open title menu | no `session-header-seek-card`, no `header-resume-button`, no `header-fork-button`, no tag editor; title menu lists no Rename / Reveal in sidebar / Edit tags; layout switch present |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R-H "embed mode" | state-convergence | L3 | automated | seeded archived session `<id>` named "E2E archived" | `goto /session/<id>?archived=1&embed=1` | header converges to "E2E archived" + layout switch + `embed-exit`; MutationObserver records "No session selected" never appeared |
| F2 | R-H "outside embed" | state-convergence | L3 | automated | same seed | `goto /session/<id>?archived=1&embed=0` | header shows "E2E archived" + layout switch; "No session selected" never appeared |
| F3 | R-H "no mutating controls", R-S | decision-table | L3 | automated | F2 state, desktop viewport | inspect header, open title menu | 0 × `session-header-seek-card`, `header-resume-button`, `header-fork-button`, tag editor; menu has no Rename / Reveal in sidebar / Edit tags |
| F4 | R-P "restored tab", R-M "Stale proposal tab" | state-transition | L3 | automated | seeded archived session; init script persists tab `openspec/changes/e2e-stale/proposal.md` + split mode; change moved to `archive/<today>-e2e-stale` | open `/session/<id>?archived=1`, click `editor-open-archived` | before click: pane text contains `File no longer exists: openspec/changes/e2e-stale/proposal.md` and `<today>-e2e-stale`; no "HTTP 400" text; every `/api/file` request has non-empty `cwd`. After click: exactly one tab `openspec/changes/archive/<today>-e2e-stale/proposal.md`, proposal heading rendered |
| F5 | R-M "Stale proposal tab" | state-transition | L1 | automated | `EditorPane` (cwd `/proj`), stale tab, probe 404, archive [`2026-10-22-add-x`] | open tab, click `editor-open-archived` | notice text contains `File no longer exists: openspec/changes/add-x/proposal.md` AND `2026-10-22-add-x`; after click persisted `openFiles` == [archived path], `viewer-markdown` mounted |
| F6 | R-M "Archived copy already open" | state-transition | L1 | automated | tabs [archived path, stale path], stale active, probe 404 for stale only | click `editor-open-archived` | `openFiles` == [archived path], active index 0, no duplicate |
| F7 | R-M "Archived copy itself missing" | state-transition | L1 | automated | stale tab; both stale and archived paths probe 404; archive has the entry | click `editor-open-archived` | one tab (archived path) showing only `File no longer exists: openspec/changes/archive/2026-10-22-add-x/proposal.md`; no `editor-open-archived` |
| F8 | R-M "listing pending" | state-convergence | L1 | automated | stale tab probe 404; `/api/openspec-archive` held unresolved | open tab, then resolve listing with [`2026-10-22-add-x`] | while pending: only `editor-file-missing` text, no `editor-open-archived`; after resolve: archived notice appears without reopening the tab |
| F9 | R-M "Other missing files never read the archive" | decision-table | L1 | automated | tabs `src/gone.ts` and `openspec/changes/archive/2026-01-01-add-x/proposal.md`, both probe 404 | open each | plain `File no longer exists: <path>`; 0 requests to `/api/openspec-archive` |
| F10 | R-P "Live sessions unaffected" | EP | L1 | automated | `EditorPane` cwd `/proj`, tab `src/ok.ts` exists | open tab | `viewer-monaco` mounted, no missing/archived notice, 0 archive requests (regression guard on existing X5) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R-M "No archive entry" | fault-injection (abort: no match) | L1 | automated | probe 404, archive [`2026-10-22-other`] | open stale tab | only `File no longer exists: openspec/changes/add-x/proposal.md`; no `editor-open-archived` |
| X2 | R-M "listing failed" | fault-injection (abort) | L1 | automated | probe 404; `/api/openspec-archive` → `{success:false}` and, separately, network reject | open stale tab | only the plain missing message in both cases; no throw |
| X3 | R-P "Pane while … loading", R-H "Summary still loading" | fault-injection (delay) | L3 | automated | `page.route('/api/sessions/archived/<id>')` held 3 s; persisted tab as F4 | open `/session/<id>?archived=1` | during hold: header shows "Loading archived session…", never "No session selected"; 0 `/api/file` requests with empty `cwd`. After release: header name, file probed once with the archived cwd |
| X4 | R-H "Summary fetch fails", R-P | fault-injection (abort) | L3 | automated | `page.route('/api/sessions/archived/<id>')` → 404 | open `/session/<id>?archived=1` with persisted tab | header shows "Archived session unavailable"; pane shows the same notice; 0 `/api/file` requests with empty `cwd`; no "No session selected" |
| X5 | R-P (D4 provider guard) | fault-injection (bad input) | L1 | automated | `SplitWorkspaceProvider` cwd `""`, persisted open tab, `onWatchFiles` + `onFilenameSearch` spies | mount, switch to split mode, trigger filename search | `onWatchFiles` and `onFilenameSearch` never called while cwd is `""`; after rerender with cwd `/proj`, `onWatchFiles` called with `/proj` |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | R-H, R-M | visual/subjective | — | manual-only | Claude desktop embed pane (narrow) on `/session/<id>?archived=1&embed=1` with stale tab | look at header + notice | [judgment: header and archived notice read cleanly at narrow width — no automatable observable] |

---

## Coverage summary

- Requirements covered: 4/4 (R-H, R-P, R-M, R-S)
- Scenarios by class: edge 6 · perf 0 · frontend 10 · error 5 · manual 1
- Scenarios by level: L1 15 · L2 0 · L3 6 · manual 1
- Scenarios by disposition: automated 21 · manual-only 1

## New infra needed

- none (L3 reuses archive-fold seeding + archived-attachment change-move + `page.route`)
