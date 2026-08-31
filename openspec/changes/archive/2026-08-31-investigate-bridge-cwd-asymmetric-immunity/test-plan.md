# Test Plan — investigate-bridge-cwd-asymmetric-immunity

Stage: design   Generated: 2026-08-31

Investigation-only change: nothing lands in production code, so **no durable
automated repo test is honest here** — an L1/L2/L3 test would either re-verify
the migration guard (explicit Non-Goal; parent unit tests own it) or assert a
one-shot investigation environment that is torn down at close-out. Every
scenario below is therefore `manual-only`: an in-flight procedural assertion
executed by the investigation tasks themselves and evidenced in `findings.md`.
The two clarified values (60 s pre-flight browse, 60 s canary window) came
from the HARD-gate Q&A on 2026-08-31 and are recorded in design D4.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | D2/task 3.1 — replay runs a genuinely pre-fix build | state precondition | — | manual-only | worktree pinned at the 1.3 commit | run the parent's `ConnectionManager` re-target test / check its existence at that commit | test absent or failing → pre-fix confirmed; test present+passing → wrong commit, re-derive 1.3 before any arm runs |
| E2 | D1/task 1.1 — forensic completeness | coverage assertion | — | manual-only | `~/.pi/dashboard/server.log` (~16 MB) | matrix-window extraction (~2026-08-28/29) | `findings.md` per-arm timeline covers 7/7 arms: registration lines + `[bridge-transport]` rows, or an explicit absent-row entry read as vintage evidence |
| E3 | D5/D6/task 2.1 — verdict discipline | decision-table | — | manual-only | group-1 evidence tables | hypothesis scoring | `findings.md` records alive/dead + a specific citation (log line, commit, config state) for each of the 4 hypotheses; a composite factor set recorded as one candidate |
| E4 | D6/tasks 4.1–4.3 — confirmation by flip, both directions | state-transition | — | manual-only | surviving hypothesis + staged isolated env | flip A (remove factor from immune arm), flip B (add factor to a migrating arm), vintage flip for H-resolution-path | flip A → migration observed; flip B → immunity observed; else hypothesis demoted with outcome recorded; timing-sensitive results repeated ≥3× with per-arm counts |
| E5 | proposal scope / contract — behaviour-neutral diff | diff audit | — | manual-only | change branch at ship time | final diff review | diff touches only `openspec/changes/investigate-bridge-cwd-asymmetric-immunity/**`, any filed follow-up change dirs, and 5.3-delegated `docs/`+`AGENTS.md` rows; zero hunks in production code (`packages/`, `docker/` runtime files) |
| E6 | task 5.4 — teardown completeness | postcondition checklist | — | manual-only | close-out | teardown | `git status` clean; no listeners on the recorded isolation ports; temp HOMEs, pinned worktrees, staged dashboards deleted; live `/api/sessions` free of test arms |

### Performance

None — investigation change; no latency/throughput budget exists or is
introduced.

### Frontend-quirk

None — no UI surface is touched.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | D4/tasks 3.2–3.3 — no leak onto live dashboard | hazard guard | — | manual-only | poisoned advertiser live in isolation while live dashboard runs on :8000 | before scoring each replay arm + at teardown | live `/api/sessions` session set identical to the pre-replay snapshot (no wedge/w-a/w-b/zz-spawn-style cwds); any new test arm → **abort the entire run** |
| X2 | D4 — containment, host direction | negative probe | — | manual-only | harness with local uncommitted mDNS-enabling override; advertiser inside the container network | **60 s** host-side browse for the advertiser's service type before arms start | zero sightings of the poisoned advertisement from the host during the full 60 s; any sighting → containment failed, do not start arms |
| X3 | D4 — containment, arm direction (positive control) | positive control | — | manual-only | seeded temp HOME + pinned worktree + wedge-repro canary cwd | canary spawned before the matrix arms | canary bridge adopts the poisoned endpoint within **60 s** (`[bridge-transport]` adoption line or 502-on-prompt via original endpoint); no migration in 60 s → staging defect, no arms scored |
| X4 | D4 — load-surface parity | state precondition | — | manual-only | seeded temp HOME | each of the seven arms spawned | ≥1 `session registered` line per arm in the isolated server log before its outcome is scored; a never-registered arm is a staging defect → fix parity and re-run, never score it as "kept" |
| X5 | D7 — middle-case verdict direction | decision-table on exits | — | manual-only | replay reproduces migration but immune arm also migrates | verdict writing in `findings.md` (5.1) | verdict reads "asymmetry not reproducible at fixed vintage" + uncommitted-state drift caveat; a temporal/vintage-class claim appears only if both vintage endpoints (plus the boundary probe when 2.2 mandated it) actually ran |

---

## Coverage summary

- Requirements covered: 9/9 (scope-neutrality, no-leak, containment×2, load
  parity, pinned-commit fidelity, forensic completeness, verdict discipline,
  bounded exits, teardown)
- Scenarios by class: edge 6 · perf 0 · frontend 0 · error 5
- Scenarios by level: L1 0 · L2 0 · L3 0 · — 11
- Scenarios by disposition: automated 0 · manual-only 11

Zero automated rows is the deliberate outcome for this investigation-only
change, not a fold failure: every row is executed in-flight by its mapped
investigation task and evidenced in `findings.md`; `ship-change`'s defer rule
applies only to rows still unverified at ship time.

## New infra needed

None. The isolation environment (temp HOME, pinned worktrees, local
uncommitted compose override) is investigation-internal and torn down at
close-out (E6).
