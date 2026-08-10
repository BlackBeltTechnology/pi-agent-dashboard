---
session: 019f53d4
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts); large facts sheet (~12002 tok)"
upgrade_status: pending
openspec_changes: [fix-chat-scroll-to-top-estimate-drift]
proposal_excerpt: "Users cannot reliably scroll to the **top** of a virtualized chat transcript on real sessions. Reproduced from session `019f43e4-65b3-70bc-a071-a2241882f295`: scrolling up never converges on the first message — the to…"
---

# How we did it: Fix chat scroll-to-top estimate drift — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The first prompt was two words: **`doubt review`**. The user was standing at the
*design stage* of an OpenSpec change (`fix-chat-scroll-to-top-estimate-drift`) and
wanted the design adversarially stress-tested **before** any code was written. The
real objective, made clear by the later steering turns, was the full arc: **harden
the design with a cross-model doubt review, then implement the change end-to-end
(content-aware virtual-row estimate + a scroll-to-top affordance), gate it with a
real Playwright browser test, and ship it as a clean PR against `develop`.** The
underlying bug: on virtualized chat transcripts, scrolling up never converges on the
first message — TanStack's estimate/measurement correction "yanks" the top away.

## 2. TL;DR playbook

1. **Kick off with `doubt review`** on the OpenSpec change while it's still design-only.
   Let the AI ground every load-bearing claim in the actual source before critiquing.
2. **Answer the skill's "cross-model?" prompt with `a`** — force a *different-family*
   reviewer than the author (author was Claude → reviewer must be non-Anthropic).
3. **Let the AI probe model reachability** (it burned through gpt-5.4, gemini-3.1,
   gpt-5.1, gemini-2.5-pro before landing on reachable `deepseek-v4-pro`). Feed the
   external reviewer **ARTIFACT + CONTRACT only** — no CLAIM, no the-AI's-own findings.
4. **Verify the external reviewer's new claims** against source (it was accurate on
   the checkable ones — `scrollToIndex maxAttempts=10`, fixed `max-h-[300px]` user
   image cap — and hallucinated a couple that were discarded).
5. **`a` again** to fold the reconciled findings into `design.md` / `tasks.md` /
   `proposal.md`, then **`commit`** (openspec artifacts only, no source).
6. **`/skill:openspec-apply-change <name>`** to implement: pure core first
   (`chat-virtual-rows.ts` + unit tests), then wire `ChatView.tsx`, then jsdom
   logic-guard tests. Choose **`1`** when offered the browser-harness option.
7. **Build the Playwright e2e gate**: a `scroll-top-heavy` faux scenario (big rows
   near the top) + `scroll-to-top.spec.ts`. Expect harness pain — pre-build the
   Docker image, use `test.slow()` for long-streaming scenarios.
8. **`rebase to develop`**, then **`ship-change`** — drop unrelated riding commits,
   archive + sync specs, open the PR, watch CI, triage CodeRabbit, resolve merge
   conflicts by *union*, squash-merge, remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Doubt review (design stage).** The AI loaded the `doubt-driven-review`
skill, recognized this as a non-trivial architectural decision (virtual-list scroll
behavior crossing the estimate/measurement boundary), and *grounded before
critiquing*: it verified `overflowAnchor:"none"`, the `stickToBottomRef` guards, and
that `estimateSize` took only the item. Its first substantive finding: the design's
"fixed image reserve" was neither fixed nor single (caps vary `40vh` / `512px` /
`90vh`). **Decision point:** the human answered `a` to invoke the *cross-model* arm.

**Phase 2 — Cross-model adversarial review.** The AI enumerated reachable models,
deliberately picked a **different family than the author** (Claude author → DeepSeek
reviewer), and handed it *only* the artifact + contract. DeepSeek surfaced the
highest-value finding: `scrollToIndex(0)` is bounded to `maxAttempts=10` frames, not
"re-targets every measurement pass" as the design claimed. The AI **verified this in
`virtual-core/dist/esm/index.js`** (lines 646–679) rather than trusting it, and threw
out a hallucinated `scanningDescent` finding. **Why it worked:** giving the external
model no CLAIM keeps its review independent; verifying its line numbers filters the
hallucinations.

