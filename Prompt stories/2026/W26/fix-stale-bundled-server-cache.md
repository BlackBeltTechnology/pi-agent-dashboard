---
session: 019f103e
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "yes — heavy steering (8 user prompts); large facts sheet (~10590 tok)"
upgrade_status: pending
openspec_changes: [fix-stale-bundled-server-cache]
proposal_excerpt: "`packages/electron/scripts/build-installer.sh` skips re-running `bundle-server.mjs` whenever `resources/server/node_modules` already exists (\"Bundled server already present\"). This cache check ignores changes to eithe…"
---

# How we did it: fix-stale-bundled-server-cache — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a terse validation request:

> *"Current proposal is: fix-stale-bundled-server-cache. The code improved a lot from the proposal. Validate."*

The **real objective** emerged across the session: take an existing OpenSpec change whose
proposal was written against an *older* state of the code, confirm the proposal's premises
still hold, then drive it end-to-end — **implement all 16 tasks, self-review the diff for
correctness gaps, and ship it as a merged PR** — despite an external blocker (CodeRabbit's
org credits exhausted). The change closes a build-time bug: `build-installer.sh` skipped
re-bundling the server whenever `resources/server/node_modules` already existed, so a stale
bundle could ship even after source changed.

## 2. TL;DR playbook

1. **Validate first, implement never-blindly.** Ask the AI to diff the proposal's claims
   against real code: `git diff develop -- <target scripts>`. If empty, implementation is 0% —
   the proposal describes the code as it *still is*, which is the green light to build.
2. **Reconcile design to existing idioms** before writing code: point `design.md`/`tasks.md`
   at precedents already in the file (here: the existing `GO/NO-GO` `✗ … process.exit(1)`
   guards in `bundle-server.mjs`) so the new code matches house style, not abstract snippets.
3. **Run `/skill:openspec-apply-change <name>`** to implement task-by-task. Let the AI verify
   each step (`bash -n`, `node --check`, focused `vitest run`, `openspec validate --strict`).
4. **Correct paths against reality, not artifacts.** The AI found Vite emits to
   `packages/dist/index.html`, not the `packages/dist/client/index.html` the artifacts claimed —
   it implemented against the real path and reconciled the docs.
5. **Prompt `review`** to trigger the advisory code-review gate. When CodeRabbit is
   rate-limited, have the AI do a substantive self-review of every hunk instead.
6. **Steer on the finding**: the self-review caught that the freshness watch-set was narrower
   than `BUNDLED_WORKSPACE_PKGS` — a stale-ship gap. Say `yes` to fix, then `review` again.
7. **`use skill ship-change`** to archive+sync specs, commit, push, open the PR, watch CI.
8. **Resolve the DIRTY PR**: union-merge conflicting file-index rows + CHANGELOG, revert any
   spurious lockfile churn, push — CI flips green.
9. **Accept manual review in lieu** when CodeRabbit is hard-blocked (org credits), then
   squash-merge + delete branch + remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Validate (the gate before building).** The AI ran `openspec validate --strict`
(structurally PASS) but went further: it diffed both target scripts against `develop`, found
them byte-identical, and concluded implementation was **0% done** while the proposal's premises
were **not stale**. This "prove the premises against real code" move is what made blind
implementation safe.

**Phase 2 — Reconcile design to precedent.** On steering `b`, the AI rewrote `design.md`
D2/D3 and `tasks.md` 2.1/2.2 to reuse the file's *existing* GO/NO-GO error idiom rather than
invent a new format — so the implementation would land as a natural third guard next to the
two already there.

**Phase 3 — Apply (16 tasks).** `/skill:openspec-apply-change` drove the build: three new
GO/NO-GO guards in `bundle-server.mjs` (hard-fail on missing client, post-materialize verify,
`.bundle-stamp` write), a `.bundle-stamp` freshness gate in `build-installer.sh`, a repo-lint
test (`bundled-server-materialization.test.ts`), delegated docs updates (per AGENTS.md,
caveman-style, via a subagent), a CHANGELOG `### Build` entry. Each step was verified in
isolation; heavy Electron builds were **avoided** by testing the gate logic via an isolated
harness.

**Phase 4 — Review & the real finding.** The `review` prompt hit CodeRabbit rate-limiting, so
the AI self-reviewed and caught a genuine correctness gap: the watch-set covered only 4 sources
but `bundle-server.mjs` bundles more — editing `packages/shared/src` wouldn't invalidate the
cache → stale ship. The user said `yes`; the AI expanded the watch-set to mirror
`BUNDLED_WORKSPACE_PKGS` exactly and tied them with a comment so they can't drift.

**Phase 5 — Ship.** `use skill ship-change` archived+synced specs, then hit two snags: a
34k-line `package-lock.json` churn (npm `dev:true` reclassification — reverted) and a stale
`SUPERSEDED.md` contradicting the implemented proposal (removed). The PR opened `DIRTY`; the AI
union-merged file-index + CHANGELOG conflicts, pushed, and CI went green (confirming local test
failures were machine-load flakes).

**Phase 6 — External blocker.** CodeRabbit could not complete (org prepaid credits exhausted;
each retry extended the cooldown 47→5→53 min). On `Wait for coderabbit review`, the AI polled,
diagnosed the billing root cause, stopped polling, and — with the user accepting manual review
in lieu — squash-merged PR #190, deleted the branch, and removed the worktree.

## 4. Prompts that worked

