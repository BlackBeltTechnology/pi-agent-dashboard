---
session: 019f1611
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (5 user prompts); large facts sheet (~14196 tok)"
upgrade_status: pending
openspec_changes: [optimistic-prompt-progress]
proposal_excerpt: "When a user sends a prompt to an idle session, the chat shows nothing for the full server round-trip (observed: several seconds) until the bridge emits the user message_start event and the reducer renders the bubble."
---

# How we did it: optimistic prompt progress — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change optimistic-prompt-progress`.
The *real* objective, once the change's proposal/design were read, was to **re-introduce
the optimistic prompt bubble** — the immediate "your message was received" feedback that
fills the multi-second blank gap between hitting send on an *idle* session and the bridge's
first `message_start` event. The tricky constraint: a previous "shadow-queue" version of
this feature had caused a mid-turn ghost-reappearance bug, so the new version had to be
**scoped to idle sends only** and driven by a new bridge→server→browser `prompt_received`
ack, with a progressing `sending → sent → confirmed` visual. The session ran end-to-end:
implement → add real Docker+Playwright E2E coverage → ship the PR to `develop`.

## 2. TL;DR playbook

1. **Kick off apply mode:** `/skill:openspec-apply-change <change-name>`. Let the AI read
   `proposal.md`, `design.md`, and `specs/*/spec.md` before touching code.
2. **Have it record the investigation resolution in `design.md` first**, then implement
   tasks top-down: protocol type → server pass-through → bridge emit → reducer → UI.
3. **For a cross-package worktree change, install `node_modules` in the worktree** so
   edits to `packages/shared` are visible to `tsc` (worktrees resolve shared types from the
   main repo otherwise).
4. **Type-check before writing tests** (`npx tsc --noEmit`), fix fixtures the new required
   field breaks, then write reducer + render + guard unit tests.
5. **Ask for real E2E:** "test with docker and playwright with faux, use system browser."
   Add a spec under `tests/e2e/`, wire `PW_CHANNEL` for the system browser, use faux
   scenarios (`[[faux:slow-stream]]`) for a deterministic mid-turn window.
6. **Let E2E surface real bugs** — here it exposed that a freshly-spawned idle session has
   *no `SessionState` entry yet*, so an over-strict guard (`if (!current) return prev`)
   skipped the optimistic write. Fix the product, not just the test.
