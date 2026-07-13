## Context

Landing an OpenSpec change is a manual relay of skills that already exist —
`doubt-driven-review`, `scenario-design`, `openspec-apply-change`, `ship-change`
— with no wiring between them. Two steps (doubt-review, scenario-fold) get
skipped because nothing triggers them. This design adds two project-owned
orchestrator skills that compose the existing ones, split at the **git-worktree
boundary**, which is also the **interactive/headless line**:

```
   PLANNING (develop, human present, interactive) │ boundary │ IMPLEMENTATION (worktree, headless-capable)
   new/ff/continue → doubt-review → scenario-design│ commit + │ apply → docker-harness test → ship-change
   + category-fold + test-plan manifest            │ spawn wt │
   ── plan-proposal ──                             │          │ ── ship-it ──
```

This revision folds a two-cycle doubt-driven-review of the first draft (one
single-model + one cross-model `deepseek-v4-pro` pass). The reviews changed the
automated/manual mechanism (inline tag → **manifest**) and the red-test fix
ownership (delegated to apply → **owned by ship-it**). See "Decisions" for how
each reconciled finding landed.

Grounding facts (verified against the repo):

- **Parallel-worktree ports are already handled.** `docker/test-up.sh` +
  `lib-ports.sh` hash-derive a free port pair per worktree from `HOST_CWD`,
  record them in `.pi-test-harness.json`, isolate compose project + image tag.
  `test-up.sh` is BOTH allocator (first run) and reuser (idempotent re-up) —
  ship-it delegates to it and adds no new port code (it does not "only consume").
- **`openspec-apply-change` and the `ff`/`continue` skills are
  `generatedBy: 1.4.1`** — regenerated on `openspec update`. Editing them is a
  trap; behavior they lack lives in the orchestrators. Corollary: `tasks.md`
  parsed by `openspec status --json` must stay in vanilla checkbox form — no
  custom inline tokens the CLI parser could choke on.
- **38 of 44 active change dirs have `tasks.md`; zero use any task tag.** They
  write QA in keyword style (`Manual smoke:`, `Verify…`).
