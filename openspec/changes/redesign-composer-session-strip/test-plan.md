# Test Plan — redesign-composer-session-strip

Stage: design   Generated: 2026-09-27

Hard gate cleared. One gap was found and resolved by the user: the git-poll tick has **no latency threshold**. P1 instead asserts structurally that the tick never awaits `gh`. Every other Triple is filled from the delta specs, design D1–D9 and the explore-session decisions.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | git-context: PR detection — checks summary | decision-table | L1 | automated | rollups: [] · [CheckRun SUCCESS] · [StatusContext SUCCESS] · [CheckRun SKIPPED, NEUTRAL] · [CheckRun FAILURE, CheckRun IN_PROGRESS] · [CheckRun TIMED_OUT, CheckRun SUCCESS] · [CheckRun STALE] · [StatusContext ERROR] · [StatusContext PENDING] · [StatusContext EXPECTED] · [CheckRun conclusion "WEIRD"] | `collapseCheckRollup(rollup)` | none · passing · passing · passing · failing · failing · failing · failing · pending · pending · pending |
| E2 | git-context: PR detection — classification | EP | L1 | automated | `gh` result: exit 0 + JSON `{number:747,state:"OPEN",isDraft:false,url,statusCheckRollup:[]}` · exit 1 + stderr `no pull requests found for branch "x"` · exit 1 + stderr `HTTP 401` · exit 4 · timeout at 20 s · ENOENT | run `GH_PR_STATUS` classifier | parsed (`state:"open"`) · absent · failure · failure · failure · failure |
| E3 | worktree-lifecycle: Merge primary rule | decision-table | L1 | automated | `isMergePrimary` over hasWorktree {t,f} × prState {open,draft-open,closed,merged,absent} × checks {passing,none,pending,failing} × checkedAt {now−1 min, now−20 min} × working {t,f} × attached {no, COMPLETE, IMPLEMENTING, unknown} | evaluate | true only for hasWorktree ∧ open ∧ ¬draft ∧ checks∈{passing,none} ∧ checkedAt ≤ 15 min ∧ ¬working ∧ (no change ∨ COMPLETE); every other row false |
| E4 | worktree-lifecycle: actions per PR state | decision-table | L1 | automated | `WorktreeActionsMenu` with PR {none, closed, open, draft, merged ahead 0, merged ahead 2} × gh {available, missing} | render | none/closed + gh: Push, Open PR, Merge, Close · none/closed − gh: Push, Merge, Close · open/draft: Push, Merge, Close · merged ahead 0: Close only · merged ahead 2: Push, Close; Close is always last after a separator |
| E5 | worktree-lifecycle: PR segment states | EP | L1 | automated | PR 747: draft · open+passing · open+failing · open+pending · merged · closed · number-only (legacy) · URL absent | render segment | `◌ #747 draft` · `● #747 open` + passing marker · failing marker · pending marker · `⑂ #747 merged` (no checks marker) · `⊘ #747 closed` (no checks marker) · `#747` only · plain text, no `<a>`; each non-legacy state exposes its state word in text or `aria-label` |
| E6 | chat-view: OpenSpec primary + overflow parity | decision-table | L1 | automated | `deriveOpenSpecActions` over state {PLANNING, READY, IMPLEMENTING, COMPLETE} × wf {all, core, all−archive} × {idle, working, ended, not-found} × includeDetach {t,f} | derive | the same primary key for both includeDetach values; overflow differs only by `detach`; ended / not-found → only `detach` (or empty when includeDetach=false); working → every item `blocked:true` except `detach` |
| E7 | chat-view: unattached OpenSpec group | EP | L1 | automated | unattached; changes {0, 3}; wf {all, core} | render `ComposerSessionActions` | `Attach change…` enabled with 3 / disabled "No changes" with 0; `composer-explore-btn` present; `⋯` lists New… / Propose… only when `wf` allows; no `composer-openspec-stepper`, no archive |
| E8 | chat-view: attached OpenSpec group | EP | L1 | automated | attached `add-auth`, IMPLEMENTING 12/39, wf all | render | chip text `add-auth`; `composer-stepper-segment-tasks` text `12/39`; `composer-apply-btn` present; `⋯` contains `Explore…` and no Detach; no standalone Explore button |
| E9 | chat-view: Git identity segment | EP | L1 | automated | (a) branch `os/x`, base `develop`, status dirty 3 ahead 2 · (b) base absent · (c) status all zero · (d) status absent · (e) branch absent | render Git group | (a) `os/x`, `← develop`, `3` with "3 changed files", `↑2`, no `↓` · (b) no `←` · (c) "no local changes" marker, no "in sync" text · (d) no drift / no-changes marker · (e) no `⎇` branch text |
| E10 | dashboard-shell-slots: ToolbarGroup semantics | EP | L1 | automated | label "Quota" (string) and `<b>Quota</b>` (node); testId `quota-context-group`; testId absent | render `ComposerContextGroup` | `getByRole("group",{name:"Quota"})` resolves in both cases; container `quota-context-group` + label `quota-context-group-label`; with no testId, no element has `data-testid="undefined-label"` |
| E11 | chat-view: host group test ids | EP | L1 | automated | attached worktree session with a badge claim | render `ComposerSessionActions` | present: `composer-openspec-group-label`, `composer-git-group-label`, `composer-status-group-label`, `composer-git-group`, `composer-status-group` (a `FIELDSET`) |
| E12 | chat-view: single filled primary (composer) | decision-table | L1 | automated | worktree + attached change {COMPLETE, IMPLEMENTING} × PR {open passing fresh, open failing} | render strip | COMPLETE+passing: Merge filled, OpenSpec Archive outlined · IMPLEMENTING+passing: Apply filled, Merge outlined · COMPLETE+failing: Archive filled, Merge outlined; exactly one filled primary in all rows |
| E13 | worktree-lifecycle: single filled primary (card) | decision-table | L1 | automated | same matrix as E12 on `SessionCard` | render card | the same filled / outlined outcome as E12 on the card |
| E14 | worktree-lifecycle: merge dialog warnings | EP | L1 | automated | `MergeConfirmDialog` with open PR 742 checks {failing, pending, passing, none}; checkedAt {1 min, 20 min}; closed PR failing | open dialog | "PR #742 checks are failing" / "…still running" warnings; none for passing / none; "PR status may be stale" at 20 min; closed PR → no checks warning; confirm enabled in all rows |
| E15 | chat-view: composer rows | EP | L1 | automated | `CommandInput` bound, idle | render | `send-button` and `open-inline-terminal-button` inside the input-row container; `＋`, model chip, thinking chip, delivery control inside the settings row; the settings row contains no `send-button` |
| E16 | chat-view: split stop control | state-transition | L1 | automated | streaming session | render; click `stop-after-turn-button` | `stop-after-turn-button` is the immediate previous sibling of `stop-button` within one split container; the click sends stop-after-turn, not abort; `stop-after-turn-pill` renders after the click |
| E17 | chat-view: focus indicator | EP | L1 | automated | `CommandInput` | focus the textarea | the textarea has no `focus-ring` class; the card carries the full-accent focused border class, and no 60 % mix class |
| E18 | git-context: server field pass-through | decision-table | L1 | automated | `git_info_update` with new fields {value, null, absent} × number {747, null} | server handles the message | value → stored; null → cleared; absent → untouched (old value kept); `gitPrNumber` null → cleared; broadcast payload mirrors the stored state |
| E19 | git-context: refresh targeting | decision-table | L1 | automated | sessions at `/r/.worktrees/x`, `/r/.worktrees/x/packages/c`, `/r/.worktrees/xy`, `/r`, and a symlink `/tmp/wt → /r/.worktrees/x`; action {push ok, pr ok, merge ok, push fail} | the server completes the action for `/r/.worktrees/x` | push / pr ok → `git_info_refresh` with the matching `reason` to the first two sessions and the symlinked one, NOT to `xy` or `/r`; merge ok and push fail → no refresh |
| E20 | chat-view: stepper id prefix | EP | L1 | automated | `OpenSpecStepper testIdPrefix="composer-"` and default | render | `composer-openspec-stepper` / `composer-stepper-segment-proposal`; default keeps `openspec-stepper` / `stepper-segment-proposal` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | git-context: detection never blocks the poll | structural (fake timers + async mock) | L1 | automated | a tick with a `gh` mock that resolves after 10 s and the branch changed | the tick's promise / return settles before the mock resolves; `git_info_update` with the new branch is sent before any PR fields; no `spawnSync` recipe for `gh` is reachable from the tick path | single tick |
| P2 | git-context: cadence bound | fake-timer soak | L1 | automated | 1 session, no branch changes, no refresh, gh always succeeds | `gh` invocation counter ≤ 31 | 60 simulated minutes (120 ticks) |
| P3 | git-context: forced-probe coalescing | fake-timer burst | L1 | automated | 3 `git_info_refresh` within 10 s while gh keeps failing (back-off at 600 s) | counter increases by exactly 1 within the 30 s window | 30 simulated s |
| P4 | proposal: real fleet cost | soak | — | manual-only | 20 idle dashboard sessions against GitHub, 60 min | per-session invocation counter ≤ 31; GraphQL point delta recorded in `review-notes.md` | 60 min, needs a real `gh` auth + GitHub — no harness |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | git-context: cadence + branch change | state-transition | L1 | automated | scheduler at t=0 with a probe done; branch unchanged | advance +30 s, +120 s; then change branch at +130 s | no probe at +30 s; probe at +120 s; at +130 s an update with all PR fields `null` is sent immediately, then a probe starts; no update after +130 s carries PR 747 of the old branch |
| F2 | git-context: stale generation | state-transition | L1 | automated | probe in flight for session A / branch x | fork to session B (same cwd, branch) before the probe resolves | A's result is discarded; B's fields are unknown (omitted) until B's own probe resolves |
| F3 | git-context: forced during in-flight | state-transition | L1 | automated | slow probe (5 s) in flight | `git_info_refresh {reason:"pr"}` at +1 s | a second probe starts right after the first settles; the forced request isn't lost |
| F4 | git-context: Open PR lag retry | state-transition | L1 | automated | refresh `reason:"pr"`, gh returns absent, absent, then PR 748 | advance timers | probes at +0, +5 s, +15 s; the final update carries `gitPrNumber: 748`; the same sequence with `reason:"push"` → exactly one probe |
| F5 | git-context: register carries cached tuple | state-transition | L1 | automated | bridge with a cached PR 747 open passing | reconnect → `session-sync` register | the register `git_info_update` includes all six PR fields with cached values; the server keeps PR 747 (no clearing) |
| F6 | chat-view: change chip popover focus | state-transition | L1 | automated | attached `add-auth` | open chip → press Escape | focus lands on `Open proposal` on open; `Detach` invokes `onDetach` once; Escape closes and returns focus to the chip; the popover renders in a body portal (not inside `composer-openspec-container`) |
| F7 | chat-view: working = streaming ∨ retrying | decision-table | L1 | automated | status {idle, streaming} × retrying {f, t} on the composer and the card | render both surfaces | primary, Push, Merge disabled (`aria-disabled="true"`, focusable, reason in `title` / `aria-describedby`) iff streaming ∨ retrying; `Open proposal`, `Detach`, `Attach change…`, P/D/S segments enabled in every row; Merge never filled while disabled |
| F8 | chat-view: empty Status group hidden | state-transition | L3 | automated | docker harness; a badge claim whose component returns `null` for the session | load the chat view | `composer-status-group-label` not visible; `composer-status-container` has `display:none`; with a non-null badge the label is visible |
| F9 | chat-view: groups wrap without overflow | BVA | L3 | automated | attached worktree session with an open PR; chat pane width {1440, 700, 420} px | render the strip | at every width the strip's `scrollWidth ≤ clientWidth`; at 420 px the Git group's content wraps inside its container and `composer-git-group-label` shares its top edge (±2 px) with the group's first item |
| F10 | chat-view: action button follows draft | BVA | L3 | automated | chat pane 1100 px | type 1 line, then 4 lines | at both sizes `send-button` bottom = textarea bottom ± 2 px, and the button is ≥ 44×44 px |
| F11 | chat-view: fold threshold vs longest model | BVA | L3 | automated | the longest model id in the harness catalogue selected; composer widths {44rem + 1 px, 44rem − 1 px} | render | at 44rem + 1 px: thinking, delivery, terminal inline, `overflow-button` hidden, no horizontal overflow of the settings row; at 44rem − 1 px: `overflow-button` visible |
| F12 | chat-view: composer lifecycle bar letters | EP | L3 | automated | attached IMPLEMENTING 12/39; chat pane 1440 px | render | `composer-openspec-stepper` width ≤ 250 px; segment labels show letters / `12/39` (no full "Proposal" word); the session card's stepper in the same page still shows full labels |
| F13 | proposal: visual parity with the mockups | visual | — | manual-only | `mockups/index.html` §H + `mockups/composer.html` §A vs the running app | a human compares both themes at 375 / 768 / 1440 | [judgment: grouping reads as in the mockup — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | git-context: back-off + keep last | fault-injection (abort) | L1 | automated | gh exits 1 with `HTTP 401` repeatedly after one success (PR 747) | advance timers across 4 failures | probe gaps 120, 240, 480, 600, 600 s; every update keeps PR 747; exactly one failure log line, then one recovery log line after the next success |
| X2 | git-context: hung CLI | fault-injection (delay) | L1 | automated | gh never resolves | probe starts; a forced refresh arrives at +25 s | the first probe is marked failure at 20 s; the forced probe starts without waiting for the hung process |
| X3 | git-context: old bridge compat | fault-injection (version skew) | L1 | automated | (a) an old-bridge message: `gitPrNumber: 747`, no new fields · (b) an old-bridge handler receiving `git_info_refresh` | server handles (a); bridge dispatch handles (b) | (a) the session keeps `gitPrState` / `gitPrDraft` / `gitPrChecks` absent, the UI segment shows `#747` only and Merge is outlined · (b) no throw, no state change |
| X4 | worktree-lifecycle: stale green PR | fault-injection (stale data) | L1 | automated | PR open, passing, `gitPrCheckedAt` = now − 20 min, change COMPLETE | render menu + dialog | Merge outlined; the dialog shows "PR status may be stale"; Archive is the filled primary |
| X5 | dashboard-shell-slots: plugin without testId | fault-injection (bad input) | L1 | automated | a plugin renders `ComposerContextGroup` with an empty-fragment child | render the strip | no container or label rendered for that claim; the other groups unaffected |

---

## Coverage summary

- Requirements covered: 10/10 delta requirements (chat-view ×3, dashboard-shell-slots ×1, worktree-lifecycle ×2, git-context ×3 incl. ADDED refresh, + proposal-level perf / visual).
- Scenarios by class: edge 20 · perf 4 · frontend 13 · error 5 (42 total).
- Scenarios by level: L1 35 · L2 0 · L3 5 · — 2 (manual-only).
- Scenarios by disposition: automated 40 · manual-only 2 (P4 real-GitHub soak, F13 visual parity).

## New infra needed

- none. F8–F12 run on the existing docker harness. F8 needs a badge-claim fixture that renders `null`; extend the existing harness plugin fixture used by `quota-context-strip.spec.ts` rather than adding a new plugin.
