---
session: 019f587b
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "yes — created 0 skill(s) / 2 memory(ies); large facts sheet (~11738 tok)"
upgrade_status: pending
openspec_changes: [simplify-error-retry-single-card]
proposal_excerpt: "The current error-lifecycle surface stacks TWO cards for one failure — a red error block and an amber retry block — and drives classification with two brittle regexes (RETRYABLE_PATTERN, USAGE_LIMIT_PATTERN) that…"
---

# How we did it: Simplify the error/retry surface into one card — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a narrow question: *"Is it possible to make e2e tests for unchecked
task? Use playwright and system browser."* On the surface that's a feasibility check for
the unchecked QA tasks in the `simplify-error-retry-single-card` OpenSpec change.

The **real** objective emerged the moment the AI opened the worktree: the OpenSpec
tasks.md had tasks 1–5 checked `[x]`, but **the code was still the old two-card design**
(HEAD == develop tip, clean tree, no diff). So the true job was: *implement the entire
single-card refactor TDD-first (the checkboxes were lying), then answer the e2e-feasibility
question honestly by spiking it against the real Docker + system-browser harness, then
ship the change through CI + CodeRabbit and land it on `develop`.*

## 2. TL;DR playbook

1. **Reconcile checkbox vs. reality first.** `git status`, `git diff develop`, and grep for
   the symbols the change claims to remove (`RETRYABLE_PATTERN`, `USAGE_LIMIT_PATTERN`,
   `retry-banner`). If they're still present, the tasks.md is lying — implement, don't test.
2. **Let the design doc break ties.** When tasks.md and design.md disagree, design wins.
   Here **D5** ("manual *Try again* removed entirely") overrode older task wording.
3. **Implement TDD, one task per checkpoint, test-first.** Order by risk: leaf tracker →
   reducer → component → App wiring → risky bridge surgery last.
4. **Delete dead code + its tests together.** Grep for residual importers *before* `git rm`,
   then `tsc --noEmit` scoped to touched packages to confirm no dangling refs.
5. **Run the isolated Docker harness on pinned ports**, attaching Playwright with
   `PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome` — the first-time image build (~6–8 min) exceeds
   the managed 180s health poll, so build+boot manually then attach.
6. **Spike the risky feasibility claim before promising it.** The faux harness *cannot*
   drive pi's real retry loop — prove it with a throwing faux scenario + container logs,
   then revert the spike artifacts cleanly.
7. **Ship via ship-change**: mark deferred QA tasks with honest annotations, verify gate,
   `openspec archive`, commit `-F`, PR against `develop`, watch CI, confirm CodeRabbit,
   squash-merge, then remove the worktree **from the parent repo** last.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & reconciliation.** The AI read `error-lifecycle.spec.ts`, the faux
scenario catalog, `retry-tracker.ts`, and `tasks.md`, then ran `git status` / `git diff
develop`. It caught the decisive fact: **tasks 1–5 were checked but unimplemented.** It
surfaced this as a blocker instead of blindly writing e2e tests that could never pass.
*Why it worked:* trust filesystem reality over checkbox state.

**Phase 2 — Plan from the design doc.** The AI loaded design.md, found **D5** (manual
retry removed entirely), and let it override the stale tasks 4.1/7.3 wording. It laid out a
5-task, risk-ordered TDD plan (leaf tracker first, bridge surgery last).

**Phase 3 — Implement TDD.** Task 2 (`RetryTracker` rewritten observe-based, 13/13) → Task 1
(`deriveBannerState` always `error.kind:"error"`, drop `limit-exceeded`, reducer 173/173) →
Task 4 (`SessionBanner` single composed card, clear-only ✕, 9/9) → Task 5 (`App.tsx`
`onDismiss` clears only) → Task 3 (bridge surgery: remove usage-limit auto-abort, drive
tracker from observed `message_start`/`message_end`/`agent_end`; **deleted**
`usage-limit-orderer.ts`, `error-patterns.ts` + 6 dead test/fixture files). 195/195 in
touched suites, tsc clean on touched packages, AGENTS tree rows updated in caveman style.

**Phase 4 — The retry spike (decision point).** The user asked *"Can integration gate be
tested with docker tests and playwright with system browser?"* The AI booted the Docker
harness (`DASHBOARD_PORT=18000 PI_GATEWAY_PORT=19000 PI_E2E_SEED=1 PI_TEST_PEERS=both
./docker/test-up.sh`), attached with `PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome`, and added a
throwing faux `overloaded` scenario. Container logs were **conclusive**: pi-ai's faux stream
catches the throw and converts it to a terminal `stopReason=error` — it never propagates as a
retryable transport exception into pi's `_handleRetryableError`. **The faux harness cannot
drive pi's real retry loop.** The AI reverted all spike artifacts cleanly.

**Phase 5 — Ship.** The user said *"I will test later, ship-change."* The AI ran the
ship-change flow: annotated the two remaining tasks (6.2 = N/A deploy step in a worktree;
6.4 = CodeRabbit already 0 Critical/Warning), verified gate (image-fit Jimp + server flakes
were pre-existing/load-induced, proven green in isolation), `openspec archive`, commit
`3391ff4fd`, **PR #294** → `develop`, **CI green (9m3s)**, CodeRabbit 0 comments,
squash-merged (`1a9c6df`), remote branch deleted, worktree removed.

## 4. Prompts that worked

- **Goal prompt** — *"Is it possible to make e2e tests for unchecked task? Use playwright and
  system browser."* Effective because it scoped the tool (Playwright) and the environment
  (system browser) up front. It would have been *stronger* as: *"Verify the unchecked QA tasks
  in change X are actually implemented; if not, implement them TDD, then tell me which are
  e2e-testable via Playwright + system browser and which aren't."* — because it names the
  reconcile-first step the AI had to discover on its own.
