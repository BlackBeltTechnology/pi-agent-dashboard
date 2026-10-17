# Test Plan — compact-session-card-header

Stage: design   Generated: 2026-10-17

No clarification gate fired: every Triple slot fills from the spec deltas and design (260 px, 6 ch, 4.5:1, ≤ 5 s, concrete testids).

Exemplars (harness glue to copy):
- **L1:** `packages/client/src/components/__tests__/SessionCard.test.tsx`, `SessionCard.card-sections.test.tsx`, `CwdGonePill.test.tsx`, `GitDirtyPill.test.tsx`, `WorktreePill.test.tsx`; `packages/client/src/components/session/__tests__/SessionCard.host-pressure.test.tsx`, `SessionCard.ended-reason.test.tsx`; `packages/shared/src/__tests__/model-id.test.ts`.
- **L3:** `tests/e2e/fix-slot-pill-legend-overflow.spec.ts` (worktree session fixture, geometry, `tests/e2e/helpers/computed-contrast.ts`) and `tests/e2e/card-block-toggles.spec.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | header: four rows in fixed order | state assertion | L1 | automated | desktop card: streaming worktree session, `currentTool:"bash"`, `gitBranch:"os/feat-x"`, `gitPrNumber:812`, `gitStatus.dirtyCount:3`, `model:"anthropic/claude-opus-4-1"`, `cost:1.84` | render | DOM order: name text < `bash` < `[data-testid=worktree-pill]` < `os/feat-x` < `claude-opus-4-1` < `$1.84`; all precede the first `SessionSubcard` |
| E2 | subcards: five subcards in order; GIT/WORKSPACE gone | state assertion | L1 | automated | desktop worktree card with content for OPENSPEC, STATUS, PROCESS, FLOWS, MEMORY and `gitBranch` set | render | legend titles in order `OPENSPEC, STATUS, PROCESS, FLOWS, MEMORY`; no element with title text `GIT` or `WORKSPACE` |
| E3 | header: git-row render gate | decision table | L1 | automated | 16 combos of `showGitInfo` × `gitWorktree` set × `gitBranch` set × `git` section visible | render each | git row present exactly when `(showGitInfo ∨ gitWorktree) ∧ gitBranch ∧ visible`; absent in the other combos |
| E4 | subcards: worktree pill leads git row + tooltip | EP | L1 | automated | worktree session `gitBranch:"feat/dark"`, case a `gitWorktree.base:"develop"`, case b no base; case c `gitWorktree` absent | render | a: pill first in git row, before `feat/dark`, `title="created from develop"`; b: `title="git worktree"`; c: no `worktree-pill` anywhere |
| E5 | header: worktree without branch yet | EP (missing field) | L1 | automated | `gitWorktree` set, `gitBranch` undefined | render | no git row, no `[data-testid=worktree-pill]` |
| E6 | header: PR status reuse | EP | L1 | automated | a `gitPrNumber:812, gitPrState:"open", gitPrChecks:"passing"`; b `gitPrDraft:true`; c `gitPrNumber:5` only | render | a: `[data-testid=worktree-pr-segment]` text contains `#812`, `open` and `[data-testid=worktree-pr-checks]`; b: contains `draft`, no checks element; c: text `#5`, no state word, no checks |
| E7 | header + subcards: missing-folder pill gate and placement | decision table | L1 | automated | `cwdMissing:true` with (a) no `gitBranch`, (b) non-worktree member of a 2-session group, (c) worktree with branch; (d) `cwdMissing:false`; (e) `undefined` | render | a–c: `[data-testid=cwd-gone-pill]` inside the title row, text `folder missing`, between name and time, not inside the git row; d, e: no pill |
| E8 | header: model label | EP + BVA | L1 | automated | `model` = `"anthropic/claude-opus-4-1"` + `thinkingLevel:"high"`; `"gpt-5"`; `"anthropic/"`; `undefined` with `cost:0.12` | render | `claude-opus-4-1 (high)` with `title` containing `anthropic/claude-opus-4-1`; `gpt-5`; `anthropic/` (full fallback); no model label while `$0.12` renders |
| E9 | header: status-row omission | decision table | L1 | automated | ended session, `closedReason` undefined, not moved away, `hostPressure` undefined; plus control: same with `closedReason:"process_gone"` | render | no status row element; control renders status row with `[data-closed-reason=process_gone]` |
| E10 | header: meta-row omission + cost boundary | decision table + BVA | L1 | automated | no `model`, no session chip, `contextUsageBar` pref off, `cost` ∈ {0, 0.01}; then pref on with cost 0 | render each | cost 0 + pref off → no meta row; cost 0.01 → meta row with `$0.01`; pref on + cost 0 → meta row with context bar, no cost element |
| E11 | design D8: `activityContent` single branch list | decision table | L1 | automated | pure `activityContent` over: resuming; ended×{process_gone, manual, unknown, undefined, moved}; `awaitingFileAccess:true` with widget-bar prompt true; `currentTool:"ask_user"` with prompt true/false; retry 2; tool `bash`; streaming; idle | call | each case returns the same label/null the pre-change `ActivityIndicator` rendered (Needs you for `awaitingFileAccess` even with widget-bar prompt; standard streaming for `ask_user` + prompt) |
| E12 | design D8: `metaChipsVisible` | decision table | L1 | automated | sessions: moved away; remote origin; ACP driver; none of them | call `metaChipsVisible` and render | true for each chip case and the matching chip renders; false + no chip for the plain session |
| E13 | section visibility: hiding git removes git row only | decision table | L1 | automated | folder `/a` with `git` hidden; worktree session in `/a` with `gitBranch`, open PR, `dirtyCount:2`, `cwdMissing:true` | render | no `worktree-pill`, branch text, `worktree-pr-segment`, `git-dirty-pill`; `cwd-gone-pill` present in title row |
| E14 | section visibility: resolution order applies to git row | state assertion | L1 | automated | global `git` hidden + folder override show; then Focus profile hide over folder show | render under each snapshot | first: git row renders; second: git row absent |
| E15 | i18n values updated in place | EP | L1 | automated | `i18n-en-source.json`, `i18n-hu.ts`, `i18n-zh-CN.ts` | read keys | `common.cwdGone` = `folder missing` / `a mappa hiányzik` / `文件夹缺失`; `folders.sessionSDirectoryNoLongerExists` = en/hu/zh strings from design D6; each key appears exactly once per file |
| E16 | uncommitted indicator: severity-warning capsule | state assertion | L1 | automated | `GitDirtyPill` with `dirtyCount:5, ahead:2, behind:1` | render | pill uses `--severity-warning-bg/-fg/-border`; no `#d97706` or `--status-warning` in its style; tooltip contains `5`; `git-ahead` text `↑2`, `git-behind` text `↓1` |
| E17 | header: mobile output unchanged | regression snapshot | L1 | automated | mobile layout; streaming session `currentTool:"bash"`, `hostPressure` degraded, `cwdMissing:true`, worktree with branch | render | activity text `bash` and host-pressure indicator render with the same text as on `develop`; no status row, git row or `cwd-gone-pill` |
| E18 | header extras + KB wrapper order | state assertion | L1 | automated | desktop worktree session with OpenSpec activity badge, 2 user tags, OPENSPEC content and a `worktree-card-section` claim | render | order: meta row < OpenSpec badge line < tag strip < OPENSPEC subcard < `[data-testid=worktree-card-section-gap]` < STATUS subcard |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | header: rows 2–4 share the name's column | geometry invariant | L3 | automated | worktree session with activity, branch, model, cost; default harness font/zoom | open dashboard, measure | `left` of status row, git row, meta row each equals session-name `left` within 1 px |
| F2 | header: git row narrow overflow | BVA (width) | L3 | automated | worktree session, 60-char branch, open PR passing checks, `dirtyCount:12, ahead:4, behind:1`; card width 260 px | resize sidebar so the card is 260 px | branch element ellipsized and ≥ 6 ch wide; `worktree-pill`, `worktree-pr-segment`, `git-dirty-pill` boxes inside card content box (second git line allowed) |
| F3 | header: title row narrow with missing folder | BVA (width) | L3 | automated | session with 70-char name, `cwdMissing:true`; card 260 px | render | name ellipsized; `cwd-gone-pill` box fully inside card content box |
| F4 | header: meta row narrow with all chips | BVA (width) | L3 | automated | session with long model id, Moved badge, origin-device chip, driver chip, context bar on, `cost:4.10`; card 260 px | render | every meta-row element inside the card content box (model ellipsized or trailing items wrapped) |
| F5 | header: host pressure advances without update | state transition (time) | L1 | automated | streaming session with `hostPressure` whose heartbeat crosses the degraded threshold at t+3 s; fake timers; no prop change | advance timers 5 s | status row shows the host-pressure indicator after ≤ 5 s |
| F6 | design D8: clock gated on pressure | invariant (timers) | L1 | automated | desktop card, `hostPressure` undefined; fake timers | advance 30 s | zero card-level intervals registered; no re-render caused by a timer |
| F7 | Rules of Hooks across layout switch | state transition | L1 | automated | one card instance | re-render with `isMobile` false → true → false | no React hook-order error; each render shows the layout's expected rows |
| F8 | visual polish of the new header | visual/subjective | — | manual-only | desktop sidebar in base dark, base light and one non-base palette | human looks | [judgment: rows read as one column, pills balanced, no cramped spacing — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | uncommitted indicator: legacy probe | fault (missing data) | L1 | automated | `gitStatus` absent on a worktree session with branch | render | git row renders branch, no `git-dirty-pill`, no console error |
| X2 | header: unknown ended reason | fault (bad wire value) | L1 | automated | ended session with `closedReason:"constructor"` | render | no crash; status row shows `ended — reason unknown` |
| X3 | uncommitted indicator: AA contrast on card and folder header | computed contrast | L3 | automated | dirty pill (`● 5 ↑2 ↓1`) on a session card and on a folder header | measure in base light and base dark with `computed-contrast` helper | count text and each ahead/behind chip ≥ 4.5:1 against composited background in all 4 cases |

---

## Coverage summary

- Requirements covered: 14/14:
  - `session-card-header`: 5 requirements.
  - `session-card-subcards`: 3 (five subcards, worktree pill, missing-folder pill).
  - `session-card-section-visibility`: 4 (toggleable set, resolution order, persistence via E14 snapshot path, inline legend via E13).
  - `session-uncommitted-indicator`: 1.
  - Design D8 invariants.
- Scenarios by class: edge 18 · perf 0 · frontend 8 · error 3.
- Scenarios by level: L1 23 · L2 0 · L3 5 · manual 1.
- Scenarios by disposition: automated 28 · manual-only 1.

## New infra needed

None. F1–F4 and X3 reuse the docker E2E harness, the worktree session fixture from `fix-slot-pill-legend-overflow.spec.ts`, and `tests/e2e/helpers/computed-contrast.ts`. F4 needs a session with Moved / origin-device / driver chips. If the harness cannot seed those states, `ship-it` may route F4's chip states through the L1 harness plus a single geometry check, and must record that.
