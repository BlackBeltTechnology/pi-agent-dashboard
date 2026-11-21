# Test Plan — add-ship-batch-orchestrator

Stage: design   Generated: 2026-11-21

## Resolved decisions (owner 2026-11-21, HARD gate)

- **C1** — observation loop interval = **10 s** (questions poll, heartbeat, slot refill).
- **C2** — dependency `503 pending` retry = **10 attempts × 3 s**, then abort (exit 1).
- **C3** — dashboard unreachable mid-run → reconnect with backoff (1 s doubling, cap 60 s) **forever**; no decisions while down; `--status` shows "dashboard unreachable".
- **C4** — exit codes: **0** all shipped · **2** any `kept|incomplete|failed|skipped` · **1** usage/preflight/lock/fatal · 130/143 on SIGINT/SIGTERM.

> Level key: **L1** = vitest project `.pi/skills/ship-batch` (registered in root
> `vitest.config.ts` like `.pi/skills/ship-it`), tests in
> `.pi/skills/ship-batch/scripts/__tests__/*.test.ts`. "Pure" rows call
> `scheduler.ts` / `outcome.ts` / `lock.ts` directly with an injected clock.
> "Runner" rows drive `ship-batch.ts` through injected adapters: a **fake
> dashboard** (REST + bus session stream + questions, in-memory) and **real git**
> in `mkdtemp` repos with a bare `origin` (`develop` branch).
> Harness exemplars (exist): `.pi/skills/ship-it/scripts/__tests__/openspec-deps-gate.test.ts`
> (temp git repos + bare origin, `git()` helper), `.pi/skills/ship-it/scripts/__tests__/review-gate.test.ts`
> (pure decision tables), `.pi/skills/ship-it/scripts/__tests__/skill-contract.test.ts`
> (SKILL.md prose contract).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Membership + order | EP | L1 | automated | groups file: group `g`, `changeOrder.g = [b, a]`; active members `a`,`b` (in-progress), `c` (in-progress, not in order), `d` (complete, not in order) | `planQueue(...)` (pure) | queue = `[b, a, c, d]` |
| E2 | Membership excludes shipped | decision table | L1 | automated | assignments `{a:g, z:g, y:g}`; `z` not in `openspec list` (archived locally); `y` active locally but in plan-time `origin/develop` archive set | `planQueue` (pure) | queue = `[a]`; `y` reported `already shipped — pull develop`; `z` absent |
| E3 | Group resolution | decision table | L1 | automated | groups `{id:ui,name:"Current"}`, `{id:cur2,name:"current"}`, `{id:sec,name:"Harden Security"}` | resolve `sec` / `harden security` / `current` / `nope` | `sec`→sec; `harden security`→sec; `current`→error listing `ui`,`cur2`; `nope`→error listing all 3 ids |
| E4 | Flag validation | BVA | L1 | automated | `--parallel` ∈ {0, 1, 2.5, "x"}; `--max-live` ∈ {absent, N, N+1} with N=2 | `parseArgs` (pure) | 0/2.5/"x" → usage error; N=1 ok; max-live absent → 4; max-live=2 → error; max-live=3 → ok |
| E5 | Parallelism cap | EP | L1 | automated | 4 eligible queued, N=2, max-live 4, no sessions | `nextActions` tick 1; then mark one item `shipped`, tick 2 | tick 1: exactly 2 `start`; tick 2: exactly 1 `start` |
| E6 | Question frees a slot | state-transition | L1 | automated | N=2, max-live 4: items A,B `running`, C `queued`; A has a pending question | `nextActions` | 1 `start(C)`; no `teardown`/`nudge` action for A; A state `question` |
| E7 | Live ceiling | BVA | L1 | automated | N=2, max-live 3: A `running`, B,C `question`, D `queued` | `nextActions` | 0 `start`; with max-live 4 → 1 `start(D)` |
| E8 | Answered never pre-empts | state-transition | L1 | automated | N=2: A,B `running`, C `question`, D `queued` | C's question disappears; `nextActions` | C `running`; active=3; 0 stop actions; 0 `start(D)`; after A terminal (active=2) still 0 start; after B terminal (active=1) → `start(D)` |
| E9 | Runner exit condition | decision table | L1 | automated | (a) all terminal; (b) all terminal but one `question`; (c) one `queued` waiting on a running blocker | `isDone(state)` | (a) true; (b) false; (c) false |
| E10 | In-batch dependency gating | state-transition | L1 | automated | queue `[a, b, c]`; `b.blockedBy=[a]` (open); N=2 | tick 1; then `a`→`shipped`, tick 2 | tick 1: `start(a)`, `start(c)`, b `waiting_dep`; tick 2: `start(b)` |
| E11 | Failed blocker skips dependent | decision table | L1 | automated | `b.blockedBy=[a]`; `a` terminal ∈ {kept, incomplete, failed, skipped} | `nextActions` | for each: b `skipped`, reason contains `a` |
| E12 | Out-of-batch blocker | EP | L1 | automated | `b.blockedBy=[x]`, `x` not a member, `b.wave=null` (x in an outside cycle) | `planQueue` + `nextActions`; `--dry-run` render | b eligible in queue order; dry-run line for b lists `x` as "will ask" |
| E13 | In-batch cycle | state-transition | L1 | automated | `a.blockedBy=[b]`, `b.blockedBy=[a]`, `c` free | `planQueue` | a,b `skipped` (reason `cycle`); c queued |
| E14 | Settle rule | decision table + BVA | L1 | automated | clock-injected session histories: (1) `ended`; (2) streamed then idle 29 s; (3) streamed then idle 30 s; (4) never streamed, prompt age 4:59, idle; (5) never streamed, prompt age 5:00 + idle 30 s; (6) case 3 + pending question | `settled(item, obs, now)` | (1) T (2) F (3) T (4) F (5) T (6) F |
| E15 | Outcome classification | decision table | L1 | automated | plan-time archive set `S`; fetched archive dirs; worktree files; fetch results | `classify(...)` with: (a) `2026-11-21-<c>` new; (b) only `2026-01-01-fix-auth` for `c=auth`; (c) absent first fetch, present on re-fetch 30 s later; (d) absent + `SHIP_IT_BLOCKED.md`; (e) absent, no file; (f) 3 fetch failures | (a) shipped (b) not shipped (c) shipped, exactly 2 fetches (d) blocked (e) incomplete (f) unknown |
| E16 | Bounded nudge | decision table | L1 | automated | outcome `incomplete` × session {alive idle, ended} × nudgesUsed {0,1}, budget 1 | `nextActions` | alive+0 → `prompt` text `Continue /skill:ship-it for <c> from where you stopped.`, state `running`, nudgesUsed 1; alive+1 → `teardown`; ended+0 → `teardown`, no prompt |
| E17 | Teardown plan per outcome | decision table | L1 | automated | outcome × worktree facts {registered?, dirt set, commits ahead of develop, MERGE_HEAD/rebase/detached} | `teardownPlan(...)` (pure) | shipped+gone → `[prune, branch -D if present]`; shipped+dirt⊆{.pi/settings.json} → `[remove force, branch -D]`; shipped+other dirt → kept; blocked → `[wip-commit, push]` + kept; incomplete/failed+clean+0 ahead → `[remove, branch -D]`; incomplete+work → `[wip-commit, push, remove force]` branch kept; mid-merge/rebase/detached → kept, no commit; unknown → kept, no git action |
| E18 | Lock decision | decision table + BVA | L1 | automated | existing lock × {none; other host; same host pid alive hb age 9:59; alive 10:00; dead pid} | `lockDecision(lock, self, now)` | none→acquire; other host→refuse; alive 9:59→refuse naming pid; alive 10:00→takeover; dead→takeover |
| E19 | Worktree selection | decision table | L1 | automated | runner: fake REST + real git; states: (a) registered `.worktrees/os-x`; (b) local branch `os/x`; (c) only `origin/os/x`; (d) none | start item `x` | (a) no `POST /api/git/worktree`; (b) body `{base:"os/x"}` no `newBranch`; (c) `{base:"origin/os/x"}`; (d) `{base:"develop",newBranch:"os/x"}` |
| E20 | Session adoption | decision table | L1 | automated | spawn timeout; resident sessions in worktree: (a) one non-ended, started ≥ spawnRequestedAt; (b) one started before; (c) one ended; (d) two matching; (e) one via symlinked cwd (realpath equal) | `adopt(...)` | (a) adopted (b) none → failed (c) none → failed (d) kept, none adopted (e) adopted |
| E21 | Exit codes | EP | L1 | automated | runner completed runs: all shipped / one kept / preflight failure | process exit | 0 / 2 / 1 |
| E22 | Persistence per transition | invariant | L1 | automated | runner run with 2 items reaching terminal via fake dashboard | after every tick | state JSON always parses; written via tmp+rename (no `.tmp` left); `events.jsonl` lines == number of transitions + actions |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Preflight | fault-injection (abort) | L1 | automated | (a) `GET /api/config` → `spawnStrategy:"tmux"`; (b) repo without `origin`; (c) dashboard refused connection | run `--group g` | each: exit 1 with reason; no worktree dir, no state/lock file, 0 spawn calls |
| X2 | Dependency retry bound | fault-injection (delay/abort) + BVA | L1 | automated | dependencies endpoint: (a) 503 ×10; (b) 503 ×9 then 200; (c) 404 | plan | (a) exit 1 naming change after 10 attempts, 0 side effects; (b) proceeds; (c) exit 1 immediately |
| X3 | Untrusted init halts | fault-injection | L1 | automated | init → `init_untrusted` for 2nd started item while 1st runs; 2 more queued | run loop | 2nd item `failed` + torn down (worktree removed); 0 further `start`; 1st item continues to its outcome; report contains "trust the init hook"; exit 2 |
| X4 | init_failed / spawn failure | fault-injection | L1 | automated | (a) init → `init_failed`; (b) `spawn_result{success:false}` | start item | item `failed`; fresh worktree removed and branch deleted (0 commits ahead); scheduling continues (next item starts) |
| X5 | Archive confirmation | fault-injection (delay) + state-transition | L1 | automated | archive reply (a) `pending` then session `ended`+archived; (b) `pending`, intent expires, session `ended` unarchived; (c) 409 live for 3 min | teardown | (a) worktree step runs after archived; (b) second archive call issued, then worktree step; (c) item `kept`, reason "session not archivable", 0 git/remove calls |
| X6 | Live-session guard | fault-injection | L1 | automated | another non-ended session (not the item's) resident in the worktree at teardown | teardown of `incomplete` item | item `kept`; 0 remove calls; worktree dir exists |
| X7 | Harness down before removal | fault-injection | L1 | automated | worktree with `.pi-test-harness.json`; stub `docker/test-down.sh` recording invocations | teardown `incomplete` | stub invoked once from worktree cwd, before the remove call; without the file → 0 invocations |
| X8 | WIP commit + push + remove | integration (real git) | L1 | automated | worktree: modified tracked file, new untracked file, modified `.pi/settings.json`, ignored file | teardown `incomplete` | bare origin has `os/x` whose tip commit message `wip(ship-batch): x incomplete` includes the 2 files and NOT `.pi/settings.json`; remove called `{force:true, deleteBranch:false}`; local branch exists |
| X9 | Blocked keeps worktree | integration (real git) | L1 | automated | worktree with WIP edits + gitignored `openspec/changes/x/SHIP_IT_BLOCKED.md` | teardown `blocked` | WIP pushed to `origin/os/x`; `SHIP_IT_BLOCKED.md` not in the commit; 0 remove calls; worktree + file on disk; item `kept` |
| X10 | Push failure keeps worktree | fault-injection (abort) | L1 | automated | origin made unwritable (remote URL → missing path) | teardown `incomplete` with work | item `kept`; worktree on disk; 0 remove calls; report names path |
| X11 | Mid-merge not committed | fault-injection | L1 | automated | worktree in conflicted `git merge` state (MERGE_HEAD present) | teardown `incomplete` | no new commit on `os/x`; 0 push, 0 remove; item `kept` |
| X12 | No decision without live view | fault-injection (abort) | L1 | automated | (a) item's session vanishes from snapshot, not in archived listing; (b) bus disconnects for 3 reconnect attempts | ticks over 2 min (injected clock) | (a) no settle/teardown; session reappears → item continues `running`; (b) reconnect delays 1 s, 2 s, 4 s; 0 actions while down; `--status` prints `dashboard unreachable` |
| X13 | Signal handling | fault-injection | L1 | automated | 2 running items | send SIGTERM to runner (child process) | exit 143; state persisted with both `running`; lock file removed; 0 archive/remove calls on fake dashboard |
| X14 | Resume, no double spawn | state-transition | L1 | automated | state file: A,B `running` with sessionIds; C `starting` with `spawnRequestedAt`, no sessionId; fake dashboard: A,B resident, C's session resident (matches adoption rule) | restart runner | 0 spawn calls; A,B,C re-attached (C adopted) |
| X15 | Fresh plan after terminal run | state-transition | L1 | automated | state all terminal: a `shipped` (now archived), b `kept` (blocked, worktree kept), c `incomplete`; d's worktree hosts a live session | restart runner | old state renamed `<g>.<ts>.json`; queue `[b, c]`; b reuses its registered worktree (no create call); d `skipped` "live session present" |
| X16 | Single runner across worktrees | fault-injection | L1 | automated | live lock held by runner 1 (main checkout) | runner 2 started with cwd inside `.worktrees/os-y` | runner 2 exit 1, message names runner 1 pid; same lock path resolved |
| X17 | Dry run | invariant | L1 | automated | group with order, one dependency wait, one cycle, one out-of-batch blocker | `--dry-run` | stdout lists order, waits, skips, will-ask; afterwards no `.worktrees/os-*`, no state/lock/events file, 0 mutating REST/bus calls |
| X18 | Shipped, worktree already gone | integration (real git) | L1 | automated | ship-change already removed the worktree; local `os/x` remains | teardown `shipped` | 0 remove calls; `git worktree prune` ran; local `os/x` deleted; item `shipped` |
| X19 | Husk / branch_in_use on create | fault-injection | L1 | automated | create → (a) `path_exists` with unregistered dir; (b) `branch_in_use` | start item | (a) `orphan-cleanup` called then create retried once → success; (b) item `failed`, reason `branch_in_use`, 0 spawn |

### Contract

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| K1 | Skill contract | prose contract | L1 | automated | `.pi/skills/ship-batch/SKILL.md` | read file | frontmatter `name: ship-batch`; triggers incl. "ship the group"/"batch ship-it"; documents defaults `--parallel 2`, `--max-live 2×N`, `--model @coding`, settle 30 s, start-timeout 5 min, nudges 1; guardrails "never answer questions" and "never remove a worktree with unpushed work"; detached launch + `--status` + resume instructions |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | ship-it session spawn (`/skill:ship-it` expansion) | spike | — | manual-only | live dashboard, real model | bus `spawn({initialPrompt:"/skill:ship-it"})` in a throwaway worktree | session transcript shows ship-it SKILL.md loaded as a skill command (or fallback prompt adopted and recorded in design.md) |
| M2 | End-to-end batch | live smoke | — | manual-only | throwaway group with 2 trivial changes on a live dashboard | run `--group <g>` | both start; a question frees a slot; sessions archived; worktrees removed or kept per outcome; exit code per C4 |

---

## Coverage summary

- Requirements covered: 22/22 spec requirements + design D2–D7 decisions
- Scenarios by class: edge 22 · error 19 · contract 1 · manual 2 · perf 0 · frontend 0
- Scenarios by level: L1 42 · manual-only 2
- Scenarios by disposition: automated 42 · manual-only 2

## New infra needed

- In-memory **fake dashboard** adapter for the runner tests (REST routes used + bus session stream + questions). New test helper in `.pi/skills/ship-batch/scripts/__tests__/fake-dashboard.ts`; no product infra.
