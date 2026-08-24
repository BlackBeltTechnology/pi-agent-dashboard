---
session: 019f2ca9
week: 2026/W27
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [remove-vestigial-tsconfig-references]
proposal_excerpt: "Five package tsconfigs declare TypeScript project references to `../shared`:"
---

# How we did it: Remove vestigial tsconfig `references` — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a three-word prompt: **"doubt review this proposal"**. The
proposal was an OpenSpec change (`remove-vestigial-tsconfig-references`) to delete
inert `references: [{ path: "../shared" }]` arrays from five package tsconfigs
(`client`, `server`, `extension`, `dashboard-plugin-runtime`,
`dashboard-plugin-skill`). No package sets `composite: true` and no script runs
`tsc -b`, so the references do nothing but trigger `TS6306` on isolated
`tsc -p` checks.

The *real* objective, once the later steering turns landed, was the full lifecycle:
**adversarially validate the proposal → apply the change → ship it through CI +
CodeRabbit to a squash-merge.** The doubt review was step one of four.

## 2. TL;DR playbook

1. `doubt review this proposal` — invoke `doubt-driven-review` on the proposal.
2. Let the AI **verify every factual claim against the repo first**, then spawn a
   fresh-context `Explore` reviewer seeded with ARTIFACT + CONTRACT only (no CLAIM).
3. Reconcile findings → patch `proposal.md` + `tasks.md` so the verification plan is
   **executable in a bare worktree** (add `npm install` precondition; change exit-0
   asserts to *no-new-errors-vs-baseline*).
4. `/skill:openspec-apply-change remove-vestigial-tsconfig-references` — run the
   10-task loop. Install deps, capture baseline, delete all 5 `references` arrays in
   one pass, verify `TS6306` gone.
5. Mid-apply, **re-align an over-tightened task back to the spec contract** (the spec
   only requires `TS6306` gone, not isolated exit-0 — see §5).
6. Revert incidental `package-lock.json` churn to keep the diff surgical.
7. `Use ship-change skill` — verify gate (build + tests), archive + sync specs,
   commit, push, open PR against `develop`, watch CI.
8. When CodeRabbit's green check is a **rate-limited ACK, not a real review**, retry
   `@coderabbitai full review` across the adaptive window until a genuine walkthrough
   posts.
9. Squash-merge; do worktree branch cleanup **from the parent repo**, not the
   removed worktree.

## 3. How the collaboration unfolded

**Phase A — Doubt-driven review (Discovery).** The AI applied `doubt-driven-review`.
Rather than trusting the proposal, it independently checked each premise: exactly 5
tsconfigs carry the reference, none set `composite`, no `tsc -b` anywhere, root config
is a flat `include` program, `TS6306` fires as described. All premises held. Then it
spawned a **fresh-context `Explore` subagent** given only the artifact and contract —
no claims to anchor on — which independently confirmed the finding and added more.
*Why it worked:* separating "is the change safe" from "is the verification plan
honest" caught that the proposal asserted `tsc --noEmit → exit 0`, but in the bare
worktree it exits **2** with 7 pre-existing `image-fit-extension` errors — because
**the worktree has no `node_modules`** and TS falls back to the main repo's older
`jimp`. **Decision point:** user replied `yes` → proceed with the patches.

**Phase B — Apply (Generate + Verify).** `/skill:openspec-apply-change` ran the
10-task loop. The AI installed deps, captured a clean baseline, deleted all five
`references` arrays in one edit pass, then verified. **Decision point mid-apply:** its
own doubt-review rewrite of task 2.2 (`each isolated check exits 0`) *overshot the
spec* — removing `TS6306` unmasked latent, unrelated errors (`TS6059` rootDir from
tests importing `qa/` fixtures, `TS6142` jsx, `TS18046` any) that the hard-stop
`TS6306` had been masking. It corrected 2.2 back to the spec's true contract:
`TS6306` gone on all five. Then reverted `package-lock.json` churn.

**Phase C — Ship (Land).** `Use ship-change skill` drove build + tests (2 failures
proven pre-existing/env-leak, not regressions), archive + spec sync, commit, push,
PR #234, CI watch.

