---
session: 019f529e
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts); large facts sheet (~12721 tok)"
upgrade_status: pending
openspec_changes: [fix-stuck-tool-card-superseded-heal, fix-stuck-tool-card-on-dropped-event]
proposal_excerpt: "A tool card can stay stuck on the running spinner **permanently** — observed at 2 min+ with no recovery — while the session keeps rendering later cards normally. The base change `fix-stuck-tool-card-on-dropped-event`…"
---

# How we did it: fix-stuck-tool-card-superseded-heal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a two-word prompt — `doubt review` — against an **already-drafted**
OpenSpec change (`fix-stuck-tool-card-superseded-heal`). The real objective, which the
follow-up steering made explicit, was the full life-cycle of a UI-correctness fix: a tool
card in the dashboard can stay stuck on the running spinner **permanently** (observed 2 min+)
even though the session keeps rendering later cards. The change adds a client-side "supersede
heal" — finalize a stuck `running` card as `complete` only when a *later assistant inference*
proves the tool must have finished. The ask was: adversarially stress-test the design, then
implement it TDD, write a real browser E2E, and ship it end-to-end (PR → CI → CodeRabbit →
squash-merge → worktree cleanup).

## 2. TL;DR playbook

1. **`doubt review`** on the drafted proposal/design *before* any code — run one CLAIM →
   EXTRACT → adversarial-cross-model cycle on the design's core safety invariant.
2. When the cross-model reviewer (non-Anthropic ids via `Agent`) returns **empty**, surface
   it as a reachability failure — do **not** silently fall back to single-model. Let the human
   choose to proceed.
3. `/skill:openspec-apply-change <change>` — but **verify base machinery exists in code first**
   (`useStaleToolReconcile.ts`, `STALE_TOOL_MS`, the tool-result route) before "reusing" it.
4. **Get ground truth on event ordering empirically** — don't assume `message_end` vs
   `message_start` semantics. A throwaway test proved `tool_start → tool_end → message_end`,
   which flipped the design's anchor to the *next* `message_start`.
5. TDD: write the reducer-level test expecting new exports that don't exist yet → implement
   primitives → hook selector + integration test → render badge + render test.
6. Gate: `openspec validate --strict`, `biome check`, `npx tsc --noEmit`, full `npm test`
   captured to a log. Isolate pre-existing failures (the Jimp `image-fit` suite) from yours.
7. `create E2E tests` — use `page.routeWebSocket` to **drop the terminal WS frame** + `page.route`
   to 404 the reconcile, forcing the unrecoverable-but-superseded state.
8. Run the E2E against the **manually-booted** docker harness (cold build > 180s cap) with
   `PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome`; scope the run to the exact spec path.
9. `ship-change` — commit, PR vs `develop`, watch CI, triage CodeRabbit (auto-apply safe
   fixes only), resolve conflicts by taking develop + re-applying only your row, squash-merge,
   remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Adversarial design review (`doubt review`).** The AI ran a single CLAIM →
EXTRACT → cross-model cycle on the design's core invariant ("false-positive-free heal"). It
tried to get an independent opinion from three non-Anthropic models (`gpt-5.2`, `gpt-5.1`,
`gemini-3-pro-preview`) via the `Agent` tool — all returned empty. Instead of hiding this, it
surfaced the reachability failure per protocol and let the human decide to skip. It then found
two real spec-imprecision bugs (F1: the reducer's only turn counter increments once per *user
cycle*, too coarse to fire mid-turn; F2: a naive array-position scan is unsafe because
`reorderToolCardsForAssistantMessage` can move a card past its own inference) and fixed the
OpenSpec artifacts *before* implementation.

**Phase 2 — Empirical ordering check.** During apply, the AI paused on a correctness-critical
question the anchor depended on: does `message_end` fire before or after its own inference's
tool events? Rather than assume, it wrote a probe test → confirmed `tool_start → tool_end →
message_end`. This **overturned its own amended design**: `message_end` trails its own tool, so
the reliable "later inference" boundary is the *next* `message_start`. It corrected the artifacts
again before writing code.

