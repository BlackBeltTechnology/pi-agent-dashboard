---
session: 019f0b13
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "yes — heavy steering (7 user prompts); large facts sheet (~14795 tok)"
upgrade_status: pending
openspec_changes: [inject-session-context-into-agent]
proposal_excerpt: "Today the dashboard's \"attach proposal\" feature is purely server/UI metadata: `session.attachedProposal` drives the chip, the artifact letters, and auto-rename, but the pi agent running inside the session is never told…"
---

# How we did it: inject-session-context-into-agent — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was terse: *"There was a ton of changes still this proposal. Recheck."*
The real objective, once it unfolded, was a full lifecycle: **take a months-stale
OpenSpec proposal (`inject-session-context-into-agent`), re-validate every assumption
against a heavily-refactored codebase, patch the artifacts, implement the feature,
test it (including the one "manual-only" task), and ship it through a PR + CodeRabbit
review to a squash-merge.** The feature itself: teach the pi agent *inside* a dashboard
session about its own session context (session id, cwd, and any attached OpenSpec
change) by splicing a fragment into the system prompt on every turn via pi's
`before_agent_start` hook.

This was a ~10-hour, ~$50, 262-assistant-message development session spanning four
distinct skills (recheck → openspec-apply → docker/playwright test → ship-change).

## 2. TL;DR playbook

1. **Re-ground the stale proposal against reality first.** Grep every file path and
   API symbol the proposal/design/tasks/spec name; confirm each still exists. Here the
   repo had migrated `src/**` → `packages/**` and the proposal's central assumption
   (`pi.sessionId`) *did not exist* in the installed pi API.
2. **Patch all four artifacts (proposal.md, design.md, spec.md, tasks.md) to match
   verified reality** before writing a line of code. Run `openspec validate <change>`
   until green.
3. **Invoke `/skill:openspec-apply-change <change>`** and implement task-by-task:
   protocol message → bridge state → command-handler case → injector module →
   server push + replay. Typecheck + targeted unit tests after each cluster.
4. **When the worktree's `tsc` can't see your `packages/shared` edit**, run
   `npm install` *inside the worktree* — its workspace symlinks were pointing at the
   main repo's copy.
5. **Don't accept "manual smoke" as un-automatable.** The faux-pi Playwright harness
   runs pi's *real* pipeline, so `Context.systemPrompt` (passed to `streamSimple`)
   carries your injected fragment — add a faux scenario that echoes the system prompt
   and assert the fragment in the rendered DOM.
6. **Rebuild the docker test image** (`docker compose build`) whenever your change is
   *baked* (the extension is), not just bind-mounted (fixtures are).
7. **Run the review gate, then recover its findings from the local cache** if it
   truncates/dedups them (`~/.coderabbit/reviews/…`). Fix all, re-test.
8. **`/skill:ship-change`**: archive+sync specs, commit (exclude the noisy
   `package-lock.json` churn), open PR against `develop`, resolve conflicts by taking
   develop's file and re-applying only your rows, loop CI + CodeRabbit until green,
   squash-merge, then remove the worktree **from the parent repo**.

## 3. How the collaboration unfolded

**Phase A — Recheck / re-grounding (prompts 1–3).** The AI treated the stale proposal
as a hypothesis to falsify, not a spec to trust. It grepped every referenced path and
pi API symbol and found three classes of drift: (1) the `src/` → `packages/` migration
(proposal.md still said `src/shared/protocol.ts`); (2) the crux assumption
`pi.sessionId` **does not exist** — the bridge owns its own `bc.sessionId` from
`ctx.sessionManager.getSessionId()`; (3) `before_agent_start` was *already* registered
as a pass-through forwarder, so the new injector must **coexist** (pi chains handlers).
It patched all four artifacts and re-ran `openspec validate`. *Decision point:* the
human's "yes" (prompt 2) approved converting the spec's append-only contract into a
**splice-replace** over the last `Current working directory:` anchor.

**Phase B — Implementation (prompt 4, `openspec-apply-change`).** Built bottom-up:
protocol message `attach_proposal_changed` → `BridgeContext.attachedChange` (persisted
across `/reload` via `BridgeState`) → command-handler switch case → a pure-function
injector module (`buildContextFragment` / `spliceContextFragment` +
`registerDashboardContextInjector`) → server-side `pushAttachProposalChanged` from both
attach and detach → replay on `session_register`. Key insight the AI surfaced: the
injector must read **live** bridge state (a getter, not a frozen snapshot) and must
guard `isActive()` because `/reload` re-runs `activate` on the same `pi`, stacking
listeners.

**Phase C — The "manual" task, automated (prompts 5–6).** The human asked whether the
last task could be done with docker + playwright. The AI traced the faux-pi harness
end-to-end, proved `context.systemPrompt` reaches the faux router, added an
`echo-system-context` faux scenario + an E2E spec, rebuilt the docker image (the
injector is *baked*), and — when the Playwright Chromium download kept timing out —
temporarily pointed Playwright at system Chrome (`channel: "chrome"`), ran the spec
green, then reverted the harness edits to pristine.

**Phase D — Ship (prompt 7, `ship-change`).** Verify gate → archive+sync specs →
commit (excluding lockfile churn) → PR #183 → resolve a `docs/file-index` conflict by
unioning rows → recover + fix 11 CodeRabbit findings → loop CI + review until green →
squash-merge → remove worktree.

## 4. Prompts that worked

