---
session: 019ebdee
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (9 user prompts)"
upgrade_status: pending
openspec_changes: [simplify-session-card-ordering, add-goal-continuation-plugin]
proposal_excerpt: "Session-card ordering grew into two parallel systems that no longer reconcile:"
---

# How we did it: Simplify session-card ordering — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change simplify-session-card-ordering`.
The *real* objective, once the proposal was read, was to collapse **two divergent
session-card ordering systems** — a server-side order map keyed by raw `session.cwd`
and a client-side render pipeline that re-sorted ended cards by `endedAt` and
re-clustered by workspace name — into **one status-partitioned list** driven by a
single stored order. Along the way: fix the worktree/jj silent no-op (raw-cwd keying),
add `completedFirst`/`questionFirst` gates, ship it through a conflicted PR, clear
CodeRabbit, and land clean. 27 tasks, shared + server + client, TDD per task.

## 2. TL;DR playbook

1. **Reconcile the proposal with reality first.** Before writing code, ask the AI to
   grep every task group against current source and report a per-group ❌/✅ table with
   file:line evidence. (Here: all 7 groups unstarted; the prior commit only added docs.)
2. **Lock the one real design decision up front.** The AI surfaced a fork (hoist the
   resolver to `shared` vs duplicate) and *stopped to ask*. Answer it (A: hoist) plus
   "full pass" so it runs uninterrupted.
3. **Hoist the shared resolver, then `npm install` inside the worktree.** Worktrees
   under `.worktrees/` have **no `node_modules`** — new `packages/shared` files are
   invisible to tests until the worktree has its own install.
4. **Extract pure functions for anything you assert on** (`resolveOrderKey`,
   `reconcile-session-order`) and TDD each: test → red → minimal impl → green.
5. **Work server → client.** Key every order-map mutation by the *resolved* group
   path; keep ended ids in the map (no `remove`); add gated `moveToFront` on
   `agent_end`/`ask_user` via live getters; then derive client tiers from the stored
   order and delete the `clusterByWorkspaceName` sort.
6. **Run suites in isolation to unmask flakes.** The full suite showed 4 red — all
   pre-existing timeout flakes; re-run each alone to prove they're environment-bound,
   not your change.
7. **Delegate every `docs/` write to a subagent** with the caveman-style rule verbatim
   (AGENTS.md mandate). Never edit `docs/` prose directly from the main agent.
8. **Commit clean, open PR, expect a conflict.** If CI never starts, the PR is
   `CONFLICTING`; merge `develop` in, resolve, push, then watch CI to green.
9. **Triage CodeRabbit, don't obey it.** Fix the valid items, *defer with written
   rationale* the ones that fight repo convention, skip out-of-scope files.
10. **Merge from inside the worktree carefully** — `gh merge` tries to switch the
    local branch and aborts; verify the PR is MERGED on GitHub, then delete remote
    branch + worktree + local branch manually.

## 3. How the collaboration unfolded

