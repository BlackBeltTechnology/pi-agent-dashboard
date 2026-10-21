# Test Plan — add-composer-dock

Stage: design   Generated: 2026-10-21

Hard gate resolved before writing (user answers, folded into `specs/composer-dock/spec.md`):
- X1: a failed session-diff refetch keeps the last good list with an inline `Couldn't refresh changes` + Retry.
- X2: a failed tasks fetch shows `Couldn't load tasks` + Retry + `Open tasks.md`.
- X3: Kill shows `Stopping…`, then `Still running` after two more scans.

Levels: L1 = vitest (`packages/*/src/**/__tests__`); L3 = Playwright vs the docker harness (`tests/e2e/*.spec.ts`, port from `.pi-test-harness.json`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | composer-dock: Lanes render only with content, in a fixed order | decision-table | L1 | automated | session with 2 bg processes, 4 changed files, attached `add-auth`, 2 follow-ups, one `composer-context-group` claim | render dock | lane `role=group` names in DOM order: Processes, Changes, OpenSpec, Queue, Context |
| E2 | composer-dock: Dock renders above the composer card (quiet) | decision-table | L1 | automated | no OpenSpec dir, no `gitWorktree`, no processes/files/queue/claims, YOLO off | render | no element with `data-testid="composer-dock"` in the document |
| E3 | composer-dock: worktree session always has its Changes lane | EP | L1 | automated | `gitWorktree={name:"os-x",base:"develop"}`, `gitStatus` all zero, 0 files | render | one Changes lane with branch, `← develop`, no-local-changes marker and worktree actions |
| E4 | composer-dock: read-only archived view has no dock | state | L1 | automated | archived session opened read-only, YOLO active for its cwd | render App stack | no `composer-dock` and no `yolo-composer-strip` in the content area |
| E5 | composer-dock: Processes lane lists running work in three groups | decision-table | L1 | automated | (a) 3 plugin subagents + 1 bash + 2 bg; (b) 2 bg only; (c) 1 bash only; (d) plugin reports 2, nothing else | render collapsed | header (a) `6 running` · `3 subagents · 1 command · 2 background`; (b) `2 background processes`, no group headings; (c) `1 command`; (d) lane renders naming `2 subagents` |
| E6 | composer-dock: Compact dock below 520 px | BVA | L1 | automated | composer column width 521 / 520 / 519 px at 16 px root (mocked ResizeObserver) | render | rows / rows / chips |
| E7 | chat-view: Mobile composer adaptation (fold steps) | BVA | L3 | automated | composer container 881/879, 641/639, 421/419 px, streaming | load harness session, resize pane | after-turn label shown/hidden at 880; status word visible/sr-only at 640; delivery chip present/absent and Steer+Queue inside `＋` at 420 |
| E8 | composer-dock: Count and totals cover the same files | EP | L1 | automated | diff: 4 in-cwd files totalling +120 −33 and 1 out-of-cwd `previewable:false` entry | render Changes lane | header `4 files +120 −33`; out-of-cwd row has no diff link |
| E9 | design D5: server file cap | BVA | L1 | automated | diff returns exactly 200 owned files | render header | header shows `200+` files |
| E10 | composer-dock: No server totals | EP | L1 | automated | diff with 3 files and no `totalAdditions`/`totalDeletions` (non-git) | render header | `3 files changed` with no `+` or `−` values |
| E11 | composer-dock: Bash-created file is marked | EP | L1 | automated | entry with `detectedVia:"bash-artifact"` | render row | row shows `via bash` |
| E12 | composer-dock: Attached OpenSpec lane carries the change, one primary and its next tasks | EP | L1 | automated | attached `add-auth`, IMPLEMENTING, 12/39, `apply` enabled | render lane + open `⋯` | title `add-auth` + `12/39 tasks`; Apply primary; `⋯` lists Explore…, Open proposal, Refresh, Detach |
| E13 | composer-dock: Dock and session card choose the same OpenSpec actions | decision-table | L1 | automated | every `ChangeState` × workflow config fixture used by the session-card tests | render lane and card helper | same primary id for each combination; same workflow-item set |
| E14 | composer-dock: At most one filled primary in the dock | decision-table | L1 | automated | COMPLETE change, PR open, not draft, checks passing, all worktree-lifecycle Merge conditions true | render dock | exactly one filled primary (Merge); OpenSpec primary outlined and enabled |
| E15 | composer-dock: Untraceable attachments keep a traceable OpenSpec lane | EP | L1 | automated | ended session attached to `add-auth`, resolves archived `2026-10-01` | render | name, `Archived 2026-10-01`, archive letters, `⋯` with only Detach; no lifecycle bar or primary |
| E16 | composer-dock: Queue lane hosts the follow-up cycler | BVA | L1 | automated | 1 follow-up, then 2 follow-ups | render, click Clear all | 1 → `1 queued follow-up`, no Clear all; 2 → `2 queued follow-ups` + Clear all sends `clear_followup_entries {indices:"all"}` |
| E17 | composer-dock: Context lane (Status gate) | decision-table | L1 | automated | streaming; `session-card-badge` claim with a button; Quota `composer-context-group` with a button | render | badge button disabled; Quota button enabled, full opacity |
| E18 | composer-dock: Context lane leaves no trace when every group is empty | EP | L1 | automated | two claims whose components return null | render | no visible Context lane, label or container |
| E19 | design D8 / model-selector role display | EP | L1 | automated | user picks role `@fast` resolving to `claude-haiku-5-5`, level `low` | pick in chip popover | chip face shows the model with `from @fast` and `low`; accessible name contains model and level |
| E20 | chat-view: Delivery mode is a visible Steer/Queue control | decision-table | L1 | automated | draft `hi`; delivery Steer/Queue × key Enter/Alt+Enter | keypress | Steer+Enter → `steer`; Steer+Alt+Enter → `followUp`; Queue+Enter → `followUp`; Queue+Alt+Enter → `followUp` |
| E21 | chat-view: Toolbar row never overflows | BVA | L3 | automated | longest model id in the harness catalogue; composer 881 px and 421 px | render | chip text ends in an ellipsis; toolbar `scrollWidth == clientWidth` |
| E22 | composer-dock: Kill and Stop are worded differently | EP | L1 | automated | streaming session with 1 bg process, Processes open | render | row action text `Kill`; composer action name `Stop` |
| E23 | design D7 test-id migration | EP | L1 | automated | full-feature session | render CommandInput + dock | every "kept" id in D7 present; `composer-context-strip`, `status-bar`, `composer-session-actions`, composer `overflow-button`/`overflow-menu` absent |
| E24 | chat-view: Composer card has an input row and one toolbar row | EP | L1 | automated | idle, draft `Run the tests.` | render | `composer-input-row` contains only the textarea; `send-button` is the last child of `composer-settings-row`; `＋` menu has `open-inline-terminal-button` |
| E25 | composer-dock: Not-yet-started subagent is marked | EP | L1 | automated | plugin rows mode, subagent status `created` | render row | row shows `pending`, no elapsed time |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D5 / Risks (diff refetch cost) | tail-latency | L1 | automated | `buildSessionDiff` + git enrichment over a temp git repo with 200 changed files | p95 < 300 ms over 20 runs | 20 sequential runs |
| P2 | composer-dock: Dock announces counts, never ticking times (tick isolation) | render-count | L1 | automated | dock with 2 bg rows + 1 subagent row, fake timers | `ComposerDock` and lane component render count +0 across 10 × 1 s ticks; only elapsed leaves re-render | 10 ticks |
| P3 | composer-dock: Dirty-count flapping while working | rate-bound | L1 | automated | (a) 10 dirty-count changes in 3 s while working; (b) same while idle | (a) 0 requests until working ends; (b) ≤ 2 requests | 3 s fake time |
| P4 | design D2 (flip evaluation per frame) | rate-bound | L1 | automated | 60 ResizeObserver callbacks within one animation frame | ≤ 1 layout-mode evaluation per frame | 1 frame |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | composer-dock: Lanes start collapsed and open one at a time (accordion) | state-transition | L1 | automated | Processes expanded | expand Changes | Changes `aria-expanded=true`, Processes `false` |
| F2 | composer-dock: New content does not expand a lane | state-transition | L1 | automated | all lanes collapsed | new bg process arrives in `session.processes` | every lane `aria-expanded=false` |
| F3 | composer-dock: collapsed whenever a session binds | state-transition | L1 | automated | s1 with Changes expanded | select s2, then s1 again | every lane of s1 collapsed |
| F4 | composer-dock: no auto-expand on lane return | state-transition | L1 | automated | Processes expanded, last process exits (lane gone) | a new process appears | Processes lane renders collapsed |
| F5 | composer-dock: Layout flip keeps the open lane and focus | state-convergence | L1 | automated | Changes open; focus (a) inside the lane, (b) on the textarea | column 521 → 519 px; then 20 alternating 519/521 resizes | Changes chip `aria-expanded=true` with sheet; (a) focus on the Changes chip; (b) focus stays on the textarea throughout |
| F6 | composer-dock: Dock announces counts, never ticking times | invariant | L1 | automated | 2 bg processes, fake timers | elapsed 59 s → 1 m 0 s; then a 3rd process | live region text unchanged by the tick; changes exactly once to include `3 background` |
| F7 | dashboard-shell-slots: Summary mode renders no DOM | invariant | L1 | automated | fake claim reporting `{count:2,noun:"subagents"}`, lane collapsed | mount dock | claim adds 0 DOM nodes; header names 2 subagents |
| F8 | dashboard-shell-slots: Unmount drops the summary | state-transition | L1 | automated | claim reporting 3 | disable the plugin (unmount claim) | header no longer counts 3 subagents; lane gone if nothing else runs |
| F9 | composer-dock: YOLO footer stays visible in the dock (scroll) | state-convergence | L3 | automated | YOLO scoped, Processes expanded with 12 rows, pane 600 px tall | scroll the lane region | footer bounding box stays fully inside the dock and the viewport at every scroll position |
| F10 | composer-dock: Footer meets the YOLO verified set inside the dock | BVA | L3 | automated | viewports 375/768/1500 × `en`/`hu` × scoped/unscoped | render | footer height = 32 px (one line); time fully visible; link accessible name == full description; time not in link name; no live-region ancestor |
| F11 | composer-dock: Footer in compact mode | EP | L1 | automated | column 375 px, YOLO unscoped, 4 lanes | render | 4 chips + one full-width footer line; no YOLO chip |
| F12 | composer-dock: Canvas chip tray anchor | state-convergence | L3 | automated | (a) dock present; (b) quiet session, no dock | open a canvas server chip | tray bottom tracks (a) dock top edge, (b) card top edge |
| F13 | composer-dock: Dock is a shrinkable row (short pane) | BVA | L3 | automated | pane height = floor sum − 50 px, YOLO on, lanes present | render | lanes scroll; footer and composer card fully visible; transcript ≥ its declared floor |
| F14 | composer-dock: Footer-only dock keeps floor above bound | BVA | L1 | automated | `CHAT_PANE_ROW_TABLE` entries `composer-dock` and `composer-dock:footer-only` | completeness test | `floor > bound` for every entry; footer-only bound == `YOLO_FOOTER_HEIGHT` |
| F15 | composer-dock: Folder home composer renders the dock | EP | L1 | automated | folder home, YOLO active for the folder | render DirectoryHomeView | dock with only the footer directly above the composer card |
| F16 | markdown-preview-view: replacing canvas hides the dock | EP | L3 | automated | 767 px viewport, dock with lanes | open a preview | ChatView, dock and CommandInput hidden; preview shown |
| F17 | chat-display-preferences: View menu in the session header | EP | L1 | automated | selected session | render header, open View | `ChatViewMenu` right after the layout switch; popover below the trigger; absent from composer and dock |
| F18 | ui-contract tokens / a11y #1 (dock + card contrast) | contrast probe | L3 | automated | full-feature session in base dark, base light, nord dark | computed-contrast helper over dock + card | 0 text contrast failures, 0 text < 11 px (< 12 px interactive) |
| F19 | chat-view: Single focus indicator | EP | L3 | automated | idle composer | focus textarea | card border = focus colour ≥ 3:1; textarea has no outline/box-shadow ring |
| F20 | mockup fidelity (tucked dock look, spacing vs approved board) | visual | — | manual-only | approved board `mockups/composer-dock/index.html#s1` | human compares the built dock in 3 themes | [judgment: matches the approved board — no automatable observable] |
| F21 | chat-view: status word sr-only below 640 px | EP | L3 | automated | streaming, composer 375 px | render | working-status text not visible (clipped) but present in the accessibility tree; status shape visible |
| F22 | composer-dock: Sub-session process links to its session | EP | L1 | automated | bg process `kind:"sub-session"`, `sessionRef:"s9"` | click the row link | navigation to session `s9` |
| F23 | chat-view: Stop-after-turn joins the stop control | EP | L1 | automated | streaming | render | `stop-after-turn-button` immediately precedes `stop-button` inside one `role=group` named `Stop options` |
| F24 | chat-view: Force-stop is not colour-only | state-transition | L1 | automated | streaming, `onForceKill` set | activate Stop once | `force-stop-button` glyph path differs from `stop-button` glyph path |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | composer-dock: Changes lane keeps the last good list when a refetch fails | fault-injection (abort) | L1 | automated | `/api/session-diff` returns HTTP 500 after a good 4-file response | session stops working; then Retry with a 5-file success | 4 files + totals stay with one `Couldn't refresh changes` + Retry; after Retry 5 files and no error line |
| X2 | composer-dock: OpenSpec task list shows a recoverable error | fault-injection (abort) | L1 | automated | `/api/openspec/tasks` returns HTTP 404 | expand attached lane | body shows `Couldn't load tasks`, Retry, `Open tasks.md`; header still has the primary |
| X3 | composer-dock: Kill shows progress until the process is gone | state-transition | L1 | automated | process group 60105 | Kill; scans: (a) next scan without 60105; (b) next scan lists it + 2 more scans list it | Kill sends `kill_process {pgid:60105}`; row `Stopping…`, Kill disabled; (a) row gone; (b) `Still running`, Kill enabled |
| X4 | composer-dock: Trigger during an in-flight request is not lost | fault-injection (delay) | L1 | automated | diff request stalls 4 s | session stops working 3 s after the request started | exactly one further request starts after the stalled one settles |
| X5 | composer-dock: Refetches are coalesced | fault-injection (delay) | L1 | automated | none | session stops working and dirty count changes within 1 s | exactly 1 session-diff request |
| X6 | dashboard-shell-slots: contribution crash isolation | fault-injection (throw) | L1 | automated | `composer-dock-process-group` component throws in `"summary"` and in `"rows"` mode | render dock | `[slot-error-boundary]` log line; that claim's count absent from header; Commands and Background groups still render |
| X7 | composer-dock: dock converges after WS reconnect | state-convergence | L1 | automated | open Processes lane; reconnect snapshot replaces `session.processes` with 1 new process | apply reconnect snapshot | Processes lane lists exactly the snapshot's process; lane still expanded (same session bound) |
| X8 | composer-dock: Partial history does not undercount | EP | L1 | automated | transcript holds only the latest page; diff lists 9 files | render Changes lane | header shows 9 files |
| X9 | composer-dock: Plugin disabled | EP | L1 | automated | no `composer-dock-process-group` claim; 1 bash + 2 bg | render | Commands + Background groups only; no subagent group |
| X10 | chat-view + gate 0.1: claimed toolbar action on phone | BVA | L3 | automated | a fake `composer-toolbar-action` claim (44 px) + streaming, composer 375 px | render | toolbar `scrollWidth == clientWidth`; action button fully visible |
| X11 | chat-view: Toolbar row never overflows (root font 200%) | BVA | L3 | automated | root font-size 32 px, composer 880 px | render | toolbar `scrollWidth == clientWidth`; fold thresholds fire earlier (rem) |
| X12 | popover-viewport-positioning: `＋` menu height bound | BVA | L3 | automated | viewport 375 × 500, composer at bottom, `＋` holding terminal + Steer/Queue + folded chip | open `＋` | menu fully on-screen; its list scrolls; height ≥ 120 px floor or = available space |
| X13 | chat-view: team-app composer unaffected | regression | L3 | automated | team-app agent chat pane | run `tests/e2e/team/team-skills.spec.ts` | spec passes with the new toolbar (no dock); `invalid` border shows on an unavailable `/skill:` |

---

## Coverage summary

- Requirements covered: all composer-dock requirements (29/29) plus the chat-view ADDED/MODIFIED (6/6), dashboard-shell-slots ADDED (3/3), and the changed rows in chat-display-preferences, model-selector, popover-viewport-positioning, markdown-preview-view and split-editor-workspace.
- Scenarios by class: edge 25 · perf 4 · frontend 24 · error 13
- Scenarios by level: L1 51 · L3 14 · — 1
- Scenarios by disposition: automated 65 · manual-only 1

## New infra needed

- none. L1 needs a mocked `ResizeObserver` (already used by client tests) and fake timers; L3 reuses the docker harness, `tests/e2e/helpers/computed-contrast.ts` and the existing `yolo-indicator-layout.spec.ts` locale setup.
