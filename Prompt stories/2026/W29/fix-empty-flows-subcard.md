---
session: 019f6257
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-empty-flows-subcard]
proposal_excerpt: "The FLOWS subcard renders an empty capsule panel (a \"FLOWS\" pill over a blank bordered box, no buttons) whenever the pi-flows extension is loaded in a session's cwd but there is nothing actionable to show: zero flows…"
---

# How we did it: Ship the `fix-empty-flows-subcard` OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with the `ship-it` skill loaded as the first "prompt" — the operator
wanted the AI to **drive the entire implementation phase of an already-planned OpenSpec
change (`fix-empty-flows-subcard`) inside its git worktree, headless, end to end**: apply
the change, verify it, and land it (archive → commit → PR → CI → CodeRabbit → merge →
worktree cleanup). The change itself was small and surgical — the FLOWS subcard rendered
an **empty capsule** (a "FLOWS" pill over a blank bordered box, no buttons) whenever the
pi-flows extension was loaded but had nothing actionable to show. The real objective, once
the two steering turns landed, was: **implement the predicate fix, archive the change
before opening the PR, and rebase onto `develop` to pick up an unrelated CI fix** — then
merge cleanly without expanding scope into release plumbing.

## 2. TL;DR playbook

1. Kick off with `ship-it` from **inside the change's worktree** (`.worktrees/os-<change>`,
   branch `os/<change>`). Let it orient on the change artifacts first.
2. Read the claim's render condition and confirm the runtime APIs it needs
   (`getSessionData("flowsList")`, `getPluginConfig("flows").editFlow`) actually exist and
   are exported.
3. Make the fix **surgical**: realign the gate predicate to return the *exact* boolean the
   claim renders on — `flowsList.length > 0 || editMode || sessionHasFlowEvents(id)` — and
   retire the now-dead availability cache + its subscriber.
4. Rewrite the test as **predicate tests** (not a weakening of the old cache tests). Run the
   package suite with an **ephemeral `HOME=$(mktemp -d)`** so vitest project isolation holds.
5. Run the no-weakening check on the test diff; confirm removed `expect`s are replaced
   assertions, not `.only`/`.skip`/matcher degradation.
6. Run the **full** `npm test`; triage every failure to "does it touch my package?" Prove
   unrelated failures are pre-existing on `develop` before proceeding.
7. **Steer: archive first.** Run `openspec archive <change> --yes` *before* the PR, flip the
   deferred manual task, verify the delta spec synced into `openspec/specs/`.
8. Commit → push → open PR against `develop` → watch CI.
9. When CI is red on a **pre-existing `develop` breakage**, don't touch release/CI config —
   **steer: rebase onto the fixed `develop`**, force-push-with-lease, re-watch.
10. Re-run flaky CI jobs, confirm CodeRabbit has zero actionable threads, squash-merge with
    `--delete-branch`, then remove the worktree from the **parent** repo.

## 3. How the collaboration unfolded

**Phase 1 — Orient & filesystem-reality check.** The AI read the change artifacts
(proposal/design/tasks/specs — no `test-plan.md`), then grepped for the runtime exports the
fix would depend on (`getSessionData`, `getPluginConfig`) to confirm they were live before
writing a line. *Why it worked:* it grounded the fix in verified APIs instead of assuming
them, so the implementation was right on the first pass.

**Phase 2 — Surgical implementation.** Created `shouldRender.ts` (the realigned gate),
trimmed `flowsAvailability.ts` down to `sessionHasFlowEvents` + memo + test reset, removed
the subscriber install from `index.tsx`, and updated two `AGENTS.md` tree rows. *Decision
point:* the AI recognized this as a legacy unit-level change (`## Tests` are unit-level, no
docker harness) and skipped the harness path entirely.

**Phase 3 — Verify without weakening.** Ran the flows-plugin suite (175/175 green) under an
ephemeral HOME, `tsc --noEmit` clean, and a **no-weakening scan** on the test diff. Then ran
the full repo suite and got **19 failures** — all triaged to untouched packages
(`pi-image-fit-extension` missing native Jimp, `pi-dashboard-shared` publish-allowlist gap,
`pi-dashboard-web` timing-flaky smoke). *Why it worked:* it proved isolation rather than
asserting it.

