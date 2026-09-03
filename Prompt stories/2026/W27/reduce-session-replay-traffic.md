---
session: 019f15ae
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts); large facts sheet (~18417 tok)"
upgrade_status: pending
openspec_changes: [reduce-session-replay-traffic]
proposal_excerpt: "Opening a session that the client has seen before re-ships the entire chat history. The transport is event-sourced: `pi → bridge → server in-memory buffer (seq-numbered) → WS broadcast`. The subscribe protocol is *alr…"
---

# How we did it: Reduce session replay traffic — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The first prompt was a single line: `/skill:openspec-apply-change reduce-session-replay-traffic`.
The real objective, once the design questions were resolved: **stop re-shipping the
whole chat history every time a client re-opens a session it has already seen.** The
transport is event-sourced (`pi → bridge → seq-numbered server buffer → WS broadcast`),
so the fix had two composable strategies — **(A)** persist a per-session replay cursor
in the browser so reloads delta-subscribe (`lastSeq = persistedMaxSeq`) instead of
full-replaying, and **(B)** trim the bytes of heavy tool results during replay. It
started as a 28-task spec-driven change and ended squash-merged as PR #207 —
after surviving a mid-flight design collision with `develop`.

## 2. TL;DR playbook

1. **Kick off with the apply skill:** `/skill:openspec-apply-change <change-name>` — it reads the proposal/design/tasks and drives the phased build.
2. **Resolve the open design questions FIRST** (the tasks left "does Strategy B ship now or defer?" open). Decide *persist raw events, re-reduce on load* (cache binds to the stable wire schema, not reducer output) and record the decision in `design.md` before writing code.
3. **Build phase-by-phase, TDD:** write the failing test, then the module — `replay-cache.ts` (IndexedDB, `{schemaVersion, maxSeq, raw-events}`, byte cap + LRU) → `replay-persist.ts` (debounced writer) → `rehydrate-session.ts` (re-reduce) → wire into `App.tsx`/`useMessageHandler.ts`.
4. **Verify in isolation, not in the full suite:** the repo has known-flaky server tests + a jimp baseline; re-run *only your* touched packages in isolation to prove green.
5. **Add browser E2E against the Docker harness** (`tests/e2e/`, Playwright) — drive sessions with the **faux model** (`[[faux:<id>]]`, `PI_E2E_SEED=1`); no real LLM needed.
6. **Rebuild the Docker image from your worktree** (`docker compose up --build`) before every E2E run — `test-up.sh` does *not* rebuild, so it silently runs stale code.
7. **Assert at the wire level, not the DOM** for replay behaviour — inspect `event_replay` WS frames instead of chasing virtualization/rendering timing.
8. **Ship with the ship skill:** `use ship-change skill` — verify gate → archive + sync specs → PR → watch CI → resolve CodeRabbit → squash-merge → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Design lock (Discovery).** The AI read all context + key source files,
then *stopped before writing code* to confirm the four open Phase-1 questions —
crucially "persist raw events vs reduced messages" (chose raw: reducer is pure, cache
binds to the stable event schema) and "does Strategy B ship now?" (chose A+B together).
**Why it worked:** recording decisions in `design.md` before touching 6+ files kept the
build coherent. **Decision point:** the human said "go on" — approving A+B together.

**Phase 2–4 — Strategy A, TDD (Build).** Failing test first for each module:
`replay-cache.ts`, `replay-persist.ts` (debounced raw-event buffer), `rehydrate-session.ts`,
then wired into `App.tsx` + `useMessageHandler.ts`. App.tsx is 2043 lines with no test
harness, so the AI **extracted the rehydration core into a testable helper** rather than
trying to test the monolith. **Why it worked:** small pure helpers around a large
untestable component.

**Phase 5–8 — Strategy B + full verify.** Server-side stub emission, a JSONL
full-fidelity route keyed by `toolCallId`, lazy render in `ToolCallStep`. Full-suite
run showed 28 failures — the AI **triaged them in isolation** and proved every one was
either the jimp baseline or a flaky-under-load server test, not the change.

**Phase 9 — Playwright/Docker E2E (the long tail).** The human asked "possible to test
with playwright/docker?" then "use system chrome". The AI added an env-gated
`PW_E2E_CHANNEL=chrome` mode, wrote two specs, and then fought the Docker harness for
~2 hours. This phase surfaced **three real bugs the deterministic tests missed** (see §7).

