# Test Plan — manage-worktrees-filter-cleanup

Stage: apply   Generated: 2026-08-19

## ⚠ Clarifications RESOLVED (2)

- [x] **C1** — RESOLVED: option (c) **no budget** — batches are rare, blocking is accepted. Scenario **P1** is DROPPED (task 9.2 dropped) rather than weakened to an exit-0 assertion.
- [x] **C2** — RESOLVED: **no compensation** — the branch delete happens anyway; X6 asserts the deletion completed and no unhandled rejection escapes when the caller aborts.

<details><summary>original wording</summary>

- **C1** — Batch removal blocks the event loop (`removeWorktree` uses `execSync`, so a 50-item batch is 50–100 sequential git invocations in one handler, on a server also hosting two WebSocket servers). Scenario **P1** needs a threshold to assert against: is the budget (a) no bridge/browser WS heartbeat missed for the batch duration, (b) a hard p95 wall-clock ceiling per batch, or (c) explicitly "no budget — batches are rare, blocking is accepted"? Without a number P1 cannot assert a boundary.
- **C2** — Blocked scenario **X6**: when the branch delete succeeds but `git worktree remove` already reported success and the *response write* fails (client disconnects mid-request), is the branch deletion expected to have happened anyway (no compensation), or is any rollback expected? The spec defines the happy and refused paths but not the abandoned-caller path.