- **Goal prompt (weak → strong).** *"There was a ton of changes still this proposal.
  Recheck"* worked only because the AI inferred the right scope. A stronger kickoff:
  *"The `inject-session-context-into-agent` proposal predates the src→packages
  migration. Re-verify every file path and pi API symbol it references against the
  current tree, patch proposal/design/spec/tasks to match, and run `openspec validate`
  before implementing."*
- **High-leverage follow-up: "There is one task left. Is it possible to tests with
  docker and playwright?"** — This single question turned a hand-waved "manual smoke"
  task into a deterministic automated E2E. Reusable pattern: *challenge every
  "manual-only" task* — ask if the existing test harness can observe the mechanism.
- **"yes" (×3)** — cheap approvals that unblocked the splice-replace contract change,
  the E2E automation, and the docs/review parallelization. Terse approvals work when
  the AI has already laid out a concrete plan to approve.
- **"use skill ship-change"** — naming the exact skill routes the whole
  archive→PR→review→merge lifecycle deterministically instead of ad-hoc git.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust the stale proposal's file paths / API claims | "Recheck" (verify against the tree) | Make "re-ground before implementing" the first task of any old change |
| Leave the last task as a manual smoke | "Is it possible to test with docker and playwright?" | Add a scenario-design pass that asks whether the faux harness can observe each acceptance criterion |
| Keep the spec's append-only wording | approve the splice-replace rewrite ("yes") | State the exact system-prompt contract (splice over last anchor) in design.md up front |
| Reach for ad-hoc git to land the change | "use skill ship-change" | Default to the ship-change skill for any OpenSpec change |

Quality bars the human implicitly imposed: `openspec validate` must pass; all findings
fixed (or explicitly declined with reasoning + thread resolved); worktree left clean.

## 6. Skills, tools & memory created — and why they're effective

No new skills were *created* this session, but four existing skills were chained and
their combination is the reusable asset:

- **`openspec-apply-change`** — drove task-by-task implementation with per-cluster
  typecheck+test. Invoke when a validated change is ready to build.
- **`ship-change`** — owns archive→commit→PR→CI-loop→CodeRabbit→squash-merge→worktree
  removal. Invoke once implementation + tests are green.
- **Docs subagents (general-purpose ×3)** — file-index rows were delegated per the
  repo's docs protocol (main agent never edits `docs/` prose directly).

**Recommended skill to create:** a *"re-ground a stale OpenSpec proposal"* skill —
grep every referenced path + API symbol, diff against the tree, list drift, patch the
four artifacts, `openspec validate`. This session spent its first ~2 hours doing
exactly that from scratch; it's a repeatable, mechanical procedure.

## 7. Pitfalls & dead ends

- **`pi.sessionId` does not exist.** The bridge owns `bc.sessionId` from
  `ctx.sessionManager.getSessionId()`. Any doc claiming `pi.sessionId` is wrong.
- **Worktree `tsc` couldn't see the `packages/shared` edit** — the worktree shared the
  *main* repo's `node_modules` symlink. Fix: `npm install` **inside the worktree** so
  workspace symlinks point at the worktree's packages.
- **Playwright Chromium download timed out repeatedly** (slow CDN, 30s/request). Fix:
  drive system Chrome via `channel: "chrome"` + skip the bundled-binary preflight —
  temporarily, and **revert to pristine** after.
- **Docker test image was stale** — the extension/injector is *baked* into the image
  (fixtures are bind-mounted). Must `docker compose build` after changing baked code.
- **CodeRabbit truncated + deduped its findings** — re-runs returned 0, then hit a
  ~51-min rate limit. Recover from the local cache `~/.coderabbit/reviews/…`.
- **`package-lock.json` showed 34k lines of churn** from the worktree `npm install` —
  restore it to develop's version before committing so the PR stays clean.
- **A session removing its own worktree kills its shell** — the bash tool's cwd
  vanished. Run the final `git worktree prune` / `branch -D` from the parent repo.
- **`doctor-route.test.ts` timing flake** — passes in isolation; ignore under load.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the stale change name; a worktree checked out on its branch;
docker available; a Chromium (bundled or system Chrome); `gh` authenticated; CodeRabbit
CLI.

1. `grep` every path + pi API symbol the proposal/design/spec/tasks reference; list drift.
2. Patch all four artifacts to verified reality; `openspec validate <change>` → green.
3. `/skill:openspec-apply-change <change>`; implement bottom-up; typecheck + targeted tests per cluster.
4. If workspace types don't resolve: `npm install` **inside the worktree**.
5. Automate the "manual" task via the faux harness (`context.systemPrompt` carries injected fragment); rebuild the docker image; run the E2E spec.
6. Run the review gate; recover findings from `~/.coderabbit/reviews/` if truncated; fix all.
7. `/skill:ship-change`: archive+sync, commit (drop lockfile churn), PR → develop, loop CI+review, squash-merge.
8. Remove the worktree **from the parent repo**; prune + delete branch.

**Artifacts produced:** `packages/extension/src/dashboard-context-injector.ts` (+ test),
`packages/server/src/__tests__/attach-proposal-replay.test.ts`,
`tests/e2e/session-context-injection.spec.ts`,
`packages/server/src/__tests__/faux-echo-system-context.unit.test.ts`; protocol +
bridge + command-handler + session-meta-handler + event-wiring edits. Landed as **PR
#183**, squash-merged to `develop`.

---

_Generated from session `019f0b13-adbe-7865-95b3-818887dd4997` · `pi-agent-dashboard` · 2026-06-27. Source extract: `/tmp/facts-inject-29329.md`._