**Phase 10 — Ship, and the collision.** `use ship-change skill` drove verify → archive →
PR #207. Mid-flight, `develop` shipped the *same* "Show full output" feature (#203) via
a different mechanism. The AI **stopped and surfaced the collision** rather than
silently resolving it, then reworked Strategy B into a minimal server-side replay
truncation reusing develop's UI/route. Then looped CI + CodeRabbit to green and
squash-merged.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change reduce-session-replay-traffic`. Effective because the change already had a proposal/design/tasks; the skill turns those into a phased build. A stronger kickoff would add one line up front: *"resolve the open design questions in tasks.md and record them in design.md before writing code."*
- **"Is it possible to test with playwright/docker?"** — high leverage: unlocked an entire E2E layer and, as a side effect, exposed the three production bugs. Reframe as a directive next time: *"add browser E2E in tests/e2e against the Docker harness for both strategies."*
- **"but use system chrome"** — one short correction that shaped the harness (added `PW_E2E_CHANNEL=chrome`). Bake this into the harness default-doc so it isn't rediscovered.
- **"retry" / "go on"** — cheap continuations that let the AI keep iterating the Docker loop without re-explaining context.
- **"use ship-change skill"** — delegated the entire land-it workflow (archive → PR → CI → CodeRabbit → merge → worktree cleanup) to one skill.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stay in unit-test land, confident the feature worked | "Is it possible to test with playwright/docker?" | Make browser E2E a required phase for any replay/rendering change |
| Reach for bundled chromium | "but use system chrome" | Default the harness to `PW_E2E_CHANNEL=chrome` and document it |
| Trust `test-up.sh` to reflect worktree code | (implicit — repeated "retry" while it ran stale images) | Always `docker compose up --build` from the worktree before E2E |
| Chase a missing DOM tool-card through virtualization timing | Kept saying "retry" until the AI switched to **wire-level `event_replay` assertions** | Assert replay at the WS-frame level, never the rendered DOM |
| Assume tool results are flat strings (disk-replay shape) | The E2E failure forced discovery that live results are `{content:[{type:"text",text}]}` | Handle the content-block shape in any tool-result byte logic |
| Assume "truncated to 4 KB" from the proposal was real | The wire probe showed `maxStringFieldSize: 0` disables truncation in prod | Verify runtime config defaults, don't trust proposal prose |
| Let Biome `--write` reorder 92 imports in `bridge.ts` | (self-caught, then reverted) — surgical-changes rule | Lint changed files without `--write`; revert unrelated churn |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created, but the session leaned on several and revealed
gaps worth capturing:

- **`openspec-apply-change`** — drove the whole phased build from proposal/design/tasks. Invoke it whenever a change already has its artifacts and you want a disciplined TDD walk.
- **`ship-change`** — owns the entire land-it loop (verify → archive → PR → CI watch → CodeRabbit triage → squash-merge → worktree removal). Invoke after implementation is done; it even handled a mid-ship `develop` collision.
- **Faux-scenario harness** (`qa/fixtures/faux-scenarios.ts` + `[[faux:<id>]]`, `PI_E2E_SEED=1`) — drives real pi sessions (real tool calls, real persisted results) with no LLM. Note the single-step scenario pitfall (§7).
- **`general-purpose` subagents** for docs — 5 spawns, all to append file-index rows in caveman style per the Documentation Update Protocol. Effective because it keeps doc-writing out of the main context and enforces the style rule.

**Recommend creating a skill:** *"run-dashboard-e2e-local-changes"* capturing the
rebuild-from-worktree + system-chrome + wire-level-assertion recipe. (This session's
pain is exactly what that skill would prevent — and it now exists in `.pi/skills/`.)

## 7. Pitfalls & dead ends

- **`test-up.sh` runs stale code.** It does `docker compose up` *without* `--build`. The first ~2 hours of E2E failures were all the container running an image predating the change. **Fix:** `docker compose up -d --build` from the worktree; verify the feature symbol is in the image (`grep` the built server) before running.
- **Single-step faux scenarios loop forever.** A one-step `toolScenario` makes a real pi session re-call the model endlessly ("100% context used"). **Fix:** use a terminating two-step script, mirroring `tool-screenshot`.
- **Parallel worktree contention.** Another worktree's E2E harness rebuilt the shared `pi-dashboard:local` tag and reaped containers under disk pressure — the "churn" wasn't random. **Fix:** rebuild from *your* worktree immediately before the run; expect a shared-tag race.
- **DOM assertions for replay are brittle.** The tool-card "missing on cold replay" was a virtualization/timing artifact, not a product bug (proven by a deterministic reducer test). **Fix:** assert `event_replay` WS frames, not rendered cards.
- **Three real bugs the unit tests missed** (all found only via E2E): (1) live results are structured content-blocks, not strings; (2) `maxStringFieldSize: 0` disables truncation by default in prod; (3) LRU keyed on `Date.now()` ties under fast execution — use a monotonic counter.
- **`gh pr merge` fails in a worktree** on the local-checkout step even when the remote squash-merge succeeds. **Fix:** verify PR state (`MERGED`), then delete the remote branch + remove the worktree manually from the parent repo.
- **Biome `--write` churns huge files.** It reordered every import in `bridge.ts`. **Fix:** lint changed files without `--write`; revert to keep the diff surgical.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change (proposal/design/tasks), Docker running,
system Chrome installed, a clean worktree.

1. `/skill:openspec-apply-change <change-name>`
2. Resolve + record open design questions in `design.md` *before* coding.
3. TDD each module: failing test → module → wire in. Extract testable helpers out of large components.
4. Prove green by re-running *only touched packages in isolation* (ignore jimp baseline + flaky server tests).
5. Add `tests/e2e/*.spec.ts` driven by faux scenarios (terminating two-step); assert at the WS-frame level.
6. `docker compose up -d --build` from the worktree; confirm the feature symbol is in the image, then `PW_E2E_CHANNEL=chrome npx playwright test`.
7. `use ship-change skill` — expect a possible `develop` collision; surface it, don't resolve silently.

**Artifacts produced:** `packages/client/src/lib/{replay-cache,replay-persist,rehydrate-session}.ts`,
`packages/server/src/replay-truncate.ts`, `tests/e2e/replay-*.spec.ts`,
`qa/fixtures/faux-scenarios.ts` (bash-large), env-gated `PW_E2E_CHANNEL` in
`playwright.config.ts` + `tests/e2e/global-setup.ts`. Landed as PR #207 (squash
`0231baa8`).

---

_Generated from session `019f15ae-fa68-7b45-b976-c5060b33a9bc` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-30. Source extract: `/tmp/facts-1784847997-27189.md`._
