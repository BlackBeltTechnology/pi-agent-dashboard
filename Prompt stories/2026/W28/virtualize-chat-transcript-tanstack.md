---
session: 019f538e
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 3 memory(ies); heavy steering (6 user prompts); large facts sheet (~15009 tok)"
upgrade_status: pending
openspec_changes: [virtualize-chat-transcript-tanstack]
proposal_excerpt: "This is **Phase 2, Step B** of `reduce-chat-render-cpu-umbrella`: true windowing of the chat transcript via `@tanstack/react-virtual`. The umbrella deferred it explicitly (umbrella task 4.5: \"if Step A misses the budg…"
---

# How we did it: Land the Playwright/Docker e2e suite for TanStack chat virtualization — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The chat transcript had already been re-implemented with `@tanstack/react-virtual`
(Phase 2, Step B of `reduce-chat-render-cpu-umbrella`), but the OpenSpec change
`virtualize-chat-transcript-tanstack` still had a wall of **unchecked test tasks**. The
opening prompt was terse and half-formed:

> *"There are unchecked tasks. Can be made thats with some tests, e2e tests with docker tests, playwright in system browser?"*

The real objective, clarified by the later one-word steers ("tackle", "go on",
"attempt", "commit and continue"), was: **turn the 6-test Playwright skeleton into a
green, committed suite that runs against the `docker/` all-in-one harness driving system
Google Chrome (`PW_CHANNEL=chrome`)**, checking off every task that is *cleanly
automatable as a browser assertion* — and honestly leaving the perf-trace / manual tasks
for later. It ended with archiving the change.

Final result: suite grew **6 → 11 passing tests**, 4+ tasks checked (9.3, 7.2, 6.1, 4.2,
8.2, plus the automatable slice of 10.1), 3 commits on `develop`, change archived + specs
synced.

## 2. TL;DR playbook

1. **Confirm the implementation actually landed** before running tests — grep for
   `useVirtualizer`, the `data-testid` hooks, and the fixtures; count remaining
   `test.fixme`. Don't assume the skeleton is stubbed.
2. **Pre-build the exact per-worktree image tag first.** Derive it with
   `source docker/lib-ports.sh && derive_project "$PWD"`, then
   `COMPOSE_PROJECT_NAME=$P TEST_IMAGE_TAG=$P docker compose … build`. The harness
   `compose up`s **without** `--build` under a 180s health cap — an inline rebuild blows it.
3. **Run the spec:** `PW_CHANNEL=chrome npx playwright test <spec> 2>&1 | tee /tmp/log | tail`.
4. **When a test fails, diagnose the root cause before touching code** — is it a product
   regression, a fixture/timeout calibration issue, or a test-wiring bug? Most were the
   latter two.
5. **Fix calibration, not product:** raise per-test `test.setTimeout()` for fixtures that
   fire real tool calls; wrap racy single-read asserts in `expect.poll` / retrying matchers.
6. **For affordance-dependent tests, verify the DOM precondition exists** (e.g. the
   `turn-bar` only renders when `turnStats` is populated). Add a *dedicated* narrow fixture
   rather than mutating a shared one other specs depend on.
7. **Re-run the full suite after each fix**; keep `tsc --noEmit` clean.
8. **Commit only your own files** (`git add` explicit paths — the tree has concurrent
   changes from other worktree sessions). Run Biome on changed files first.
9. **Archive via the OpenSpec workflow:** sync delta spec → main spec, validate *your*
   capability, `git mv` to `archive/<date>-<name>/`, commit precisely.

## 3. How the collaboration unfolded

**Phase A — Verify the ground truth (Discovery).** Rather than trusting the task list,
the AI grepped the codebase: `useVirtualizer` + `data-testid="chat-scroll-container"` in
`ChatView.tsx`, the `long-transcript` fixture + `LONG_TRANSCRIPT_TAIL` marker, the
`test:e2e:chrome` script. It found the spec was already fully wired (0 `test.fixme`), so
task 9.3 reduced to *"run it and make 6 green"*. **Why it worked:** it separated
"implementation" from "activation" and avoided re-doing landed work.

**Phase B — Fight the Docker harness (Gather/Infra).** The recurring friction of the whole
session: the per-worktree image tag kept getting GC'd/evicted (8 competing worktree
harnesses, load avg 9), so every managed `globalSetup` boot triggered a slow inline
rebuild that overran the 180s health cap. The AI's robust answer was to **pre-build the
exact derived tag immediately before each run**, chaining build→test to minimize the
eviction gap. An attempt to sidestep via manual `test-up.sh` + `PW_E2E_USE_RUNNING=1`
attach mode failed (the manually-booted harness lacked the managed seed/env, so faux
streams never ran) — so the authoritative path stayed the **fresh managed run**.