**Phase D — CodeRabbit rate-limit fight.** CI went green in 9m1s, but CodeRabbit's
"pass" was a **rate-limited ACK**, not a review. The adaptive limit grew (28→46 min)
on each attempt. **Decision point:** user said `wait less, because maybe available
now` — shortening the polling. Eventually a genuine walkthrough posted with 0
actionable comments. Squash-merged (#234, `06c833b1`); branch cleanup done from the
parent repo after the worktree collision aborted `--delete-branch`.

## 4. Prompts that worked

- **The goal prompt — `doubt review this proposal`.** Terse but high-leverage: it
  named a skill (`doubt-driven-review`) and pointed it at a concrete artifact. A
  future kickoff could add the lifecycle intent up front:
  *"doubt-review this proposal, then apply and ship it."*
- **`yes`** — a one-word go-ahead after the AI laid out four classified findings and
  asked to proceed. Effective because the AI had already structured the decision so a
  binary answer was enough.
- **`/skill:openspec-apply-change <name>`** — explicit skill + change name, zero
  ambiguity.
- **`Use ship-cange skill`** (typo and all) — still routed correctly; the AI
  recognized the intent and loaded `ship-change` from the main repo root.
- **`wait less, because maybe available now`** — a nudge that overrode the AI's long
  fixed sleeps with shorter polling against the CodeRabbit window.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust the proposal's `exit 0` claim | (AI self-caught, but only because doubt-review was invoked) | Always run `doubt-driven-review` before applying a change whose verification asserts a specific exit code |
| **Over-tighten** the verification bar during the doubt rewrite (`each isolated check exits 0`) | (self-corrected mid-apply against the spec) | Rewrite tasks to match the **spec contract exactly**, not a stricter bar the AI thinks is "better" — here the spec only needs `TS6306` gone |
| Assume a fresh worktree behaves like main | Nothing — but it exits 2 without `node_modules` | Make `npm install` an explicit precondition in any worktree verification task |
| Treat CodeRabbit's green check as a real review | Implicit; the AI caught the ACK, but wasted time on long fixed sleeps | Recognize the rate-limit ACK pattern immediately; poll short, don't fixed-sleep 29–47 min |
| Long fixed `sleep 1740/2820` waits | `wait less, because maybe available now` | Poll the CodeRabbit window in short intervals; the adaptive limit can shrink as time passes |
| Run branch cleanup from the (now-removed) worktree cwd | (self-caught: Bash couldn't spawn) | Do `gh pr merge` cleanup and remote-branch delete **from the parent repo**, never the worktree being removed |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was a **consumption** run of
the existing pipeline. The skills that carried it:

- **`doubt-driven-review`** — the highest-leverage move. It caught that the proposal's
  evidence was dishonest for a bare worktree *before* any code was touched. Invoke it
  on any proposal whose success criteria assert exit codes or "clean" checks.
- **`Explore` subagent (fresh context, ARTIFACT+CONTRACT only)** — independent
  confirmation without claim-anchoring bias. Reusable pattern: seed the reviewer with
  what to check, never with the author's conclusions.
- **`openspec-apply-change`** — the 10-task apply loop.
- **`ship-change`** — the CI/CodeRabbit/merge lifecycle.

**Recommended skill to create:** a `coderabbit-rate-limit` note — *"a green
CodeRabbit check can be a rate-limited ACK, not a review; look for
`Review limit reached` in the summary comment; the adaptive window can grow on each
retry; poll short."* This friction cost ~2 hours of wall-clock this session.

## 7. Pitfalls & dead ends

- **Bare worktree has no `node_modules`** → `npx tsc --noEmit` exits 2 with unrelated
  `jimp`/`image-fit-extension` errors (TS resolves against the main repo's older
  dependency). Fix: `npm install` in the worktree first.
- **`TS6306` masks other errors.** It's a hard-stop that aborts the isolated compile
  early. Removing `references` unmasks latent `TS6059`/`TS6142`/`TS18046` errors that
  were *always there* — don't mistake them for regressions, and don't gate on
  isolated exit-0.
- **`npm install` churns `package-lock.json`** with version-normalization noise
  (bin path, `libc` metadata). Revert it to keep a config-only diff surgical.
- **CodeRabbit "pass" ≠ reviewed.** The check can be a rate-limited ACK. The adaptive
  limit *grew* 28→46 min across retries before finally dropping to 6. Don't fixed-sleep
  the full window; poll.
- **Two test failures were red herrings** — `EditorSearchPanel` (flaky, passed on
  isolated re-run) and `node-electron-resolution` (leaks the real local
  `/Users/robson/.pi-dashboard/node/...` path into its expectation). Confirmed
  pre-existing via empty `git log origin/develop..HEAD`. Never assume test red = your
  change; prove it against the base branch.
- **`gh pr merge --delete-branch` from a worktree** tries to switch the local repo to
  `develop`, which the parent already holds → aborts before deleting the remote
  branch. The PR still merges on GitHub; finish cleanup (worktree remove, local +
  remote branch delete) from the parent repo.

## 8. Reproduce it faster — checklist

**Inputs you need ready:**
- An OpenSpec change dir with `proposal.md` + `tasks.md`.
- A worktree checkout (`.worktrees/os-<name>`), `gh` authenticated, `develop` base.

**Checklist:**
- [ ] `doubt review this proposal` → verify every factual claim against the repo.
- [ ] Spawn a fresh-context `Explore` reviewer (ARTIFACT + CONTRACT, no CLAIM).
- [ ] Patch `tasks.md`/`proposal.md`: `npm install` precondition; gate on
      *no-new-errors-vs-baseline*, matching the **spec contract exactly** (here:
      `TS6306` gone, not isolated exit-0).
- [ ] `/skill:openspec-apply-change <name>` → install, baseline, delete all 5
      `references` in one pass, verify.
- [ ] Revert `package-lock.json` churn.
- [ ] `Use ship-change skill` → build + tests (prove any red is pre-existing),
      archive + sync specs, commit, push, PR vs `develop`.
- [ ] Watch CI; if CodeRabbit is a rate-limited ACK, retry
      `@coderabbitai full review` with **short** polling.
- [ ] Squash-merge; do branch/worktree cleanup **from the parent repo**.

**Final artifacts produced:**
- 5 edited `packages/*/tsconfig.json` (references removed)
- `openspec/specs/monorepo-workspace-structure/spec.md` (requirement synced)
- Archived change under `openspec/changes/archive/2026-07-04-…`
- PR #234 — squash-merged, merge commit `06c833b1`

---

_Generated from session `019f2ca9-8482-7856-b6d1-1eb6d91891f1` · `pi-agent-dashboard` · 2026-07-04. Source extract: session facts sheet._