**Phase 3 — Fold findings, commit.** `a` → the AI rewrote Decision 1 (per-renderer
image reserves), Decision 3 (corrected the false retry claim, added `img.onload`
re-issue + `ascendingRef` re-arm guard), and promoted the Playwright e2e to a
*required convergence gate*. `commit` landed **only the three openspec artifacts**.

**Phase 4 — Implement.** `/skill:openspec-apply-change`. The AI derived the constants
from the proposal's own evidence (~0.25 px/char → `CHARS_PER_LINE=80`, `LINE_PX=20`),
wrote the pure core + 19 unit tests first, then wired `ChatView.tsx` and the
scroll-to-top button + i18n key. It correctly *demoted jsdom convergence assertions
as vacuous* (the shim reports 0-height rows + no-op ResizeObserver) — logic guards
only, browser-timing convergence deferred to e2e.

**Phase 5 — The e2e gate (the hard part).** Building `scroll-top-heavy` + the spec
took ~90 minutes of harness debugging (see §7). **Decision point:** the human chose
`1` (build the browser gate now). Both tests eventually passed at 2.4m each.

**Phase 6 — Ship.** `rebase to develop` revealed 2 unrelated commits riding the
branch; `ship-change` with the human choosing to drop them (they turned out to be
merged upstream separately — dropping was correct). CI green, CodeRabbit gave 2
nitpicks (1 applied, 1 skipped with rationale), two rounds of *union* merge-conflict
resolution on the faux-scenarios fixture + synced spec, squash-merge as **PR #273**.

## 4. Prompts that worked

- **The goal prompt — `doubt review`.** Effective because the change was at exactly
  the right stage (design, pre-code) where an adversarial pass is cheapest. A
  stronger explicit version: *"Run a cross-model doubt review on the
  `fix-chat-scroll-to-top-estimate-drift` design before I implement it."*
- **`a` (twice)** — high-leverage single-char answers to the skill's choice prompts
  (cross-model arm; then fold-findings). Trusts the skill's menu; moves fast.
- **`1`** — chose "build the Playwright browser gate now" over deferring. This one
  keystroke committed the session to the 90-minute harness fight that produced the
  actual regression guard.
- **`rebase to develop` → `ship-change`** — terse but unambiguous handoffs to the
  ship pipeline. (`ship-chane` typo was self-correcting; re-sent as `ship-change`.)

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Default to a same-family or convenient reviewer | `a` → force the *cross-model* arm | State up front: "reviewer must be a different model family than the author" |
| Trust the design's prose claims ("re-targets every pass") | Cross-model review + source verification exposed `maxAttempts=10` | Always verify load-bearing internals against the vendored source, not the design text |
| Treat jsdom scroll assertions as meaningful | Doubt review flagged them vacuous (0-height shim) | Reserve convergence assertions for Playwright; jsdom = logic guards only |
| Carry unrelated commits into the PR | Chose to drop `b6eaee8` + `d87bbd1` at rebase | Check `git log origin/develop..HEAD` before shipping; drop anything not this change |
| Boot the harness without `PI_E2E_SEED=1` | Redirected to the managed `globalSetup` flow | Use the managed seeded flow, or set `PI_E2E_SEED=1` on any manual `test-up.sh` |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session, but the workflow leaned on and
proved out several existing ones:

- **`doubt-driven-review`** (cross-model arm) — captures "ground → cross-examine →
  reconcile → fold into artifacts." Effective because it forced a *different-family*
  external reviewer and a verify-before-trust discipline that caught a false,
  load-bearing claim before a single line of code was written.