- **High-leverage follow-up** — *"Can integration gate be tested with docker tests and
  playwright with system browser?"* Unlocked the whole spike phase: it forced the AI to
  distinguish *what the Docker+Chrome gate can prove* from *what only unit tests can*.
- **"yes"** — a one-word approval that greenlit re-booting the harness and running the full
  integration slice.
- **"I will test later, ship-change."** — cleanly handed off the manual-QA burden and named
  the exact skill (`ship-change`) to run, so no back-and-forth was needed.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat checked tasks as done | (AI self-caught) verifying `git diff develop` first | Always reconcile tasks.md against filesystem before acting |
| Answer feasibility abstractly | *"Can integration gate be tested with docker + playwright?"* | Demand a runtime spike, not a hand-wave, for any "is X possible" claim |
| Leave the retry sub-line as an open promise | Forcing the throwing-faux spike | Prove the negative with container logs before declaring infeasible |
| Keep iterating past "done" | *"I will test later, ship-change"* | Accept an explicit defer + a named ship skill as the stop signal |
| Blame the change for red tests | (AI self-caught) running failures in isolation | Re-run suspect failures isolated to separate flakes/pre-existing from real regressions |

## 6. Skills, tools & memory created — and why they're effective

- **Two failure/tool-quirk memories** captured the same durable finding: *the pi-dashboard e2e
  faux harness (`qa/fixtures/faux-provider.ext.ts`) cannot drive pi's real provider retry loop —
  a faux error (returned OR thrown) becomes a terminal `stopReason="error"`; pi-ai's faux stream
  never propagates it as a retryable transport exception.* **Why effective:** it stops a future
  session from re-attempting the same dead-end spike, saving a full Docker rebuild cycle. The
  finding is also durably recorded in `tasks.md` (7.1) and `tests/e2e/AGENTS.md`.
- **No skill was created**, but the workflow is clearly repeatable. A **`spike-faux-retry-loop`**
  or, more broadly, a **`reconcile-tasks-before-implementing`** project skill should be created:
  the "checked ≠ implemented → verify via `git diff` → implement TDD" pattern recurs whenever a
  worktree's OpenSpec tasks.md is inherited in an unknown state.

## 7. Pitfalls & dead ends

- **Managed Docker health poll (180s) < first-time image build (~6–8 min).** The `test-up.sh`
  managed path gives up before the image finishes. *Fix:* build+boot detached, then attach with
  `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=18000 PW_GATEWAY_PORT=19000`.
- **`ENOSPC: no space left on device` during rebuild.** 29 stale `pi-dash-test-*` images (83.7GB)
  + 86.5GB build cache from prior sessions. *Fix:* `docker image prune -af` + `docker builder
  prune -af` (reclaimed ~165GB) — but the warm cache is then gone, so the next build is full-length.
- **"all predefined address pools have been fully subnetted."** 27 leftover Docker networks from
  prior runs. *Fix:* `docker container prune -f` + network prune (33→6 networks).
- **Throwing faux scenario ≠ real retry.** pi-ai's faux stream catches the throw → terminal error.
  Don't expect the `retry-banner` sub-line to appear; it can't via the faux harness.
- **False-red full-suite failures.** `pi-image-fit-extension` (local Jimp `is not a constructor`
  breakage) + `search-files-ranking` / `doctor-route` / `recovery-offer` load-induced timeouts —
  all **pass in isolation**. Re-run isolated before blaming your change.
- **Removing the worktree kills your own cwd.** Step 10 of ship-change runs *inside* the worktree;
  once removed, the Bash tool's cwd is gone. Run remaining cleanup from the parent repo.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change worktree (`.worktrees/os-<name>`) and its `design.md` + `tasks.md`.
- Docker running with adequate disk (prune stale `pi-dash-test-*` images/networks first).
- System Chrome installed (`PW_CHANNEL=chrome`).
- `gh` authed for PR + merge.

**Checklist:**
1. `git status` + `git diff develop` + grep the to-be-removed symbols → confirm real state.
2. Read `design.md`; let it override stale tasks.md wording.
3. Implement TDD, risk-ordered (leaf → bridge last), one checkpoint per task.
4. Grep residual importers, `git rm` dead code + tests, `tsc --noEmit` scoped to touched packages.
5. Prune Docker, boot harness on pinned ports detached, poll `/api/health`, attach Playwright with
   `PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome`.
6. Spike any risky feasibility claim; prove the result with container logs; revert artifacts.
7. `ship-change`: annotate deferred tasks, verify gate (isolate flakes), `openspec archive`,
   commit `-F`, PR → `develop`, watch CI, confirm CodeRabbit, squash-merge, remove worktree from parent.

**Final artifacts produced:**
- `packages/extension/src/retry-tracker.ts` (+ test) — observe-based rewrite.
- `packages/client/src/components/SessionBanner.tsx` (+ test + sidecar) — single composed card.
- `packages/client/src/lib/event-reducer.ts` — `deriveBannerState` always `error.kind:"error"`.
- Deleted: `usage-limit-orderer.ts`, `error-patterns.ts` + 6 dead test/fixture files.
- `tests/e2e/error-lifecycle.spec.ts` — new single-card + clear-only-✕ (task 7.2) coverage.
- PR #294, squash commit `1a9c6df`, merged to `develop`.

---

_Generated from session `019f587b-ec32-7454-8285-6d7e03ef7dc8` · `pi-agent-dashboard` · 2026-07-13. Source extract: `/tmp/facts-1784847744N.md`._