</details>

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | spawn-dialog: default view hides harness noise | decision-table | L1 | automated | 9 entries covering every reachable `(isMain, detached, inTree)` combo: main; in-tree attached ×2; in-tree detached ×4; out-of-tree detached ×1; out-of-tree attached ×1 | `WorktreeList` renders with no filter interaction | exactly 3 rows render (main + 2 in-tree attached); the other 6 are absent from the DOM |
| E2 | spawn-dialog: every hidden row revealable by some chip | decision-table | L1 | automated | the E1 fixture | read the rendered chip set and their counts | every one of the 6 hidden entries is counted by ≥1 chip; no hidden entry is uncounted by all chips |
| E3 | spawn-dialog: shown count is a union, not a sum | EP | L1 | automated | one entry that is BOTH `detached: true` AND out-of-tree | render default view, read `N of M shown` | count reports `3 of 9`; the dual-group row is counted once, not twice; revealing either chip renders it exactly once |
| E4 | spawn-dialog: text query matches path and branch | EP | L1 | automated | entries incl. one with `branch: null` (detached) and one with `branch: null, bare: true` | type a substring present only in the null-branch entry's `path` | that row renders; no `TypeError` is thrown on the null branch |
| E5 | git-operations-api: batch size is capped (lower boundary) | BVA | L1 | automated | batch arrays of length 0 and 1 | `POST /api/git/worktree/remove-batch` | length 0 → accepted, `results: []`, no git invoked; length 1 → processed normally |
| E6 | git-operations-api: batch size is capped (upper boundary) | BVA | L1 | automated | batch arrays of length 50 and 51 | `POST /api/git/worktree/remove-batch` | 50 → processed, 50 results; 51 → HTTP 400 with the stable cap code, and **zero** git commands executed |
| E7 | worktree-lifecycle: branch-delete code space is disjoint | decision-table | L1 | automated | the `BranchDeleteCode` and `RemoveCode` unions | evaluate set intersection | intersection is empty; specifically `"git_failed"` appears in `RemoveCode` only and the branch-delete generic failure is spelled `"delete_failed"` |
| E8 | worktree-lifecycle: entries with no branch skip deletion | decision-table | L1 | automated | `{detached: true, branch: null}` and `{bare: true, branch: null}` | `removeWorktree({ deleteBranch: true })` | `branchDeleted: false`, `branchDeleteCode: "no_branch"`, and `git branch` is never invoked (assert on the command spy, not the outcome) |
| E9 | design D7: path-line suppression truth table | decision-table | L1 | automated | five rows — fork `feat-x` in `.worktrees/feat-x`; slash-branch `feat/bar` in `.worktrees/feat-bar`; PR branch `pr-42` in `.worktrees/pr-42`; out-of-tree `~/scratch/my-feature` on branch `my-feature`; detached with `branch: null` | render each row | rows 1–3 suppress the path line; row 4 (out-of-tree, coincidental basename) **renders** it; row 5 renders it and does not throw in `slugifyBranch` |
| E10 | spawn-dialog: main worktree offers no destructive control | decision-table | L1 | automated | entry with `isMain: true` in `mode="manage"` | render, then activate "select all N shown" | the main row has neither `✕` nor checkbox; the resulting selection excludes it |
| E11 | git-operations-api: batch body must be an array | EP | L1 | automated | bodies `{}`, `{items: null}`, `{items: "abc"}`, `{items: {}}` | `POST /api/git/worktree/remove-batch` | each → HTTP 400 with the stable validation code; zero git commands executed |
| E12 | worktree-lifecycle: `exists` is tri-state, absent means present | EP | L1 | automated | entries with `exists: true`, `exists: false`, and `exists` absent (older server) | render in `mode="manage"` | `true` → remove control enabled; `false` → no `✕`, excluded from selection, prune affordance shown; **absent → treated as present, remove control enabled** (a falsy test would disable all three) |
| E13 | design D1: inTree comparison normalises separators | EP | L1 | automated | porcelain paths using `\` separators (Windows shape), main at `C:\repo` and entry at `C:\repo\.worktrees\feat-x` | evaluate the `inTree` predicate | entry is classified in-tree; default view does not collapse to the main row alone |
| E14 | worktree-lifecycle: main worktree rejected by the single endpoint | EP | L1 | automated | the main worktree's own path | `POST /api/git/worktree/remove` | failure carrying `is_main_worktree`; **no** `git worktree remove` runs; status is not 500 |
| E16 | worktree-lifecycle: branch deletion happy + refused paths | EP | L1 | automated | a worktree whose branch is merged into its base, and one whose branch is unmerged | `removeWorktree({ deleteBranch: true })` on each | merged → removed with `branchDeleted: true` and the branch gone; unmerged → still removed, `branchDeleted: false`, `branchDeleteCode: "unmerged"`, branch still exists |
| E15 | git-operations-api: stale registration is reported as missing | EP | L1 | automated | a repo with 3 registrations, one of whose directories is deleted outside git | `GET /api/git/worktrees` | the deleted one reports `exists: false`; the other two report `exists: true`; every other field on every entry is unchanged from the pre-change shape |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D4: batch cap exists because `execSync` blocks | tail-latency | L2 | automated | a 50-item `remove-batch` against 50 real temp worktrees, with a bridge WS client connected and heartbeating | [NEEDS CLARIFICATION: threshold — see C1. Candidate: no missed WS heartbeat for the batch duration] | duration of one batch |
| P2 | git-operations-api: `exists` adds a `statSync` per entry | threshold | L1 | automated | `GET /api/git/worktrees` on a repo with 50 registrations | added wall-clock vs the pre-change baseline stays within the noise of the existing `git worktree list` `execSync` cost | 20 runs, compare medians |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | spawn-dialog: manage rows do not nest interactive controls | state-transition | L1 | automated | `mode="manage"` row with checkbox + `✕` | render, then Tab through the row | row container is not a `<button>`; checkbox and `✕` are each reachable as separate tab stops in DOM order |
| F2 | spawn-dialog: spawn mode preserves the one-click contract | state-transition | L1 | automated | `mode="spawn"` | click a row | `onSpawn(entry.path, opts)` fires once; the row is a single `<button>` containing no nested interactive element |
| F3 | worktree-lifecycle: removal converges the list | state-convergence | L3 | automated | manage dialog open with 3 removable rows | remove one row and let the response settle | the list converges to 2 rows without a manual refresh; no row renders in a permanently pending state |
| F4 | folder-actions-menu: manage-worktrees is session-independent | state-transition | L3 | automated | a git-repo folder with zero live sessions | open the folder actions menu | the `directory` group contains the manage-worktrees item (its presence does not depend on session state) |
| F5 | folder-actions-menu: item is gated on git-repo-ness | decision-table | L1 | automated | a folder that is not a git repository | build the folder menu items | no manage-worktrees item is present |
| F6 | folder-actions-menu: empty group still does not render | state-transition | L1 | automated | a folder for which no workspace-group item applies | open the menu | the workspace group heading does not render (regression guard: the MODIFIED delta must not drop this) |
| F7 | design D6: row text clears WCAG AA in both themes | threshold | L3 | automated | the manage list rendered with the real token stylesheet | measure computed contrast of branch and path text against their background, in dark and light | every row text run measures ≥ 4.5:1 in **both** themes; no row text resolves to `--text-muted` or `--text-tertiary` |
| F8 | design D7: elision never corrupts the path identifier | EP | L1 | automated | a long out-of-tree path requiring elision | render the row and read back the text content | the leading `.` of a dotted segment stays leading (no `direction:rtl` bidi reordering artefact such as `worktrees/x.`); elision falls on a segment boundary |
| F9 | spawn-dialog: chips state the action, not the state | visual/subjective | — | manual-only | the chip row with hidden groups | a human reads `+ detached 5` | [judgment: the `+`/`−` reads as "click to add/remove these", not as "5 are currently shown" — no automatable observable] |
| F10 | design: two-line row remains legible at 375px | visual/subjective | — | manual-only | the manage list at 375px with the longest real fixture paths | a human inspects the mobile rendering | [judgment: branch and path both readable, no ambiguous truncation — no automatable observable] |
| F11 | spawn-dialog: new strings are localised | EP | L1 | automated | the rendered `WorktreeList` in both modes | scan rendered user-facing strings | every new user-facing string resolves through `i18nT`, matching the host component's existing convention |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | worktree-lifecycle: partial failure does not abort the batch | fault-injection (abort) | L1 | automated | item 2 of 3 has uncommitted changes | `POST /api/git/worktree/remove-batch` without force | 3 results in input order; items 1+3 `ok` and gone from disk; item 2 `dirty_worktree` and still on disk |
| X2 | worktree-lifecycle: a blocked item reports its own sessions | fault-injection (abort) | L1 | automated | item 2 has 2 active sessions under its path | batch post without force for that item | item 2 reports `active_sessions` **with its own `sessionIds`**; items 1+3 still process; the item code union admits a non-`RemoveCode` value |
| X3 | worktree-lifecycle: batch replicates the cwdMissing broadcast | fault-injection (abort) | L1 | automated | a successfully removed batch item with 2 sessions registered under its path | batch post that succeeds for that item | both sessions are updated with `cwdMissing: true` and a `sessionUpdated` broadcast is emitted per session — asserted against the gateway spy, matching the single endpoint's behaviour |
| X4 | design D5: refused branch delete must not trigger a force-retry | state-transition | L1 | automated | a worktree whose branch is unmerged, removed with `deleteBranch: true` | the removal succeeds and the branch delete is refused | response is a **success** carrying `branchDeleted: false` + `branchDeleteCode: "unmerged"`; it does NOT carry a `RemoveCode` of `branch_not_merged`; a client keyed on `RemoveCode` does not auto-tick `--force` |
| X5 | design D8: a vanished directory is not surfaced as a raw 400 | fault-injection (abort) | L3 | automated | a row whose directory is deleted out-of-band after the list was fetched (TOCTOU) | activate `✕` and confirm | the client treats the resulting `cwd_invalid` as "already gone" — the row leaves the list and no raw 400 error is rendered |
| X6 | worktree-lifecycle: caller abandons the request mid-removal | fault-injection (abort) | L1 | automated | client disconnects after `git worktree remove` succeeds but before the response is written, with `deleteBranch: true` | abort the HTTP request mid-handler | [NEEDS CLARIFICATION: observable — see C2. Is the branch delete expected to have happened, with no compensation?] |
| X7 | worktree-lifecycle: prune is a no-op when nothing is stale | fault-injection (delay) | L1 | automated | every registration's directory exists | `POST /api/git/worktree/prune` | succeeds reporting 0 pruned; no registration is removed |
| X8 | worktree-lifecycle: prune clears a vanished registration | fault-injection (abort) | L1 | automated | one registration whose directory was deleted outside git | `POST /api/git/worktree/prune` | that registration is gone from `git worktree list`; the response reports the pruned count |
| X9 | git-operations-api: both endpoints are network-guarded | fault-injection (abort) | L1 | automated | a request the `networkGuard` denies | call `remove-batch` and `prune` | both are rejected by the guard before any git command runs |
| X10 | worktree-lifecycle: per-item containment | fault-injection (abort) | L1 | automated | a batch where item 2's `cwd` fails `validateCwd` or resolves outside the main worktree | batch post | item 2 is rejected with the validation code; items 1+3 still process; nothing outside the repo is touched |
| X11 | worktree-lifecycle: escalations are inherited unchanged | state-transition | L3 | automated | a worktree with 2 active sessions, removed from the **manage** surface | activate `✕`, then "End N sessions and remove worktree" | the same escalation flow runs as from `WorktreeActionsMenu`: sessions end, removal retries, worktree is gone |
| X12 | design D8: prune is repo-global, and says so | EP | L3 | automated | two stale registrations, prune activated from the affordance on one row | activate prune | both stale registrations are cleared, and the surfaced copy/result conveys a repo-global count rather than implying only that row |
| X13 | worktree-lifecycle: removal without a session | state-transition | L3 | automated | a worktree with no entry in the session map | open the manage surface, activate `✕`, confirm | `CloseWorktreeDialog` opens and the removal completes; no `active_sessions` guard fires |
| X14 | design D1/E13 on a real OS | fault-injection (abort) | L2 | automated | a real Windows runner with a repo containing one `.worktrees/` entry | run the dashboard and fetch the worktree list, asserting classification at the process level (no rendered-UI assert) | the in-tree entry is classified in-tree on Windows path separators |

---

## Coverage summary

- Requirements covered: 24/24 spec scenarios across the 4 deltas, plus 6 design-decision invariants (D1, D4, D5, D6, D7, D8) that carry no spec scenario of their own
- Scenarios by class: edge 16 · perf 2 · frontend 11 · error 14
- Scenarios by level: L1 29 · L2 2 · L3 10 · manual-only 2
- Scenarios by disposition: automated 41 · manual-only 2

## New infra needed

- **none for L1/L3** — `packages/server/src/__tests__/git-worktree-lifecycle-{ops,routes}.test.ts` already carry the temp-repo harness and the browser-gateway spy that X3 needs; `packages/client/src/components/__tests__/` already hosts the sibling dialog tests; `tests/e2e/` already runs against the docker harness (read `dashboardPort` from `.pi-test-harness.json` — never hardcode `:18000`).
- **X14 needs a Windows runner** in the `qa/` VM matrix. If the matrix has no Windows target, X14 downgrades to L1-only (E13) and the real-OS separator behaviour stays unverified — call that out rather than silently dropping it.
- **P1 needs a WS-heartbeat observer** in the L2 smoke harness to assert C1's candidate threshold; if C1 resolves to "no budget", P1 is dropped rather than weakened to a smoke assertion.