**Phase 3 — TDD implementation (client-only).** Reducer primitives
(`assistantInferenceSeq`, `emittedAtInferenceSeq`, `hasLaterAssistantInference`,
`synthesizeSupersededEnd`), a `tool_execution_end` carve-out so a real result always overwrites
the placeholder *and clears* the healed marker, hook selector `selectSupersededHealTargets`
wired into the existing session-scoped tick, and a muted `recovered` badge in `ToolCallStep`.
Tests written first, each suite green before moving on (9 reducer, 14 hook, 34 component).

**Phase 4 — Browser E2E.** The AI had earlier assumed the Playwright harness "wasn't landed" —
it checked and was **wrong** (30+ specs archived and live). It reverse-engineered the
`routeWebSocket` seam from `optimistic-prompt.spec.ts`, added a faux scenario
(`stuck-tool-superseded`: tool call → later text), and dropped the terminal frame + 404'd the
reconcile to force the exact failure.

**Phase 5 — Ship.** `ship-change`: gate → PR #271 → CI (3 rounds, all green) → CodeRabbit
(7 comments: 6 applied, 1 deferred with a rationale reply) → an `AGENTS.md` merge conflict
resolved by taking develop + re-appending only the new row → squash-merge + branch delete +
worktree removal.

## 4. Prompts that worked

- **`doubt review`** (goal) — terse but powerful *because the change was already drafted*. It
  triggered the `doubt-driven-review` discipline on the highest-risk artifact (the safety
  invariant) at the cheapest possible moment (pre-implementation). Stronger explicit form:
  *"Run a doubt review on the design's core safety claim before we implement — try a cross-model
  reviewer and surface it if unreachable."*
- **`/skill:openspec-apply-change fix-stuck-tool-card-superseded-heal`** — named the exact change;
  the skill drove the TDD apply loop.
- **`create E2E tests`** — short, high-leverage. It unlocked the whole Playwright phase and, in
  the process, corrected the AI's stale "harness not landed" belief.
- **`docker is running`** — a one-line environment signal that let the AI switch from "can't run
  E2E here" to actually executing it.
- **`ship-change`** and **`A`** (choosing the "code now, archive deferred" fork) — the single-letter
  reply resolved a genuine ordering dependency without a paragraph.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Consider silently falling back to single-model when cross-model probes returned empty | (protocol held) — human confirmed "skip cross-model, proceed single-model" | State up front: "if a cross-model reviewer is unreachable, surface it and ask — never swallow it" |
| Assume event ordering (`message_end` as the "later inference" signal) | Implicitly, by the AI self-checking; reinforce with "verify ordering empirically, don't assume" | Keep a memory: intra-inference order is `tool_start → tool_end → message_end`; the later-inference boundary is the **next** `message_start` |
| Believe the Playwright E2E harness "wasn't landed" | `create E2E tests` forced a re-check → it was archived & live | Before claiming infra is missing, `ls tests/e2e/` / check archived changes |
| Let the managed E2E `globalSetup` (180s cap) time out on a cold docker build | `docker is running` + boot the harness manually, attach with `PW_E2E_USE_RUNNING=1` | Pre-build the harness once (caches the slow `npm install && build` layer) before running specs |
| Hit a wrong WS envelope filter (`event_forward`) so no frame dropped | Re-run revealed live envelope is `{ type: "event" }` | Remember: live browser WS frames are `type:"event"`, not `"event_forward"` |
| Consider force-fitting an out-of-scope CodeRabbit fix | Deferred it with a rationale reply, applied only the 6 safe ones | Auto-apply CodeRabbit only within safe scope; defer shared-behavior changes with a reply |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were saved, but the session was a textbook run of several **existing**
disciplines, and two facts are worth persisting:

