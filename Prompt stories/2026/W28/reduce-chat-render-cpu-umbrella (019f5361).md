---
session: 019f5361
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [reduce-chat-render-cpu-umbrella]
proposal_excerpt: "A long-chat session page (`/session/<id>`) pegs the browser main thread at ~100 % for **any viewer who opens it** — not only the typing user. A 102.6 s Chrome performance trace of a live session shows 102.3 s main-thr…"
---

# How we did it: E2E-gate the un-covered slices of the reduce-chat-render-cpu umbrella — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The opener was a scoping question, not a build order:

> *"Is it possible to create tests for missing tasks with e2e and docker tests with playwright and system browser?"*

The attached change (`reduce-chat-render-cpu-umbrella`) had **7 unchecked tasks** — a
mix of behavioral fixes (reduced-motion animation contract, scroll auto-follow) and
performance budgets (idle layout churn under a ceiling). The *real* objective, once
the steering turns landed, was: **for the subset of open tasks that a Playwright +
Docker-harness + system-Chrome gate can honestly assert, write those specs, verify
them green against the live harness, record the measured perf number, then archive
the change** — while explicitly leaving the trace-diff / subjective-smoothness tasks
as manual work for ship. The win: distinguish *automatable* from *manual*, and only
automate what browser-truth can prove.

## 2. TL;DR playbook

1. **Ground before writing.** Read the change's `design.md` + `tasks.md`, then grep
   the repo for the exact hooks the tests will touch (`prefers-reduced-motion` CSS
   blocks, the `chat-cv` toggle, faux-fixture tail markers, `chat-stream-live` FX
   rules). Confirm `playwright.config.ts` already supports `PW_CHANNEL=chrome`.
2. **Split the open tasks into two buckets:** behavioral (assertable as browser
   truth) vs. numeric/subjective (trace-diff, main-thread-busy%, "feels smooth").
   Only the first bucket becomes a gate.
3. **Check for existing coverage first** — the tanstack windowing spec
   (`chat-transcript-virtualization.spec.ts`) already gated scroll-lock/jump, so
   don't duplicate; write only the *un-gated* surface (reduced-motion + auto-follow).
4. **Write two specs:** a *blocking* behavioral spec (`chat-render-fx.spec.ts`) and
   an *opt-in advisory* CDP perf probe (`chat-render-perf.spec.ts`, `test.skip`
   unless `PW_PERF=1`).
5. **Type-check first** (`npx tsc --noEmit`) — the cheap gate before the slow harness.
6. **Run against the harness.** If the managed build overruns the 180s health poll,
   **attach to a running healthy container** on its derived ports (`PW_E2E_USE_RUNNING=1
   PW_E2E_PORT=… PW_GATEWAY_PORT=… PW_CHANNEL=chrome`) — valid only because the specs
   test already-shipped behavior (no app code changed).
7. **Fix fixture mismatches, not "product bugs":** auto-follow needs a transcript that
   *overflows* the viewport → use `[[faux:long-transcript]]`, base overflow on
   `scrollHeight - clientHeight`.
8. **Run the CodeRabbit gate, commit, record the measured number** (idle layouts/s =
   1.0 vs ~85/s baseline) in `tasks.md`, then **archive + sync the 3 delta specs**.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & feasibility triage.** The AI read the change artifacts and
E2E infra, then grepped for whether any spec already taps Chrome DevTools Protocol
for perf metrics. It returned a *grounded assessment table*: 7 open tasks split into
Bucket 1 (behavioral → strong e2e gates) and Bucket 2 (numeric/subjective → manual).
This honesty — "here's what a gate can and cannot prove" — set the whole session's
scope. **Decision point:** the human replied `1 and 2` (do both buckets).

**Phase 2 — Re-grounding to avoid duplication.** Before writing, the AI discovered
that Phase 2 Step B (tanstack windowing) had *already shipped* with its own spec that
gated task 4.3's scroll bullets. It narrowed the genuinely un-gated surface to the
reduced-motion animation contract + one auto-follow bullet + the idle-layout perf
budget. This is the session's most valuable move: **it refused to write redundant
tests** per the surgical/DRY rules.