**Discovery.** The AI read the proposal, design, both specs, and all affected source,
then produced a per-task-group status table proving nothing was implemented. This
"reconcile before you build" move (prompted by *"check this proposal, maybe some parts
already implemented"*) prevented redundant work and grounded the plan in file:line
evidence.

**Design lock.** Rather than silently picking an approach, the AI paused on one
decision — hoist the group-path resolver into `shared` (single source of truth) vs
duplicate it — and asked. The human chose **A + full pass**, which unblocked an
uninterrupted 27-task run.

**Build (server → client, TDD).** Foundation first: hoist `resolveSessionGroupPath`
to `shared`, re-export from client. Then `resolveOrderKey` + tests, config fields
(`completedFirst`/`questionFirst`), the `onChange` rewrite (keep ended ids, gated
placement), a pure `reconcile-session-order` for startup backfill, gated
`agent_end`/`ask_user` triggers via live getters, and hide/unhide `moveToFront`.
Client last: derive tiers from stored order, drop `clusterByWorkspaceName`, rewrite
the tests that pinned the *old* endedAt-desc behavior.

**Verify.** Type-check clean; the 4 red suites were isolated and confirmed to be
pre-existing timeout flakes (sharp resize, linkify perf, source-stamp). `openspec
validate --strict` passed. Docs delegated to a subagent.

**Ship.** Commit (reverting unrelated `.pi/settings.json` + `package-lock.json`
drift), push, open PR #108. CI never started → PR `CONFLICTING`. The AI merged
`develop` in, resolved openspec + docs conflicts, then **caught its own mistake**: a
first union script dropped develop's newer file-index rows. It reset the 3 docs to
develop and re-applied its notes as *appends*. CI went green.

**Review & land.** CodeRabbit's 13 items surfaced under "🛑 Comments failed to post"
(no inline threads). The AI triaged into fix (5) / defer-with-rationale (3) /
out-of-scope skip (5), applied fixes, and pushed. Final merge from inside the
worktree tripped `gh`'s local-branch switch; the AI verified MERGED on GitHub and
cleaned up manually.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change simplify-session-card-ordering`.
  Effective because it binds the whole run to a spec with tasks; a future kickoff
  should add "reconcile against current code first, then lock any design fork before
  writing."
- **"check this proposal, maybe some parts already implemented"** — high leverage: it
  forced an evidence-based status table before any code, catching that a prior commit
  had only added docs.
- **"commit, create PR and monitor CI"** — one line that drove the entire land
  sequence, including the conflict-resolve detour.
- **"fix coderabbit issues"** — triggered structured triage rather than blind
  obedience.
- **"merge PR, delete branch and worktree"** — a single close-out instruction that
  the AI executed end-to-end.
- **"wrong session"** — a two-word correction (see §5) that instantly aborted a
  misdirected browser action.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Start implementing before confirming what's already done | "check this proposal, maybe some parts already implemented" | Make "reconcile proposal vs code, output ❌/✅ table" the first apply step |
| Open a mock/browser against the wrong target | "wrong session" | State the exact session/URL when asking to "open mock in browser" |
| Treat a full-suite red as a real failure | (AI self-corrected by isolating) | Pre-declare known flakes (sharp resize, linkify perf, source-stamp) as environment-bound |
| Union-merge docs and silently drop develop's newer rows | (AI caught it on re-verify) | On doc conflicts, reset to develop and *append*, never union-script |
| Obey every CodeRabbit item | "fix coderabbit issues" → AI triaged | Ask for a fix/defer/skip table with rationale, not blanket fixes |

Scope was expanded implicitly: the change also had to survive a 17-commit `develop`
advance and a full CodeRabbit pass — both handled without new prompts.

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved (project):** *"Git worktrees under `.worktrees/` have NO
  `node_modules` by default — workspace imports resolve up to the MAIN checkout's
  `packages/shared`, so edits to `packages/*` in a worktree aren't seen by tests until
  you `npm install` in the worktree."* This removes the single biggest time sink of the
  session (new shared file invisible to tests). **Invoke by** running `npm install`
  inside any freshly-created worktree before running tests that touch `packages/*`.
- **Subagents (3 general-purpose):** all for `docs/` writes / file-index row
  re-application under the caveman-style mandate. Effective because they keep the main
  agent out of `docs/` prose entirely, satisfying AGENTS.md and isolating the
  mechanical row-merge work.
- **Recommended skill to create:** a "worktree-apply-and-ship" procedure capturing the
  install-in-worktree gotcha + the merge-from-worktree `gh` caveat + the doc-conflict
  append rule. This session hit all three cold.

## 7. Pitfalls & dead ends

- **New `shared` file invisible to worktree tests** → run `npm install` in the
  worktree; imports otherwise resolve to the main checkout's stale `packages/shared`.
- **CI "never starts" on a PR** → it's `CONFLICTING`; GitHub can't build the
  test-merge commit. Merge `develop` in and resolve.
- **Union-merging docs drops the other branch's newer rows** → don't script a union;
  reset the conflicted docs to `develop` and re-apply your notes as appends.
- **CodeRabbit items with no inline threads** → they're under "🛑 Comments failed to
  post"; read them from the review *body*, not GraphQL threads.
- **`gh pr merge` from inside a worktree aborts** trying to switch the local branch
  (checked out in the main repo). The GitHub merge still succeeds — verify state, then
  clean up manually.
- **Shell dies after `git worktree remove`** because its CWD was the removed dir →
  recreate/remove the path or `cd` to the main repo to restore the shell.
- **Full-suite flakes** (sharp resize >5s, linkify perf, source-stamp) → re-run each
  suite in isolation before assuming your change broke it.

## 8. Reproduce it faster — checklist

- [ ] Read proposal + design + specs; emit a per-task-group ❌/✅ table with file:line
      evidence.
- [ ] Lock any design fork (e.g. hoist-to-shared) via one `ask_user`, then request a
      full pass.
- [ ] `npm install` inside the worktree **before** running tests that touch
      `packages/*`.
- [ ] TDD each pure helper (`resolveOrderKey`, `reconcile-session-order`): test → red →
      impl → green.
- [ ] Server first (key by resolved path, keep ended ids, gated `moveToFront`), client
      second (tiers from stored order, drop `clusterByWorkspaceName`).
- [ ] Isolate any red suites to confirm pre-existing flakes.
- [ ] Delegate all `docs/` writes to a subagent with the caveman rule verbatim.
- [ ] Commit clean (revert unrelated `.pi/settings.json` / `package-lock.json` drift),
      open PR; if CI stalls, merge `develop` in and resolve (append, don't union, on
      docs).
- [ ] Triage CodeRabbit into fix / defer-with-rationale / out-of-scope; apply, push,
      summarize on the PR.
- [ ] Merge; verify MERGED on GitHub; delete remote branch + worktree + local branch
      manually.

**Key inputs to have ready:** the OpenSpec change name, a worktree under `.worktrees/`,
`gh` auth, and the CI/CodeRabbit gate on `develop`. **Final artifacts:** PR #108
(merged `914fc233`), new `packages/shared/src/session-group-path.ts`,
`packages/server/src/resolve-order-key.ts`, `reconcile-session-order.ts`, and their
tests.

---

_Generated from session `019ebdee-f133-77c4-9712-2d77a05f85a6` · `pi-agent-dashboard` · 2026-06-14. Source extract: session facts sheet._