**Phase C — Root-cause the 3/6 failures (Design/Debug).** First run: 3 passed, 3 failed,
all sharing `waitForTail` never finding the tail. Diagnosis: the 120-turn fixture fires
**120 real `bash` tool calls** that can't settle inside the 60s default per-test timeout.
Fix: `test.setTimeout(240_000)` on the 3 tail-dependent tests → 4 passed. The
`scroll-to-bottom` flake was a streaming race (a row streamed in right after the button
hid) → wrapped the bottom-distance assert in `expect.poll` → 5 passed.

**Phase D — The hard one: `scrollToTurn` (Debug with a corrected hypothesis).** This is
the session's teaching moment. The AI first hypothesized "faux emits no usage → no
`turnStats` → no `turn-bar`" and planned to extend the faux framework. Reading the actual
pi-ai source **corrected the hypothesis mid-flight**: `fauxAssistantMessage` *does* set
`usage` (`withUsageEstimate`). The real cause: a faux scenario drives **one user prompt**,
so only **turn 0** ever gets a `turnIndex`; `turnStats` is sliced to `MAX_TURN_STATS=50`,
so across 120 steps turn 0's single indexed stat is **evicted** → zero `turn-bar` testids.
Surgical fix: a **dedicated ~40-turn `long-transcript-nav` scenario** (turn 0 survives the
50-window) pointed at *only test 4* — no shared-fixture mutation, no image rebuild (faux
scenarios are bind-mounted). → 6/6 green.