- **`doubt-driven-review` at proposal/design stage** — running it *before* any diff caught two
  spec-imprecision bugs (F1/F2) when a fix was still a one-line edit, not a code rework. Invoke it
  whenever a change is drafted but unimplemented and has a stated safety invariant.
- **Empirical-ordering probe** — the throwaway test that established
  `tool_start → tool_end → message_end` is the reusable asset. **Recommended memory:** save this
  event-ordering fact plus "the later-inference boundary is the next `message_start`" so future
  reducer work skips the re-derivation.
- **E2E WS-drop pattern** — `page.routeWebSocket` (drop terminal frame) + `page.route` (404 the
  reconcile) is the reusable recipe for testing any "dropped-event heal" in this dashboard.
  **Recommended memory/skill:** the manual-harness-boot + `PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome`
  attach procedure for cold-build environments.

## 7. Pitfalls & dead ends

- **Cross-model reviewers return empty.** Non-Anthropic ids appear in the assignable catalogue but
  aren't SDK-invocable from `Agent` in some sessions. Empty output = reachability failure, not a
  clean review — surface it, don't fall back silently.
- **Trusting your own amended design over the runtime.** The first "later inference" anchor
  (`message_end`) was wrong; only an empirical probe caught it. If a heal depends on event order,
  verify the order before coding.
- **Cold docker build vs the 180s E2E boot cap.** `npm install && build` in a single uncached RUN
  layer exceeds the managed `globalSetup` cap. Boot manually to healthy first, then attach.
- **Chromium download blocked** (`cdn.playwright.dev` restricted). Use `PW_CHANNEL=chrome` to reuse
  system Chrome — no download.
- **Wrong WS envelope filter** (`event_forward` vs `event`) → nothing dropped, first E2E assertion
  fails. Confirm the live frame shape before writing the drop filter.
- **`AGENTS.md` merge conflict on ship** — develop edited the same `event-reducer.ts` row. Take
  develop's version, re-append only your row (use a long anchor; the row appears twice).
- **Removing the worktree you're running in** kills the Bash tool's cwd for the rest of the session.
  Do cleanup last; verify from the parent repo via the sandboxed executor with an explicit `cwd`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the drafted OpenSpec change, a running docker daemon, system Chrome
(for `PW_CHANNEL=chrome`), GitHub auth for the PR/CodeRabbit loop.

- [ ] `doubt review` the drafted design's core invariant; try cross-model, surface if unreachable.
- [ ] Fix spec imprecision in the OpenSpec artifacts *before* implementing.
- [ ] `/skill:openspec-apply-change <change>`; verify base code machinery exists first.
- [ ] Probe event ordering empirically; re-anchor the design if it contradicts an assumption.
- [ ] TDD: reducer test → primitives → hook selector + integration → badge + render test.
- [ ] Gate: `openspec validate --strict`, `biome check --write`, `tsc --noEmit`, full `npm test`
      to a log; isolate pre-existing (Jimp `image-fit`) failures.
- [ ] `create E2E tests`: faux scenario + `routeWebSocket` frame-drop + `page.route` 404.
- [ ] Boot the harness manually; attach `PW_E2E_USE_RUNNING=1 PW_CHANNEL=chrome`; run the exact spec path.
- [ ] `ship-change`: PR vs develop → CI → CodeRabbit (auto-apply safe only) → squash-merge → remove worktree last.

**Final artifacts:** PR #271 (merged, squash `454d058`) — reducer `event-reducer.ts`, hook
`useStaleToolReconcile.ts`, `ToolCallStep.tsx` badge, new reducer/hook/component tests, and
`tests/e2e/superseded-heal.spec.ts` (verified green, 51.5s) with faux scenario `stuck-tool-superseded`.

---

_Generated from session `019f529e` · `pi-agent-dashboard/.worktrees/os-fix-stuck-tool-card-superseded-heal` · 2026-07-11. Source extract: session facts sheet._