7. **Widen the assertion window with `page.routeWebSocket` delay**, not CDP latency (CDP
   doesn't throttle an already-open WS).
8. **Ship:** `/skill:ship-change`. Expect to **merge `develop` and resolve conflicts** if
   the PR goes DIRTY — GitHub won't run `pull_request` CI on a dirty PR.

## 3. How the collaboration unfolded

**Phase 1 — Read the spec, resolve the investigation (03:09–03:14).**
The AI read the apply skill, then `proposal.md`/`design.md`/`spec.md`, then grepped the
extension + client for the existing prompt/queue plumbing (`send_prompt`, `pendingPrompt`,
`queue_update`, `event-reducer.ts`, `useMessageHandler`). It documented the "capture-before-send
streaming snapshot is the authoritative idle/streaming arbiter" resolution into `design.md`
before writing any code. *Why it worked:* grounding the ack semantics in existing code
avoided re-opening the ghost-bubble bug class.

**Phase 2 — Implement top-down through the stack (03:14–03:20).**
Protocol first (`PromptReceivedToServerMessage` in `protocol.ts`, `…ToBrowserMessage` in
`browser-protocol.ts`), then a verbatim transient pass-through in `event-wiring.ts`, then two
bridge emit sites (`command-handler.ts` + `bridge.ts`) carrying `{fresh: !wasStreaming}`, then
the `PendingPrompt` type + a pure `applyPromptReceived` reducer, the `useMessageHandler` case,
the idle-guarded write in `useSessionActions`, and finally the ChatView `sending → sent`
restyle + CSS animations. *Decision point:* keep the reducer **pure** so it is unit-testable
in isolation.

**Phase 3 — Worktree node_modules + type-check + unit tests (03:20–03:35).**
`tsc` failed because the worktree had no `node_modules` and resolved `shared` from the main
repo (stale). `npm install` in the worktree fixed resolution. The now-required `status` field
broke existing `PendingPrompt` fixtures — fixed programmatically with `perl -0pi` + edits.
New tests: reducer `applyPromptReceived`, ChatView sending/sent render + geometry parity,
and a `useSessionActions` idle-guard test.

**Phase 4 — Real Docker + Playwright + faux E2E (03:48–04:48).** Prompted by "test with
docker and playwright with faux" + "use system browser." The AI studied the faux harness
(`qa/fixtures/faux-scenarios.ts`, `data-testid` map, `global-setup.ts`), added
`tests/e2e/optimistic-prompt.spec.ts` (idle-send + mid-turn-send), wired `PW_CHANNEL` for
system Chrome, and a `test:e2e:chrome` script. The run exposed **two real bugs**: (1) the
absent-`SessionState` guard skipped fresh idle sessions; (2) Enter sends `steer` not
`followUp` — the mid-turn test needed Alt+Enter. It also learned the container bakes
`dist/client` at image-build time, so a source change needs an image rebuild; and that
`page.routeWebSocket` (not CDP latency) is the correct way to widen the sub-second window.

**Phase 5 — Ship through a moving target (04:54–06:28).** `/skill:ship-change`: verify gate
(all 13 full-suite failures confirmed as load-amplified environmental flakes passing in
isolation), archive+sync (which required repairing a **pre-existing malformed main spec**
that held raw delta headers), PR #206. CI didn't start because the PR was **DIRTY** — merged
`develop` twice (it advanced via PRs #203/#205 mid-flight, #203 having *independently added
the same `PW_CHANNEL` feature*), addressed 3 CodeRabbit threads (one **real** Major: non-turn
commands never emit `prompt_received`, hanging the bubble to the 30s timeout — fixed), then
squash-merged.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change optimistic-prompt-progress`. Effective
  because the change already had a proposal/design/spec: the skill gives the AI the full
  investigation context and task list, so "the ask" is fully specified without a paragraph.
- **"is it possible to test with docker and playwright with faux?"** — high-leverage: it
  turned a manual-only verification task (8.3) into automated E2E coverage and, crucially,
  *surfaced two real product bugs* the unit tests missed.
- **"yes, and use system browser for playwright"** — one clause that unlocked a whole
  config path (`PW_CHANNEL`, skip bundled-Chromium preflight, `test:e2e:chrome`).
- **"Use ship-change skill"** — delegates the entire land sequence to a known playbook.
- **"ggo on"** (typo for "go on") — a minimal unblock that let the AI continue a
  long conflict-resolution sequence without re-explaining.

Rewrite of the weak one: instead of "ggo on", prefer **"continue resolving the develop
merge; keep develop's canonical impl where a feature was added on both sides."**

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at unit tests + manual-only verification for the UI task | "test with docker and playwright with faux?" | State up front: "add a real E2E spec for any user-visible behavior change" |
| Reach for bundled Chromium | "use system browser for playwright" | Default to `PW_CHANNEL=chrome` / `test:e2e:chrome` on dev machines |
| Trust the checkbox / assume the feature fires | E2E proved the card never rendered → fixed the absent-state guard | Treat E2E failures as product bugs first, not test-tuning |
| Let Biome `--write` reformat whole files (import reorder) | Revert to HEAD, re-apply only surgical edits | Never run `biome check --write` on a surgical diff; fix only introduced lint |
| Widen the assertion window with CDP latency (no effect on open WS) | Switch to `page.routeWebSocket` frame delay | Use `routeWebSocket` for WS-timing tests |
| Assume `pull_request` CI would just start | Diagnose DIRTY merge state; merge develop, resolve | On "CI never started", check `mergeStateStatus` first |

## 6. Skills, tools & memory created — and why they're effective

**Memory saved (failure):** *"ship-change Step 10 (worktree removal): when the pi session is
running INSIDE the worktree being removed, `git worktree remove --force` from the parent
succeeds but invalidates the session's cwd → the shell/bash tool can no longer execute."*
- **What it captures:** the self-destruct hazard of removing the worktree you're running in.
- **Why effective:** it converts a confusing "my bash tool suddenly can't run" symptom into a
  known, expected consequence — and implies the fix (do worktree removal last, or from a
  session rooted in the parent checkout).
- **When to invoke:** any ship/cleanup flow that ends by removing the current worktree.

**Subagents used:** two `general-purpose` spawns to update `docs/file-index-*.md` rows in
caveman style (per AGENTS.md, all `docs/` writes are delegated). Reusable pattern: the main
agent orchestrates and never edits `docs/` prose directly.

*No skill was created, but a repeatable pattern emerged worth a skill:* "verify a UI change
against the faux Docker E2E harness with the system browser" — arguably already covered by
`run-dashboard-e2e-local-changes`; reach for it before hand-rolling E2E setup.

## 7. Pitfalls & dead ends

- **Worktree has no `node_modules`** → `tsc` resolves stale `shared` from the main repo.
  Fix: `npm install` inside the worktree.
- **`biome check --changed --write` reformatted entire files** (import reorder = noise on a
  surgical diff). Fix: revert to HEAD, re-apply only your edits; apply lint fixes by hand.
- **CDP network latency doesn't slow an already-open WebSocket** → the optimistic card
  flashed past `toBeVisible()`. Fix: `page.routeWebSocket` with a uniform frame delay.
- **The Docker container bakes `dist/client` at image-build time** → source changes need a
  full image rebuild before the served JS reflects them.
- **`pull_request` CI never starts on a DIRTY PR.** If CI "won't trigger", check
  `gh pr view --json mergeStateStatus`; merge `develop` and resolve before blaming Actions.
- **`develop` advances mid-flight** (other PRs merge) → re-merge + re-resolve. Watch for a
  *duplicate feature added on both sides* (here `PW_CHANNEL`): defer to develop's canonical
  impl, keep only your unique additions.
- **Pre-existing malformed main spec** (raw `## ADDED Requirements` delta headers) blocks
  `openspec archive`. Fix the main spec's structure, then archive.
- **Full-suite flakes under load** (real-server-spawn / process-probe timeouts): confirm
  they pass in isolation (and identically with your change stashed) before treating as green.
- **Removing the worktree you're running in kills your shell's cwd** — do it last.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <change>`; read proposal/design/spec before coding.
- [ ] `npm install` inside the worktree (cross-package edits need local `node_modules`).
- [ ] Implement top-down: protocol → server pass-through → bridge emit → reducer → UI; keep
      reducers pure.
- [ ] `npx tsc --noEmit`; fix fixtures the new required field breaks.
- [ ] Unit tests: reducer + render + guard.
- [ ] Add `tests/e2e/<feature>.spec.ts` with faux scenarios; `PW_CHANNEL=chrome`
      (`npm run test:e2e:chrome`); use `page.routeWebSocket` to widen timing windows.
- [ ] Rebuild the Docker image after source changes; treat E2E failures as product bugs.
- [ ] Never `biome --write` a surgical diff.
- [ ] `/skill:ship-change`; if CI won't start, check `mergeStateStatus`, merge `develop`,
      resolve conflicts (defer to develop for duplicated features).
- [ ] Address CodeRabbit threads (expect a real one); remove the worktree **last**.

**Key inputs:** an OpenSpec change with proposal/design/spec; Docker running; system Chrome;
`gh` auth. **Artifacts produced:** new `prompt_received` protocol across shared/server/
extension/client, pure `applyPromptReceived` reducer, restyled ChatView optimistic block,
`tests/e2e/optimistic-prompt.spec.ts` + `PW_CHANNEL` system-browser wiring — squash-merged to
`develop` as `1db93bff` (PR #206).

---

_Generated from session `019f1611` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-30. Source extract: `/tmp/facts_opt_68172.md`._
