# Test Plan — scope-openspec-auto-attach-to-session-cwd

Stage: design   Generated: 2026-08-10

Clarifications C1 (per-session set lifecycle) and C2 (no latency budget; assert cache-reads-only functionally) were resolved before this catalog was written. C1 was folded back into the spec delta as a normative sentence plus a scenario. No open markers.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Auto-attach locality gate | decision-table | L1 | automated | session `cwd=/repo-a`, cache for `/repo-a` initialized listing `["c-a"]`, no worktree info, `gitWorktreeReported=true` | active detection for `"c-b"` | `attachedProposal` stays unset, `openspecChange` stays unset, no auto-rename applied |
| E2 | Auto-attach locality gate | decision-table | L1 | automated | same as E1 but cache lists `["c-a","c-b"]` | active detection for `"c-b"` | `attachedProposal === "c-b"` (branch 1 unchanged) |
| E3 | Auto-attach locality gate | state-based | L1 | automated | session `cwd=/repo-a/.worktrees/os-c-a`, `gitWorktree.mainPath=/repo-a`, worktree cache initialized WITHOUT `c-a`, `/repo-a` cache lists `c-a` | active detection for `"c-a"` | gate allows; `attachedProposal === "c-a"` |
| E4 | Auto-attach locality gate | decision-table | L1 | automated | manual attach request for `"c-b"`, candidate roots do not list `"c-b"` | `POST /api/session/:id/attach-proposal` | attachment applied — gate not consulted on manual paths |
| E5 | Locality gate treats an unpopulated cache as unknown | BVA (tri-state) | L1 | automated | only candidate root has NO cached OpenSpec data | active detection for `"c-a"` | gate allows; zero notify entries appended |
| E6 | Locality gate treats an unpopulated cache as unknown | BVA (tri-state) | L1 | automated | `cwd` cache initialized WITHOUT `c-a`; `mainPath` cache uninitialized | active detection for `"c-a"` | gate allows (unknown root dominates) |
| E7 | Locality gate treats an unpopulated cache as unknown | BVA (tri-state) | L1 | automated | every candidate root initialized, none lists `"c-a"` | active detection for `"c-a"` | gate rejects |
| E8 | Auto-attach locality gate (worktree resolution) | decision-table | L1 | automated | `gitWorktreeReported` falsy, `isGitRepo` undefined, `cwd` cache initialized without the change | active detection | gate allows (unknown root added) |
| E9 | Auto-attach locality gate (worktree resolution) | decision-table | L1 | automated | bridge reports worktree state for a NON-worktree session (cleared case) | `git_info_update` carrying the cleared field | `gitWorktreeReported === true`; subsequent detection of an absent change is rejected |
| E10 | Auto-attach locality gate (worktree resolution) | decision-table | L1 | automated | `isGitRepo === false`, no worktree report ever received, `cwd` cache initialized without the change | active detection | gate rejects — non-git session is reject-capable without any report |
| E11 | Auto-attach locality gate (worktree resolution) | state-based | L1 | automated | `gitWorktree.mainPath` present from restored meta, `gitWorktreeReported` falsy | active detection for a change absent from both roots | `mainPath` still contributes a root AND an unknown root is added → gate allows |
| E12 | Activity detector is scoped to a session cwd | EP | L1 | automated | `cwd=/repo-a`, tool path `/repo-a/openspec/changes/c-a/tasks.md` | detector invoked | returns `changeName: "c-a"` |
| E13 | Activity detector is scoped to a session cwd | EP (invalid partition) | L1 | automated | `cwd=/repo-a`, tool path `/repo-b/openspec/changes/c-b/tasks.md` | detector invoked | returns no change name |
| E14 | Activity detector is scoped to a session cwd | BVA (path boundary) | L1 | automated | `cwd=/repo-a`, tool path `/repo-a-other/openspec/changes/c-b/tasks.md` | detector invoked | returns no change name — sibling prefix is not containment |
| E15 | Activity detector is scoped to a session cwd | EP | L1 | automated | `cwd=/repo-a`, relative tool path `openspec/changes/c-a/tasks.md` | detector invoked | returns `changeName: "c-a"` after resolution against cwd |
| E16 | Detect change name from openspec new change command | decision-table | L1 | automated | `cwd=/repo-a`, command `cd /repo-b && openspec new change add-auth` | detector invoked | returns no change name — the verbatim incident command shape |
| E17 | Detect change name from openspec new change command | decision-table | L1 | automated | `cwd=/repo-a`, command `openspec new change add-auth && cd /repo-b` | detector invoked | returns no change name — position-insensitive suppression |
| E18 | Detect change name from openspec new change command | decision-table | L1 | automated | `cwd=/repo-a`, command `cd /repo-a/packages/server && openspec new change add-auth` | detector invoked | returns `changeName: "add-auth"` — inside-cwd relocation is not suppressed |
| E19 | Activity detector is scoped to a session cwd | decision-table | L1 | automated | `cwd=/repo-a`, command `cd /repo-b && openspec archive c-b` | detector invoked | returns no change name — suppression applies to archive pattern too |
| E20 | Activity detector is scoped to a session cwd | decision-table | L1 | automated | `cwd=/repo-a`, command `openspec validate --change c-b && cd /repo-b` | detector invoked | returns no change name — suppression applies to flag pattern too |
| E21 | Server-side auto-attach from activity detection | state-transition (illegal edge) | L1 | automated | gate rejects the detected `"c-b"`; session has `attachedProposal="A"` (manual), `pendingReplaceProposal` unset | active detection for `"c-b"` | `openspecChange` unchanged, no branch 1-4 executes, `pendingReplaceProposal` remains unset |
| E22 | Server-side auto-attach from activity detection (branch 4) | state-based | L1 | automated | worktree session, `attachedProposal="c-a"` manual, worktree cache initialized without `c-a`, `mainPath` cache lists `c-a` | active detection for different change `"c-b"` | attachment NOT treated as deleted; `pendingReplaceProposal === "c-b"`; `attachedProposal` stays `"c-a"` |
| E23 | Server-side auto-attach from activity detection (branch 4) | state-based | L1 | automated | non-worktree session, `attachedProposal="A"` manual, `A` absent from the single initialized candidate root | active detection for `"B"` (gate permits) | `attachedProposal === "B"` directly, no dialog — existing deleted-proposal bypass NOT regressed |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Auto-attach locality gate | invariant assertion (no threshold per C2) | L1 | automated | one gate evaluation with a stubbed directory service | count of fresh-poll invocations == 0; only cache-read APIs called | single evaluation |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Locality rejection surfaces a deduplicated notice | state-convergence | L3 | automated | dashboard open on a session card whose gate rejects a foreign change on non-local evidence | rejection occurs server-side | the card's notification surface converges to showing exactly one entry naming the change; session does not enter a busy/running visual state |
| F2 | Auto-attach locality gate | state-convergence | L3 | automated | a session in repo A runs an openspec command targeting repo B's change | detection processed | the session card converges to showing NO attached proposal and NO renamed title — the end-to-end reproduction of the original incident |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Locality rejection surfaces a deduplicated notice | fault-injection (repeat storm) | L1 | automated | same rejected change name detected N times in one turn on non-local evidence | repeated active detections | exactly ONE notify entry appended; notify log length grows by 1, never approaching `NOTIFY_LOG_CAP` |
| X2 | Locality rejection surfaces a deduplicated notice | decision-table | L1 | automated | two distinct rejected names `"c-b"`, `"c-c"` on non-local evidence | successive detections | exactly one notify entry per distinct name (2 total) |
| X3 | Locality rejection surfaces a deduplicated notice | state-transition | L1 | automated | creation-CLI detection for `"c-a"` rejected on a stale cache, then a write to a path inside `"c-a"` contained by a candidate root, also rejected | both detections processed | zero notify entries for either detection — the create-then-write flow never emits the misleading message |
| X4 | Locality rejection surfaces a deduplicated notice | state-transition | L1 | automated | a suppressed (locally-evidenced) rejection of `"c-b"`, then a later rejection of `"c-b"` on evidence that did not appear local | second detection processed | exactly one notify entry naming `"c-b"` — suppression did not consume the dedupe slot |
| X5 | Locality rejection surfaces a deduplicated notice | fault-injection (lifecycle) | L1 | automated | a session that recorded both emitted-notice and locally-evidenced state | session unregisters, then a session with the same id registers and the gate rejects the same name | a notify entry is appended again; neither per-session record retains state across unregister |
| X6 | Locality rejection surfaces a deduplicated notice | invariant assertion | L1 | automated | a rejection notice is emitted for an idle session | notice appended | session gains no pending ask, no pending prompt request, no `currentTool`; session remains reapable |
| X7 | Auto-attach locality gate (worktree resolution) | fault-injection (missing signal) | L1 | automated | bridge never sends a worktree report AND `isGitRepo` is undefined | active detection for an absent change | gate allows — the unresolved session is never falsely rejected |
| X8 | Auto-attach locality gate (indicator plumbing) | invariant assertion | L1 | automated | server updates a session's worktree state | update broadcast to clients | broadcast payload contains no `gitWorktreeReported` key |

---

## Coverage summary

- Requirements covered: 6/6
- Scenarios by class: edge 23 · perf 1 · frontend 2 · error 8
- Scenarios by level: L1 32 · L2 0 · L3 2
- Scenarios by disposition: automated 34 · manual-only 0

## New infra needed

None. L1 rows extend the existing vitest suites (`packages/server/src/__tests__/auto-attach*.test.ts`, `packages/extension/src/__tests__/openspec-activity-detector.test.ts`); L3 rows extend the existing Playwright suite against the docker harness, reading the derived `dashboardPort` from `.pi-test-harness.json` rather than a hardcoded port.

## Notes on routing

- No L2 rows: this change adds no install, spawn, packaging or multi-OS runtime behaviour. Forcing a qa/ smoke row here would violate the level boundary (rendered-UI assertions must not live in qa/).
- F1/F2 are the only rendered-UI assertions and are therefore Playwright-only.
- P1 carries no latency threshold by decision C2 — the meaningful invariant is "the gate performs cache reads only and never triggers a poll", which is a functional assertion, not a timing one. Recording it as a perf-class row keeps the "hot path" constraint visible rather than losing it.