**Phase 3 — Generate.** Two specs written against *real* CSS hooks: computed
`animation-name` on `.chat-stream-live::before/::after` flipping to `none` under
`emulateMedia({reducedMotion:'reduce'})` (browser-truth, not CSS-source inspection),
plus a CDP `Performance.getMetrics()` idle-window sampler. Wired `test:e2e:perf` into
`package.json` and added two `tests/e2e/AGENTS.md` rows.

**Phase 4 — Verify against the live harness.** tsc clean → Playwright list (3 tests)
→ managed run. The container build overran the 180s poll, so the AI consulted the
project skill and **attached to a running healthy container** for fast signal. 2/3
passed; the one failure was a fixture mismatch (`slow-stream` never overflows), fixed
by switching to `long-transcript` and overflow-based detection. Final run: all 3
green. **Decision points:** `yes` (proceed), `run perf tasks`, `enough` (keep the
perf probe advisory, don't make it blocking).

**Phase 5 — Land & archive.** CodeRabbit gate green (0 Critical/Warning), committed,
recorded measured idle layouts/s = 1.0. On `archive it, the manual tests be made
later`, the AI spawned a subagent to sync the 3 new-capability delta specs to
`openspec/specs/`, archived the change, and confirmed the 3 spec files landed in the
commit. On `commit`, it reported everything already committed and flagged untracked
files belonging to a *different* concurrent change as not-its-to-land.

## 4. Prompts that worked

- **The goal prompt** (`Is it possible to create tests for missing tasks…`) worked
  because it framed the ask as a *feasibility question*, which invited the AI to
  triage rather than blindly generate. A stronger version bakes in the discipline the
  AI supplied on its own: *"For the open tasks in `reduce-chat-render-cpu-umbrella`,
  tell me which can be honestly gated by Playwright + the Docker harness + system
  Chrome vs. which stay manual, then write only the automatable, un-duplicated ones
  and verify them green."*
- **`1 and 2`** — high-leverage: the AI had offered two buckets, so a two-token reply
  authorized the full scope.
- **`run perf tasks`** — unlocked the measured-number capture (1.0 layouts/s) that
  turned an advisory probe into recorded evidence.
- **`enough`** — a crucial *scope-cap* steer: kept the perf spec advisory instead of
  letting the AI wire a brittle blocking budget.
- **`archive it, the manual tests be made later`** — explicitly deferred the manual
  tasks, letting the AI archive with incomplete boxes intact.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Offer both automatable + manual buckets and wait | `1 and 2` | State up front "do the automatable subset; list the manual remainder" |
| Consider making the perf probe a *blocking* CI gate | `enough` | Declare "perf probe stays advisory (absolute ceiling, no CI flake)" in the ask |
| Keep verifying/summarizing after green | `enough` / `commit` | Give an explicit stop condition ("green + committed = done") |
| Hold at the archive decision point | `archive it, the manual tests be made later` | Pre-authorize "archive even with manual boxes unchecked" |
| Nearly duplicate an already-shipped spec's coverage | (self-corrected via re-grounding) | Always grep for an existing spec covering the task before writing |

The quality bar the human imposed implicitly: **don't over-automate.** Advisory beats
a flaky blocking gate; manual-and-honest beats auto-asserted-but-fake.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session, but two existing project assets did
the heavy lifting and are worth invoking again:

- **The `run-dashboard-e2e-local-changes` project skill** — consulted when the managed
  harness overran the 180s health poll. It documents the *attach-to-running-container*
  fast path (`PW_E2E_USE_RUNNING=1` + derived ports). Invoke it whenever a first-time
  Docker image build overruns global-setup and your specs test already-shipped
  behavior (no app code changed).
- **The `general-purpose` subagent for spec sync** — spawned to sync the 3 delta specs
  to main specs. Isolates the mechanical sync from the main context.

**Recommended skill to create:** *"e2e-gate-openspec-tasks"* — codify the Bucket-1
vs-Bucket-2 triage, the grep-before-write anti-duplication check, the type-check →
list → attach-to-running-container verification ladder, and the "advisory perf probe,
never a flaky blocking budget" rule. This session is a clean template for it.

## 7. Pitfalls & dead ends

- **Managed harness build > 180s health poll.** First-time image build was still in
  `npm install && npm run build` at 128s when global-setup's 180s poll expired. *Fix:*
  attach to an already-healthy container (only valid when no app code changed), or
  pre-build your exact tag first so there's no poll pressure.
- **Foreign-worktree container.** The running healthy container derived to a *different*
  project tag (`3987220742`) than the cwd (`622094916`). The AI used it only for a
  fast attach-smoke because the specs test shipped behavior — not as the authoritative
  gate. Watch this in multi-session repos.
- **Auto-follow "failure" that wasn't a bug.** `slow-stream` is a single modest message
  that never overflows the viewport, so `scrollHeight ≈ clientHeight` → nothing to
  follow. *Fix:* use `[[faux:long-transcript]]` and base the overflow predicate on
  `scrollHeight - clientHeight`, not on stream state.
- **Concurrent-session commit-hash drift.** Commit hashes shifted (`940fa716b` →
  `c918487cb`) because other sessions committed alongside — normal here, not a lost
  commit. Verify by content, not by remembered hash.
- **Untracked files from another change.** `fix-table-copy-empty-clipboard/*` showed up
  in `git status`; the AI correctly left them alone rather than sweeping them in.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change with unchecked tasks; a healthy Docker
harness (or time to build one); system Chrome installed; `PW_CHANNEL=chrome` support
in `playwright.config.ts`.

- [ ] Read `design.md` + `tasks.md`; grep the exact CSS/toggle/fixture hooks the tests
      will assert (`prefers-reduced-motion`, `chat-cv`, `chat-stream-live`, faux tail
      markers).
- [ ] Triage open tasks: behavioral (gate) vs numeric/subjective (manual).
- [ ] Grep for an existing spec already covering each behavioral task — **skip duplicates.**
- [ ] Write a *blocking* behavioral spec + an *opt-in advisory* CDP perf probe
      (`test.skip` unless `PW_PERF=1`; skip non-Chromium).
- [ ] `npx tsc --noEmit` → `npx playwright test --list` (both cheap; no container).
- [ ] Run against the harness; if the build overruns the poll, attach to a healthy
      container: `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=… PW_GATEWAY_PORT=… PW_PERF=1
      PW_CHANNEL=chrome npx playwright test chat-render-fx chat-render-perf`.
- [ ] Fix fixture mismatches (overflow → `long-transcript`), re-run until 3/3 green.
- [ ] CodeRabbit gate → commit → record measured perf number in `tasks.md`.
- [ ] Sync delta specs (subagent) → archive → confirm spec files in the commit.

**Final artifacts produced:**
- `tests/e2e/chat-render-fx.spec.ts` (behavioral, blocking, 2 tests)
- `tests/e2e/chat-render-perf.spec.ts` (advisory CDP perf probe, opt-in `PW_PERF=1`)
- `package.json` (`test:e2e:perf` script) · `tests/e2e/AGENTS.md` (2 rows)
- `openspec/changes/reduce-chat-render-cpu-umbrella/tasks.md` (measured idle
  layouts/s = 1.0 recorded)
- Archived to `openspec/changes/archive/2026-07-12-reduce-chat-render-cpu-umbrella/`;
  3 new capability specs synced to `openspec/specs/`
  (`chat-event-render-batching`, `chat-idle-render-cost`,
  `chat-transcript-virtualization`).

---

_Generated from session `019f5361-eb4d-7b0e-8a2b-a8771bd4e205` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-12. Source extract: `facts.XXXXXX.TiBkNXwNO5`._