- **`ship-change`'s current defer matcher (`qa|manual|verify|smoke|e2e|
  acceptance|test by hand`) is already lossy**: it would defer a real
  test-authoring task (e.g. `add-change-summary-table/tasks.md:49` "Add a
  Playwright e2e spec…" contains "e2e") → ship it undone. This is a pre-existing
  legacy hazard, not introduced here.
- **`doubt-driven-review` is main-session-only** — it spawns a fresh-context
  reviewer (and, interactively, a second cross-model one); nested subagent spawn
  is blocked.
- **`scenario-design` routes to L1/L2/L3 or "new infra"** — it has no
  `manual-only` outcome today (Phase 4).
- **Playwright e2e wiring** (AGENTS.md): `globalSetup` runs `test-up.sh`, waits
  `/api/health`→200; `PW_E2E_USE_RUNNING=1` attaches; `globalTeardown` runs
  `test-down.sh`. `test-down.sh` runs `compose down -v`, removes the state file,
  and `docker image rm -f` the per-worktree tag.

## Goals / Non-Goals

**Goals:**
- Two named orchestrator skills — `plan-proposal` (develop) and `ship-it`
  (worktree) — chaining existing skills with no manual relay.
- Category-routed folding of `scenario-design` output into `tasks.md`, reusing
  existing test infra where it exists.
- Automated-vs-manual truth kept in `test-plan.md` (the **manifest**), leaving
  `tasks.md` vanilla and the 38 legacy changes + the generated CLI parser
  untouched.
- Planning interactive; implementation headless-capable; split at the worktree.

**Non-Goals:**
- Editing any `generatedBy` OpenSpec skill (`apply`, `ff`, `continue`).
- Adding any custom token to `tasks.md` lines (manifest avoids this).
- Fully-headless planning — `plan-proposal` is interactive by construction.
- Auto-triggering on raw file writes (no settings.json hooks / pi-flows).
- Reimplementing composed skills. `scenario-design` gets one **additive** edit
  (a `manual-only` outcome + manifest emit); its existing logic is unchanged.
- Fixing the pre-existing legacy keyword-defer hazard for the 38 untagged
  changes (documented trade-off, out of scope).
- New port-allocation code — `test-up.sh` already owns it.

## Decisions

### D1 — Packaging: two named skills, split at the worktree boundary
`plan-proposal` (`.pi/skills/plan-proposal/`) runs on `develop`; `ship-it`
(`.pi/skills/ship-it/`) runs inside the worktree. The boundary is a natural
human checkpoint ("plan looks good, build it"). Rejected: one skill invoked
twice (name overload); a dashboard-spawned baton across the boundary (couples to
spawn API + fails D6).

### D2 — Automated-vs-manual lives in a MANIFEST (`test-plan.md`), not a tasks.md tag
The first draft used an inline `[automated]` tag in `tasks.md`. Cross-model
review killed it: (a) the tag syntax is undefined and risks breaking
`openspec status --json`'s parser (the generated CLI we cannot edit), and
(b) the determinism gate would sit on `tasks.md`, but the human reviews
`test-plan.md`. **Resolution:** `scenario-design`'s `test-plan.md` is the single
source of truth. Each scenario row carries `level` (L1/L2/L3/electron/ci) and
`disposition` (`automated` | `manual-only`). `tasks.md` stays vanilla checkboxes.
This dissolves both findings — the CLI parser and the 38 legacy changes never
see a new token, and the human reviews dispositions in the artifact they already
review during planning.

### D3 — `ship-change` defer rule reads the manifest, with a legacy fallback
New precedence:
1. If `test-plan.md` exists (a manifest-era change): a leftover `- [ ]` task is
   deferrable **only if** it maps to a `manual-only` manifest row. Any other
   leftover = real work = STOP. Automated scenarios are never deferred — they
   are proven done by ship-it (D4/D8) before ship, so they are already `[x]`.
2. If `test-plan.md` is absent (legacy change): fall back to today's keyword
   defer, unchanged. The 38 untagged changes keep working exactly as now
   (including the pre-existing lossy-keyword hazard, which is not our regression
   to fix here).

Task→manifest mapping: folded test tasks reference their manifest row id
(e.g. `… (test-plan #7)`) as ordinary text — no parser-visible token.

### D4 — `ship-it` verifies filesystem reality, not checkbox state (true idempotence)
`openspec status` reflects `tasks.md` checkboxes, which can lie: a prior partial
run or a hand-checked `[x]` may mark an automated scenario "done" while its test
file is absent or red. `ship-it` therefore treats an automated manifest row as
satisfied **only when** its test file exists AND passes in the harness — never on
the checkbox alone. First act is still `openspec status` for orientation, but the
gate is the harness result. This makes re-invocation genuinely idempotent
regardless of who checked what.

### D5 — `scenario-design` gains a `manual-only` outcome + manifest emit (additive edit)
`scenario-design` is not `generatedBy`, so editing it is safe. The edit is
additive: Phase 4 gains a `manual-only` routing outcome (aesthetics, hardware,
"feels right"), and Phase 5 writes the `disposition` column into `test-plan.md`.
Existing L1/L2/L3 logic is untouched — consistent with the "no reimplementation"
non-goal. The fold step (owned by `plan-proposal`) then routes each `automated`
scenario to a test task in the right category; `manual-only` scenarios become
plain manual tasks (deferred by D3 path 1). Also fixes the stale `:18000` in the
routing table → dynamic harness port (D11).

Category routing (check for an existing test of that type to extend first):

| Scenario nature | Category / home | Check-first (reuse infra) |
|---|---|---|
| pure logic / boundary | L1 unit → `packages/*/**/__tests__/*.test.ts` | sibling `*.test.ts` |
| process / install / multi-OS | L2 qa smoke → `qa/tests/*.sh\|*.ps1` | existing qa test for that OS |
| rendered UI / WS view | L3 e2e → `tests/e2e/*.spec.ts` (docker harness) | existing spec for that surface |
| Electron shell / packaging | `ci-electron.yml` / `_electron-build.yml` | existing electron job |
| CI platform / release wiring | `ci.yml` / workflow-level | existing workflow assertion |
| aesthetics / hardware | `manual-only` disposition (no automation) | — deferred by D3 |

### D6 — `plan-proposal` runs in the MAIN session only
Two independent grounds: it calls `doubt-driven-review` (spawns a fresh-context
reviewer + an interactive cross-model reviewer; cannot nest inside a subagent),
and it calls `scenario-design`, whose proposal/design-stage HARD gate calls
`ask_user` and stops on spec gaps. Both need a live interactive session.
`plan-proposal` is therefore non-headless by construction and must never be
spawned as a subagent; it passes `--stage proposal|design` and is expected to
PAUSE for clarification, not error.

### D7 — Folded test tasks carry a harness-exemplar pointer + the Triple; ship-it translates it
`scenario-design` refuses to write test code; generic `apply` does not know the
repo's e2e wiring. Each automated fold task therefore references (1) the nearest
existing spec of that category to copy harness glue from, and (2) the
`input · trigger · observable` Triple from `test-plan.md`. Because `apply` has no
"copy from exemplar" capability of its own, `ship-it` resolves the exemplar path
and injects it into the task context it hands `apply` (or authors the spec
directly in its own fix loop, D8). Bare "author X.spec.ts" tasks are forbidden.

### D8 — `ship-it` OWNS the red-test fix loop (apply cannot fix a checked task)
`apply` marks `- [ ]` → `- [x]` on completion and never revisits a checked task,
so a `ship-it → apply → harness` retry would no-op after cycle 1 while the test
stays red. **Resolution:** on a red test, `ship-it` drives the fix itself
(edit code/test, re-run harness), it does not re-invoke `apply` on an already-
checked task. The loop is bounded by **progress-making** cycles (a cycle that
makes no change does not count and immediately escalates), not a fixed
apply-count, and is not equated with doubt-review's semantically-different
3-cycle bound. Hard guardrails, mechanically enforced: `ship-it` diff-checks the
test file across each cycle and **rejects** any `.only`/`skip`/deletion/
assertion-weakening; it may not reach green by degrading the test. On bound
exhaustion → STOP + surface (D9).

### D9 — Concrete boundary-reverse escape hatch
`apply` may reveal a design issue mid-implementation (NL prose only — no
structured signal). `ship-it` must not headlessly rewrite `proposal.md`/
`design.md`. Mechanism when a design-issue signal is detected OR the D8 bound is
exhausted: `ship-it` (1) leaves the worktree intact (no revert), (2) writes a
`SHIP_IT_BLOCKED.md` report in the change dir naming the failing scenario /
design gap, (3) exits non-zero, and (4) surfaces via the dashboard so a human
re-enters `plan-proposal` / `doubt-driven-review` on `develop`. The boundary is
not one-way; this is its named reverse path.

### D10 — Harness lifecycle: always-teardown, teardown-before-worktree-removal
`ship-it` wraps the harness in `trap`/finally so `test-down.sh` runs on red
test, abort, OR a partial `test-up.sh` start (`test-down.sh` is safe against a
partially-created compose project — it uses `compose down -v` + best-effort
`rm`). Strict ordering: harness down **before** `ship-change` step 10 removes the
worktree (a leaked container is a "busy worktree" that stalls removal).
Per-worktree state file + image tag are cleaned; compose-project isolation keeps
one worktree's leak from blocking another.

### D11 — Ports: delegate to `test-up.sh`, read back the derived port
`ship-it` calls `docker/test-up.sh` from inside the worktree (which allocates on
first run, reuses on re-up), reads the derived port from `.pi-test-harness.json`,
runs the suite against it, then `test-down.sh`. No hardcoded `:18000`. Adds no
new allocation code (the non-goal), but does not claim to "only consume" —
`test-up.sh` is the allocator it invokes.

### D12 — `ship-it` drives `ship-change` INLINE, not as a black-box subagent
D10's ordering (harness teardown between ship-change's steps) requires step-level
control. `ship-it` therefore executes `ship-change`'s procedure inline
(interleaving its harness teardown before step 10), rather than spawning
`ship-change` as a subagent that would hide its step boundaries and its long CI/
CodeRabbit waits from `ship-it`.