**Phase E — Grow coverage task by task (Generate).** Driven by one-word steers, the AI
added: 7.2 (session-switch scroll persistence — ordering load-bearing because
`gotoDashboard`'s `page.goto` reload wipes the in-memory `scrollStateMap`); 6.1 (resume-
within-50px + user-scroll-mid-replay-wins); 4.2 (streaming growth keeps bottom pinned);
8.2 (above-viewport tool-group collapse doesn't yank the viewport — TanStack's
measure-driven scroll adjustment + `overflowAnchor:none`); and the automatable slice of
10.1 (**DOM nodes bounded: 179 vs the 46,918 baseline**, design Decision 7's primary gate).

**Phase F — Commit + archive (Verify/Land).** Biome + `tsc` clean, committed only its own 3
files (concurrent worktree changes left untouched), then followed the OpenSpec archive
workflow: synced the delta spec into the main capability spec, validated, `git mv` to
`archive/2026-07-12-virtualize-chat-transcript-tanstack/`, committed. 3 commits total.

## 4. Prompts that worked

- **The goal prompt** (*"There are unchecked tasks… e2e tests with docker tests, playwright
  in system browser?"*) was vague but carried the two load-bearing constraints — **docker
  harness** and **system browser** — which is what let the AI pick the right runner
  (`PW_CHANNEL=chrome` against the `docker/` harness) without a round-trip. A stronger
  version: *"Check off the cleanly-automatable e2e test tasks in `virtualize-chat-transcript-tanstack`
  by running `tests/e2e/chat-transcript-virtualization.spec.ts` via the docker harness +
  system Chrome; diagnose failures as calibration vs product; commit only my files."*
- **High-leverage one-word steers** ("tackle", "go on", "attempt", "commit and continue")
  worked *only because* the AI had already framed each next task and its risk in the prior
  summary — the human was approving a pre-scoped plan, not issuing a fresh instruction.
- **The closing steer** (*"the tests I will make later. Archive and commit"*) cleanly drew
  the line between automatable-now and defer-manual, and triggered the archive workflow.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after each task and summarize, awaiting direction | Terse "go on"/"tackle"/"attempt" unlocks | State up front: "work through ALL cleanly-automatable test tasks, don't stop between them" |
| Commit a batch of tasks together | "commit and continue" — commit then keep going | Say "commit after each landed task, then continue" |
| Risk over-scoping into manual/perf tasks | "the tests I will make later. Archive and commit" | Declare the automatable/manual boundary in the goal prompt |
| Chase a plausible-but-wrong root cause (faux "emits no usage") | (self-corrected by reading source) | Verify the DOM/data precondition empirically before proposing a framework change |

## 6. Skills, tools & memory created — and why they're effective

No skills were created; **3 memories** were saved (2 landed in `project`, the store was
near capacity). They capture the two non-obvious traps this session paid to learn:

- **scroll-to-TURN fixture gotcha** — *a faux scenario drives ONE user prompt, so only
  turn 0 gets a `turnIndex`; `turnStats` is sliced to `MAX_TURN_STATS=50`, so a >50-turn
  fixture evicts turn 0's stat and the `turn-bar` never renders.* Reusable because any
  future turn-navigation e2e will hit it; the fix (a short dedicated scenario) is
  non-obvious. **Invoke when:** writing/​debugging any `scrollToTurn` or per-turn-stats e2e.
- **docker harness gotchas under load** — *`globalSetup` boot race (evicted per-worktree
  image → inline rebuild overruns the 180s health cap → pre-build the derived tag first),
  and attach-mode (`PW_E2E_USE_RUNNING=1`) is not viable because the manual harness lacks
  the managed seed/env.* **Invoke when:** any e2e run flakes on boot or times out under a
  loaded multi-worktree machine.

**Recommendation:** promote the "pre-build the derived tag, then chained build→test managed
run" recipe into the `run-dashboard-e2e-local-changes` skill — it recurred ~6× this session.

## 7. Pitfalls & dead ends

- **Boot race (recurring):** the harness `compose up`s without `--build` under a 180s cap;
  an evicted image tag forces an inline rebuild that overruns it. **Do:** `source
  docker/lib-ports.sh; P=$(derive_project "$PWD")` then pre-build that exact tag, chained
  build→test, *before each run*.
- **Attach mode dead end:** `test-up.sh` + `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=<derived>`
  seems like it dodges the boot race, but the manually-booted harness carries stale
  onboarding state / lacks the managed seed → `startLongStream` 1-min timeouts. **Do:**
  use a fresh **managed** run instead.
- **Wrong root cause:** don't assume "no `turn-bar`" means "faux emits no usage" — it emits
  usage; the cause is the one-user-turn + `MAX_TURN_STATS=50` eviction. **Verify data
  preconditions in source before changing a framework.**
- **`Locator.evaluate((cb), arg)` signature slip:** the callback receives `(element, arg)`.
  Writing `(idx) => Number(idx)` silently binds the DOM element to `idx` → `NaN` query.
  Use `(el, idx) => …`.
- **Shared-fixture mutation:** `long-transcript` is also used by `chat-render-perf.spec.ts`
  and `chat-render-fx.spec.ts` (they need ~120 turns). **Do:** add a dedicated
  `long-transcript-nav` scenario for the narrow case, don't shrink the shared default.
- **`gotoDashboard` reload wipes `scrollStateMap`:** it does a full `page.goto("/")`, so
  spawn both sessions **first**, then switch via **card clicks** (client-side wouter nav,
  `/session/:id` URL as the switch signal).
- **Single-read asserts flake under load:** `expect(await x.count()).toBeGreaterThan(0)`
  hits transient turn-boundary gaps → convert to `expect.poll` / retrying matchers.
- **Commit hygiene:** the working tree had concurrent changes from other worktree sessions
  (`ChatView.tsx`, `groups.json`, other `openspec/changes/*`). **Do:** `git add` explicit
  paths only; a heredoc commit message choked once — use a `-F /tmp/msg.txt` file.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** Docker running, system Google Chrome installed, the
implementation already landed on `develop`, the OpenSpec change dir present.

- [ ] Grep-confirm the impl landed (`useVirtualizer`, testids, fixtures; 0 `test.fixme`).
- [ ] `source docker/lib-ports.sh; P=$(derive_project "$PWD")` → pre-build tag `$P`.
- [ ] Chained build→test managed run: `PW_CHANNEL=chrome npx playwright test <spec> | tee /tmp/log`.
- [ ] Classify each failure: product vs timeout-calibration vs test-wiring. Fix the latter two.
- [ ] Raise `test.setTimeout()` for real-tool-call fixtures; `expect.poll` racy reads.
- [ ] For affordance tests, verify the DOM precondition; add a narrow dedicated fixture.
- [ ] `tsc --noEmit` + Biome on changed files clean; re-run full suite green.
- [ ] `git add` explicit paths, commit per landed task.
- [ ] Archive: sync delta→main spec, validate your capability, `git mv` to `archive/`, commit.

**Final artifacts:**
`tests/e2e/chat-transcript-virtualization.spec.ts` (6→11 tests),
`qa/fixtures/faux-scenarios.ts` (new `long-transcript-nav`),
`openspec/changes/…/tasks.md`, synced `openspec/specs/chat-transcript-virtualization/spec.md`,
archived under `openspec/changes/archive/2026-07-12-virtualize-chat-transcript-tanstack/`.
Commits: `557da6475`, `0dbeb39a4`, `69b9b655d` on `develop`.

---

_Generated from session `019f538e` · `pi-agent-dashboard` · 2026-07-12. Source extract: session-to-guideline facts sheet._