- **The goal prompt** (`"…The code improved a lot from the proposal. Validate."`) was effective
  because it told the AI the proposal might be *stale relative to code* — prompting a real
  proposal-vs-code diff rather than a rubber-stamp `openspec validate`. A stronger version:
  *"Validate this change: diff the proposal's claims against current `develop` code and tell me
  what's implemented, what's stale, and what's still accurate before we build."*
- **High-leverage follow-ups**: `b` (accept the design reconciliation), `yes` (fix the watch-set
  finding), `review` (twice — force the code-review gate), `use skill ship-change`,
  `Wait for coderabbit review`. Each is one word/line yet unlocks a whole phase because the AI
  already holds the plan; the human just picks the branch.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat `openspec validate --strict` PASS as "validated" | Asking to `Validate` the *substance* (proposal vs real code) | Make "diff proposal claims vs `develop`" step 1 of any validate |
| Implement against artifact-stated paths (`packages/dist/client/index.html`) | (AI self-corrected) verifying the real Vite output path | State "verify paths against real build output, reconcile artifacts" up front |
| Defer silently when CodeRabbit rate-limited | `review` again; accept manual review in lieu at ship | Treat CodeRabbit as advisory; require a manual hunk-by-hunk self-review as the real gate |
| Risk committing spurious lockfile + stale SUPERSEDED.md | ship-change skill's stop-and-flag discipline | Always `git status` the staged set before commit; revert unrelated churn |
| Read only the areas it reasoned about | Prompt `review` a second time → full every-hunk read | Ask for two review passes: reasoned areas, then every changed hunk |

Key quality bar the user imposed implicitly: **never ship a red gate without diagnosing it** —
the AI proved the local test failures were machine-load flakes (isolated re-runs, raised
timeouts) and let GitHub CI be the arbiter, rather than pushing on red or faking green.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session, but the workflow chained four existing ones
cleanly: **`openspec-apply-change`** (task-by-task build), the **implement** review gate
(`.pi/skills/implement/scripts/review-changes.ts`), **`ship-change`** (archive→PR→merge), and a
**general-purpose subagent** for the `docs/` writes (mandatory per AGENTS.md caveman-style rule).

**Recommended skill to create:** a *"validate-repurposed-openspec-change"* procedure — diff
proposal claims against `develop`, detect a stale `SUPERSEDED.md`, and confirm the change was
repurposed (old closed concern → new live one) before implementing. This session hit exactly
that trap and resolved it manually; capturing it would make the next repurposed-change validate
mechanical.

## 7. Pitfalls & dead ends

- **`npm test` in a fresh worktree fails with `Cannot find package 'jsdom'`** — the worktree had
  no installed dev deps. Fix: `npm install` in the worktree first, *then* `npm test` (not
  `npx vitest`, which lacks the project's dev deps).
- **Running `npm install` in a worktree reclassifies deps `"dev": true`** → a spurious
  34k-line `package-lock.json` diff. Do **not** commit it — `git checkout -- package-lock.json`.
- **Server integration tests (`createServer`, `/api/health`, `probeServer` perf bound) time out
  at 5 s under full-suite load** on a busy machine. Diagnose before pushing: re-run isolated,
  raise `--test-timeout`, confirm they pass alone → machine-load flakes, not regressions. Let
  GitHub CI be the arbiter.
- **PR opens `DIRTY`/`CONFLICTING` → CI never starts.** Merge `develop`, resolve conflicts
  (here: union-merge file-index rows + CHANGELOG `### Build`), push → flips `MERGEABLE`, CI runs.
- **CodeRabbit "pass" with 0 comments may be a rate-limited ACK, not a real review.** Check the
  summary comment body for "Review limit reached". Each `@coderabbitai review` retry *extends*
  the cooldown when org credits are exhausted — stop polling; it's an admin/billing blocker.
- **`gh pr merge --delete-branch` from inside the worktree** errors on the local post-merge
  checkout (worktree/`develop` collision). The remote merge still succeeds — verify via API,
  then delete the branch + remove the worktree from the **parent** repo.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an OpenSpec change name; a clean worktree on its branch; `gh` auth;
network for CI/CodeRabbit.

1. `openspec validate <name> --strict` **and** `git diff develop -- <target files>` → confirm
   premises accurate, implementation status.
2. Reconcile `design.md`/`tasks.md` to existing code idioms (precedent guards, real output paths).
3. `/skill:openspec-apply-change <name>` → build all tasks; verify each (`bash -n`,
   `node --check`, focused `vitest run`, `openspec validate --strict`).
4. `review` → run advisory gate; if CodeRabbit throttled, self-review every hunk. Fix findings
   (`yes`), `review` again.
5. `npm install && npm test` in the worktree; diagnose any red as flake vs regression.
6. `use skill ship-change` → archive+sync, revert lockfile churn, remove stale SUPERSEDED.md,
   commit, push, open PR, watch CI.
7. Resolve any `DIRTY` state (merge develop, union conflicts, push) → CI green.
8. Accept manual review if CodeRabbit hard-blocked → squash-merge, delete branch, remove worktree.

**Final artifacts:** PR #190 merged to `develop` (squash `0522191e`);
`packages/electron/scripts/{bundle-server.mjs,build-installer.sh}` (freshness gate + 3 GO/NO-GO
guards); `packages/shared/src/__tests__/bundled-server-materialization.test.ts`; 3 requirements
synced into `openspec/specs/electron-build-pipeline/spec.md`; CHANGELOG `### Build` entry.

---

_Generated from session `019f103e-4694-7923-9b32-fc1da93ca8ab` · `pi-agent-dashboard` · 2026-06-29. Source extract: `/tmp/facts-53516-1784849662.md`._
