# Test Plan — fix-openspec-board-worktree-button-gating

Stage: design   Generated: 2026-08-31

All Triple slots resolved from `specs/openspec-board/spec.md` + `design.md` D2/D3/D5/D6/D7. No clarification gaps.

Level routing for this repo: L1 = vitest in `packages/client/src/**/__tests__/` (pure logic **and** React Testing Library component render — in-process); L3 = Playwright in `tests/e2e/` against the docker harness (real browser, WS-driven). Harness port is read from `.pi-test-harness.json` (`dashboardPort`), never hardcoded.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Resolution order — HEAD is positive evidence | decision-table | L1 | automated | `folderGitMap: {"/repo": "develop"}`, sessions `[{cwd:"/repo", isGitRepo:false}]`, pref on | call `resolveWorktreeAvailability` | `{available:true}`, no `reason` (non-null HEAD outranks a stale session flag) |
| E2 | Absent HEAD report does not disable | decision-table | L1 | automated | `folderGitMap: {"/repo": null}`, sessions `[{cwd:"/repo", isGitRepo:undefined}]`, pref on | call helper | `{available:true}`, no `reason` |
| E3 | Confirmed non-git folder | decision-table | L1 | automated | `folderGitMap: {"/repo": null}`, sessions `[{cwd:"/repo", isGitRepo:false}]`, pref on | call helper | `{available:false, reason:"not-a-git-repo"}` |
| E4 | Unknown git state fails open | decision-table | L1 | automated | `folderGitMap: {}`, sessions `[{isGitRepo:undefined},{isGitRepo:true}]`, pref on | call helper | `{available:true}` |
| E5 | Availability with no sessions at all | BVA (session count = 0) | L1 | automated | `folderGitMap: {}`, `sessions: []`, pref on | call helper | `{available:true}` (fail-open) |
| E6 | Confirmed non-git via session only | BVA (session count = 1) | L1 | automated | `folderGitMap: {}`, sessions `[{cwd:"/repo", isGitRepo:false}]`, pref on | call helper | `{available:false, reason:"not-a-git-repo"}` |
| E7 | Preference off outranks git state | decision-table | L1 | automated | `folderGitMap: {"/repo":"develop"}`, `gitWorktreeEnabled:false` | call helper | `{available:false, reason:"worktrees-disabled"}` |
| E8 | Reason precedence when both causes apply | decision-table | L1 | automated | sessions `[{cwd:"/repo", isGitRepo:false}]`, `gitWorktreeEnabled:false` | call helper | `reason === "worktrees-disabled"` (never `"not-a-git-repo"`) |
| E9 | Preference not yet loaded reads as on | decision-table | L1 | automated | `gitWorktreeEnabled: undefined`, `folderGitMap:{}`, `sessions:[]` | call helper | `{available:true}`, no `reason` |
| E10 | Folder identity uses server path normalization | equivalence-partition (path forms) | L1 | automated | map key built via `pathKey("/Users/x/Repo")`, query cwd `"/Users/x/Repo/"` (trailing slash, differing case on darwin) | call helper | resolves the same entry → `{available:true}`; a raw `===` lookup would miss |
| E11 | Availability is independent of liveness | state-transition (illegal edge) | L1 | automated | sessions `[{cwd:"/repo", status:"ended", gitBranch:undefined, isGitRepo:true}]`, live sessions only at `/repo/.worktrees/x`, `folderGitMap:{}` | call helper for `/repo` | `{available:true}` — result identical to the same input with `status:"active"` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Unavailable stays visible + explained | state-transition | L1 | automated | `OpenSpecBoardView` with `worktreeAvailability:{available:false, reason:"not-a-git-repo"}`, one change `add-dark-mode` | render | `card-new-worktree-add-dark-mode` is **in the DOM**, `disabled`, `title` = "This folder is not a git repository" |
| F2 | Preference-off reason on every card | decision-table | L1 | automated | same view, `reason:"worktrees-disabled"`, three changes | render | all three worktree buttons present + `disabled`, each `title` naming Settings |
| F3 | No wrong disabled flash on cold load | state-transition (intermediate state) | L1 | automated | board rendered before `/api/config` resolves (`gitWorktreeEnabled` undefined), `folderGitMap:{}` | render | worktree button is **enabled**; no Settings reason anywhere in the card |
| F4 | New-proposal dialog follows availability | decision-table | L1 | automated | `worktreeAvailability:{available:false, reason:"not-a-git-repo"}`, new-proposal dialog opened | open dialog | dialog exposes no worktree option (its `gitWorktreeEnabled` input is false) |
| F5 | Sidebar agrees on a zero-session folder | state-transition | L1 | automated | `SessionList` with pinned folder `/repo`, `sessions: []`, `folderGitMap:{"/repo":"develop"}`, pref on | render sidebar | `+ New Worktree` folder button is rendered (today: hidden) |
| F6 | Board availability survives all sessions ending | state-convergence (WS-driven) | L3 | automated | docker harness (`dashboardPort` from `.pi-test-harness.json`), git workspace with one main-cwd session + one worktree session, board open | end the main-cwd session out of band and let `session_removed` arrive | board converges with `card-new-worktree-*` still **enabled** on every card; never transitions to disabled/absent |
| M1 | Disabled affordance reads as disabled | visual/subjective | — | manual-only | board with a non-git folder | human looks at the card | [judgment: muted button reads as intentionally disabled, not as a broken/half-rendered control] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | HEAD read failure must not disable | fault-injection (dependency error) | L1 | automated | folder-HEAD probe threw server-side, so the client holds `folderGitMap:{"/repo": null}`; no session reports git state | call helper for `/repo` | `{available:true}` — a read error never yields `reason:"not-a-git-repo"` |
| X2 | Stale negative cannot pin the button off | fault-injection (stale cache) | L1 | automated | `folderGitMap:{"/repo": null}` cached from before `git init`, sessions `[{cwd:"/repo", isGitRepo:true}]` | call helper | `{available:true}` |
| X3 | Disabled action is inert | fault-injection (user forces the click) | L1 | automated | board card with `worktreeAvailability:{available:false, reason:"not-a-git-repo"}` | click `card-new-worktree-<name>` | `onSpawnAttachedWorktree` is not called; no dialog opens |

### Performance

_(none — no latency, throughput, memory, or soak requirement in this change; the helper is a pure O(sessions) resolution on an already-rendered path.)_

---

## Coverage summary

- Requirements covered: 8/8 (resolution order · HEAD-not-negative · preference gate + loading state · path normalization · liveness independence · disabled-with-reason · new-proposal dialog · board/sidebar agreement)
- Scenarios by class: edge 11 · perf 0 · frontend 7 · error 3
- Scenarios by level: L1 19 · L2 0 · L3 1 · manual-only 1
- Scenarios by disposition: automated 20 · manual-only 1

## New infra needed

none — L1 rows extend existing vitest suites (`SessionList.worktree-per-change.test.tsx`, `OpenSpecBoardView.test.tsx`, `ManageWorktreesMenu.test.tsx`) plus one new helper suite; F6 extends the existing Playwright harness pattern.