## Risks / Trade-offs

- **Legacy keyword-defer hazard persists** for the 38 untagged changes (a real
  test-authoring task whose text contains "e2e"/"verify" can be wrongly
  deferred). Out of scope; D3 path 2 preserves current behavior verbatim.
  Mitigation offered, not forced: `plan-proposal` may offer to generate a
  `test-plan.md` manifest for a legacy change when it is next touched.
- **Two invocations, not one.** A human kicks off `ship-it` after the worktree
  spawns. Accepted: the boundary is a natural checkpoint and D6 makes planning
  non-headless anyway.
- **`disposition` is an LLM judgment** and may vary run-to-run. Mitigation:
  `test-plan.md` is the deterministic, human-reviewed artifact in the interactive
  planning phase — the human is the determinism gate (now on the correct file).
- **`ship-it` owning the fix loop is more logic** than delegating to `apply`, but
  delegation is impossible (apply won't revisit checked tasks). The diff-assert
  guardrail adds a mechanical check, not just an instruction.
- **Operational amplification under many parallel worktrees** (N docker builds, N
  concurrent CI runs, CodeRabbit rate-limit thrash; `test-down.sh` deleting the
  image forces a rebuild on each fix cycle). Out of architectural scope; a
  serialize/throttle policy and a keep-image-between-cycles optimization are
  follow-ups.
- **Coupling to `generatedBy` output shape.** Orchestrators parse
  `openspec status`/`instructions` JSON; a CLI upgrade could shift it. Mitigation:
  consume the documented JSON contract, not scraped text.
