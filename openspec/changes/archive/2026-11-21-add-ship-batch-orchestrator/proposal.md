## Why

`ship-it` lands **one** OpenSpec change from inside its worktree. Shipping a
board group (e.g. "Harden Security", 6 changes) is a manual relay today: open the
`⑂+` worktree dialog per change, type `/skill:ship-it`, babysit, then archive the
session and remove the worktree by hand — one change at a time, or ad-hoc
parallel with no cap. A session that stops on an `ask_user` question holds the
operator's attention while other changes could be progressing.

All building blocks exist (groups + change order, dependency graph, worktree
REST, bus-client spawn, pending-question stack, session archive). What is missing
is a **scheduler** that drives them for a whole group with a parallelism cap.

## What Changes

- **NEW project skill `ship-batch`** (`.pi/skills/ship-batch/`) plus an
  orchestrator script (`.pi/skills/ship-batch/scripts/ship-batch.ts`) that ships every active change
  of one OpenSpec group through `ship-it`, each in its own worktree
  (`os/<change>` → `.worktrees/os-<change>`) and dashboard session.
- **Parallelism cap** `--parallel N`, default **2**. A session waiting on a
  pending `ask_user` question does **not** occupy a slot: it is kept open
  (never torn down while the question is pending) and the next queued change
  starts in its place. Once answered it counts again; no new change starts until
  the active count is back below N (temporary over-cap is accepted, never
  pre-empted). A ceiling `--max-live` (default 2×N) on running + questioned
  sessions bounds docker-harness memory.
- **Ordering**: the group's persisted change order; a change whose open blocker
  is another change **in the same batch** waits until that blocker ships, and is
  skipped if the blocker ends unshipped. Out-of-batch blockers stay `ship-it`'s
  own step-1.5 concern (they surface as questions; dry-run lists them).
- **Teardown, per finished change** — the session is **always archived**; the
  worktree is removed only when nothing unpushable would be lost:
  - *shipped* (newly archived on `origin/develop`) → remove the worktree if
    `ship-change` has not already, delete the local branch.
  - *incomplete / failed* (after one automatic "continue" nudge) → commit WIP on
    `os/<change>`, push, remove the worktree (branch kept for a re-run).
  - *blocked* (`SHIP_IT_BLOCKED.md`, gitignored hand-back) → push the WIP, **keep**
    the worktree for the human, as `ship-it`'s escape hatch requires.
  - Anything unpushable (push failure, merge/rebase mid-flight, outcome
    unknown, live session still in the worktree, unexpected dirt in a shipped
    worktree) → worktree **kept** and reported.
  - Re-running the group re-queues unshipped changes on their branch/worktree.
- Sessions spawn with model **`@coding`** by default (`--model` overrides).
- Preflight refuses non-`headless` spawn strategy; an untrusted worktree init
  hook halts scheduling (never auto-trusted).
- Resumable run state + JSONL event log under `<repo>/.worktrees/.ship-batch/`;
  one runner per repo (lockfile); `--dry-run` prints the schedule only;
  `--status` summarises a run.
- No server, client or protocol changes — pure consumer of existing REST + bus
  verbs, authenticated with the existing local-proof helper.

## Capabilities

### New Capabilities

- `ship-batch-orchestrator`: group-scoped, parallelism-capped batch execution of
  `ship-it` — scheduling, question-aware slot accounting, dependency gating,
  outcome classification, mandatory teardown, resumable state.

### Modified Capabilities

None. `ship-it` and `ship-change` are composed unchanged.

## Impact

- New: `.pi/skills/ship-batch/{SKILL.md,scripts/*.ts,scripts/__tests__/*}`,
  `vitest.config.ts` project entry (same pattern as `.pi/skills/ship-it`).
- Consumes: `GET /api/config`, `GET /api/openspec/groups`,
  `GET /api/openspec/dependencies`, `POST /api/git/worktree`,
  `POST /api/git/worktree/init`, `POST /api/git/worktree/remove`,
  `GET /api/questions`, `GET /api/sessions`, `POST /api/session/:id/archive`,
  bus `spawn` / `prompt` / session stream; CLIs `git`, `openspec list --json`,
  `docker/test-down.sh`; shared `archivedChangeName`.
- Git side effects: worktree/branch creation, WIP commits + pushes of
  `os/<change>` for unshipped changes.
- Related active change: `add-plugin-spawn-worktree` (server-side worktree spawn
  for plugins). Not a dependency — this skill uses the browser-equivalent REST
  path; it could migrate later.

## Discipline Skills

- `doubt-driven-review` — teardown is irreversible (worktree removal, session
  archive, branch push); the push-before-remove and keep-on-push-failure rules
  must be stress-tested before they stand.
- `observability-instrumentation` — a multi-hour unattended runner needs an
  event log and a status read-out to be diagnosable.
- `review-code` — before commit, as for every non-trivial change.