- **`openspec-apply-change`** — drove the schema-aware 21-task implementation with
  the constants derived from the proposal's own evidence.
- **`ship-change`** — the full land pipeline (drop unrelated commits → archive/sync
  specs → PR → CI watch → CodeRabbit triage → union merge-resolve → squash-merge →
  worktree removal).

**Recommended new skill:** *"cross-model-doubt-review reachability probe"* — the
session burned 5 `Explore` subagents finding a reachable non-Anthropic model. A tiny
skill that caches the currently-SDK-invocable model set would remove that repeated probe.

## 7. Pitfalls & dead ends

- **Non-reachable models.** `gpt-5.4`, `gemini-3.1-pro-preview`, `gpt-5.1`,
  `gemini-2.5-pro` all returned empty / not-SDK-invocable. *If you hit this:* probe
  candidates in parallel and take the first reachable different-family model
  (`deepseek-v4-pro` here).
- **External reviewer hallucinations.** DeepSeek invented a `scanningDescent`
  finding and some line numbers. *If you hit this:* verify every new claim against
  source; keep only the checkable-and-correct ones.
- **Playwright per-test timeout (60s) < scenario stream time.** The 43-tool-call
  `scroll-top-heavy` scenario completed in pi's log but the test was killed first.
  *Fix:* `test.slow()` — no fixture change, no rebuild.
- **Managed `globalSetup` 180s health window vs first image build.** First Docker
  build exceeds it. *Fix:* pre-build/boot the image so subsequent managed boots fit.
- **Manual `test-up.sh` without `PI_E2E_SEED=1`.** No session could spawn → every
  faux spec timed out. *Fix:* use the managed seeded flow.
- **`HOME`-sensitive vitest runs.** Client tests needed `HOME=$(mktemp -d)` to run clean.
- **Local integration-test pollution.** Post-merge server tests failed on stray
  Docker containers holding 18xxx/19xxx ports — *not* a regression (diff touched zero
  server files). CI in a clean env is authoritative.
- **Worktree-collision on merge.** `gh`'s local post-merge git step aborted because
  the parent repo had `develop` checked out; the GitHub-side merge + branch delete
  still succeeded. Finish cleanup with an explicit-cwd shell + `git push origin --delete`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an OpenSpec change at design stage; a reproducing session
id; Docker running; system Chrome; `gh` authed; the `develop` branch NOT checked out
in the parent repo (worktree-collision guard).

1. `doubt review` on the change (design stage) → `a` for cross-model.
2. Take the first reachable non-Anthropic model; feed it ARTIFACT + CONTRACT only.
3. Verify its new claims in vendored source; discard hallucinations; `a` to fold; `commit`.
4. `/skill:openspec-apply-change <name>` → pure core + unit tests → wire `ChatView.tsx`
   → jsdom logic guards only → choose `1` for the browser gate.
5. Build `scroll-top-heavy` faux scenario + `scroll-to-top.spec.ts`; pre-build the
   Docker image; `test.slow()`; run via managed seeded `globalSetup`.
6. `rebase to develop` (drop unrelated riding commits) → `ship-change` → union-resolve
   fixture/spec conflicts → squash-merge → remove worktree.

**Final artifacts produced:**
- `packages/client/src/lib/chat-virtual-rows.ts` (content-aware `estimateVirtualRowSize`)
- `packages/client/src/components/ChatView.tsx` (scroll-to-top button + bounded re-issue)
- `tests/e2e/scroll-to-top.spec.ts` + `qa/fixtures/faux-scenarios.ts` (`scroll-top-heavy`)
- openspec `design.md` / `tasks.md` / `proposal.md` (doubt-review-hardened)
- **PR #273 — MERGED** (squash `10ba36c5` on `develop`)

---

_Generated from session `019f53d4-822a-7656-8ab0-c460016bc391` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-fix-chat-scroll-to-top-estimate-drift` · 2026-07-12. Source extract: session-to-guideline facts sheet._