**Phase 4 — Archive-first landing (human steer #1: "archive first").** The operator
redirected the AI to run `openspec archive` **before** opening the PR. The AI archived the
change (syncing the delta spec into `openspec/specs/session-card-subcards/spec.md`), flipped
the deferred manual verification task, committed, pushed, and opened **PR #321**.

**Phase 5 — CI red on pre-existing `develop` breakage.** CI failed on the
`publish-allowlist-complete` test (nano-banana + video-production missing from
`publish.yml`). The AI correctly diagnosed this as **already red on `develop`** (parent
commit `d7f96fe3`), flagged that the fix is release/CI config **out of scope** for this
change, and **refused to silently expand the PR**. *Decision point:* the human fixed
`develop` separately.

**Phase 6 — Rebase & merge (human steer #2: "rebase to develop, it contains required
fix").** The AI fetched, rebased onto the fixed `develop` (one already-upstream commit
dropped cleanly), force-pushed-with-lease, re-watched CI, re-ran a **flaky** `pi-dashboard-web`
job, confirmed CodeRabbit had zero actionable threads, and squash-merged with branch delete.
Final cleanup removed the worktree from the parent repo — which deleted the session's own
CWD, the expected end state.

## 4. Prompts that worked

- **The goal prompt (the `ship-it` skill invocation).** Loading `ship-it` from inside the
  worktree was the whole kickoff — it carries the apply→test→ship sequence, the defer rules,
  and the "never auto-touch CI/release" guardrail. *Effective because* the discipline was
  pre-baked; the human only had to steer two decision points.
- **`archive first` (steering #1).** Three words that reordered the pipeline correctly —
  archive belongs *before* the PR so the merged branch already carries the synced spec.
- **`Rebase to develop, it contains required fix` (steering #2).** A high-leverage unlock:
  instead of asking the AI to work around a red baseline, it pointed the AI at the real fix
  location and let the rebase resolve CI cleanly.

*Stronger kickoff for next time:* state the two decisions up front —
> "Ship `fix-empty-flows-subcard` with ship-it. **Archive before opening the PR.** If CI is
> red on a pre-existing `develop` breakage, **rebase onto develop** rather than expanding
> this PR's scope."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Proceed toward commit/PR before archiving the change | "archive first" | Say "archive before PR" in the kickoff; ship-it should sequence archive ahead of the PR by default |
| Treat a red CI as a blocker it must escalate on (correctly refusing to touch release config) | "Rebase to develop, it contains required fix" | State the rebase-onto-develop policy up front when a known `develop` fix is landing in parallel |

Both corrections were *scope/sequencing* nudges, not fixes to bad code — the AI's actual
implementation and its refusal to widen scope into `publish.yml` were exactly right.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was a **pure application** of the
existing `ship-it` skill (which composes `openspec-apply-change`, the harness path, and
`ship-change`). The reusable asset already existed; this session is evidence it works
headless end-to-end. *When to invoke it:* any time an OpenSpec change is planned and sitting
in its worktree ready to build and land.

If anything deserves capture, it's the **two-line policy** the steering revealed: (1) archive
before PR, (2) rebase onto a fixed `develop` rather than expanding a PR's scope into
CI/release config. Those belong in the kickoff prompt or as a ship-it default, not a new
skill.

## 7. Pitfalls & dead ends

- **Vitest project isolation needs an ephemeral HOME.** The first `npx vitest run` needed
  `HOME=$(mktemp -d)` to run under the correct project — set it from the start.
- **Full-suite failures ≠ your failures.** 19 red tests were all pre-existing/environmental
  (`Jimp is not a constructor`, publish-allowlist gap, a `waitFor` perf smoke). Always triage
  "does the failing package import mine?" before assuming your change broke something.
- **CI red on a pre-existing `develop` breakage.** Don't fix release/CI config inside a
  feature PR — confirm it's already red on `develop`, then rebase onto the fix. Expanding
  scope here is the trap.
- **Flaky `pi-dashboard-web` timing tests.** A `waitFor`-based smoke test flaked in CI but
  passed locally (32/32). Re-run the failed job rather than "fixing" a test you don't own.
- **Worktree-collision on branch cleanup.** The local branch-switch failed during
  `gh pr merge`, but the **merge itself succeeded** (squash `3ff93301`). Check the PR state
  before assuming failure; clean up the remote branch + worktree from the **parent** repo.
- **Removing the worktree deletes the session's CWD.** The final `git worktree remove` kills
  the shell's working directory — that's the expected terminal state, not an error.

## 8. Reproduce it faster — checklist

**Inputs to have ready**
- The planned OpenSpec change already in its worktree (`.worktrees/os-<change>`, branch
  `os/<change>`).
- `gh` authenticated; push access to the repo.
- Knowledge of any parallel `develop` fixes your CI depends on.

**Steps**
- [ ] Run `ship-it` from inside the worktree; let it orient on the change artifacts.
- [ ] Confirm the runtime APIs the fix needs are exported before coding.
- [ ] Implement surgically; make the predicate return the exact boolean the claim renders on.
- [ ] Rewrite (don't weaken) tests; run the package suite with `HOME=$(mktemp -d)`.
- [ ] Run no-weakening scan + full `npm test`; triage every failure to package ownership.
- [ ] **Archive before the PR** (`openspec archive <change> --yes`); verify the spec synced.
- [ ] Commit → push → open PR against `develop` → watch CI.
- [ ] If CI red on pre-existing `develop` breakage → **rebase onto develop**, force-push-with-lease.
- [ ] Re-run flaky jobs; confirm CodeRabbit clean; squash-merge `--delete-branch`.
- [ ] Remove the worktree from the parent repo.

**Artifacts produced**
- `packages/flows-plugin/src/client/shouldRender.ts` (new)
- `packages/flows-plugin/src/client/flowsAvailability.ts` (trimmed)
- `packages/flows-plugin/src/__tests__/flowsAvailability.test.ts` (rewritten)
- `packages/flows-plugin/src/client/index.tsx` (edited)
- `openspec/changes/archive/2026-07-14-fix-empty-flows-subcard/` + synced delta spec
- PR #321, squash-merged as `3ff93301`

---

_Generated from session `019f6257` · `pi-agent-dashboard` · 2026-07-14. Source extract: facts sheet from `2026-07-14T20-35-34-260Z_019f6257-92f4-77d3-906d-c4d7dde2f586.jsonl`._
