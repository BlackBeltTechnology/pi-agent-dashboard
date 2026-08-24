---
session: 019f6259
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "large facts sheet (~10513 tok)"
upgrade_status: pending
openspec_changes: [add-auto-session-naming]
proposal_excerpt: "A pi session's display name is either the user's manual rename or, absent that, the cwd basename (`session-rename`). Most sessions never get renamed, so a directory full of work reads as a wall of identical folder nam…"
---

# How we did it: shipping `add-auto-session-naming` end-to-end — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator invoked the **`ship-it`** skill inside the change's git worktree
(`.worktrees/os-add-auto-session-naming`) — a single kickoff that means "run the whole
implementation phase of this OpenSpec change: apply the tasks, test, and land the PR,
headless." The real objective was to take the `add-auto-session-naming` change from
0/24 unchecked tasks to a merged commit on `develop`: a cross-package feature (shared →
server → extension → client) where an unnamed pi session names *itself* after its first
terminal turn using an in-process `@fast` call, with provenance tracking so a manual
rename permanently wins. The only human steering during the ~11-hour run was one word,
**"archive first"** — a sequencing correction at the ship boundary.

## 2. TL;DR playbook

1. **Start inside the worktree**, invoke `ship-it`. Let it orient: read `proposal.md`,
   `design.md`, and the spec deltas *before* touching code.
2. **Detect the change vintage.** No `test-plan.md` → legacy change → use
   `openspec-apply-change` + the keyword-defer path in `ship-change` (skip manifest gating).
3. **Map the full architecture first** in a couple of batched `grep` sweeps (config-push
   path, rename handler, `agent_end` hook, preferences-store accessors) *before* editing —
   a ~24-task cross-package feature needs the wiring mapped once, up front.
4. **Implement in dependency order**: shared → server → extension → client. Run
   `tsc`/`vitest` between stages so type interdependencies surface early.
5. **Fix the worktree resolution trap** (see §7): create worktree-local
   `node_modules/@blackbelt-technology/*` symlinks to the worktree's own packages so
   `tsc`/`vitest` see your edits, not the parent repo's unedited source.
6. **TDD each module**: write the unit test, watch it pass, mark the task. New pure
   helpers (`auto-session-namer.ts`) get their own 40-assertion test file.
7. **Categorize every full-suite failure** as *mine* vs *pre-existing/environmental* —
   confirm the latter fail identically on `develop` before dismissing them.
8. **Say "archive first"** at the ship boundary so specs are folded and the change moved
   to archive *before* the commit — the archive lands on the branch as part of the PR.
9. **Ship**: commit → push → open PR → watch CI → squash-merge → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Orient & gate (legacy-change detection).** The AI read the change artifacts,
found the working tree clean and all tasks unchecked, and noted there was **no
`test-plan.md`** → classified this as a *legacy* change, so it skipped manifest gating and
chose the `openspec-apply-change` + keyword-defer route. *Why it worked:* branching on a
single filesystem signal picked the correct downstream path with no guesswork.

**Phase 2 — Map the architecture in batches.** Rather than edit-then-discover, the AI ran
several batched `grep` sweeps to locate the config-push path to bridges
(`piGateway.broadcast`), the rename handler, the `agent_end` hook, and the
preferences-store accessor pattern. *Why it worked:* a 24-task cross-package feature has
type interdependencies; mapping them once meant edits went in dependency order without
backtracking.

**Phase 3 — Implement shared → server → extension → client.** Each package was edited then
type-checked before moving on: `nameSource` on `SessionMeta`; protocol messages
(`auto_name_error`, `preferences_update`, provenance on `session_name_update`);
`autoNameSessions` pref + REST route; the core `auto-session-namer.ts` with pure testable
helpers + a stateful factory (provenance latch: auto→external→user lockout); the client
toast + Settings toggle + i18n. *Decision point:* the AI hit the worktree node-resolution
trap mid-server (Phase 3) and fixed it surgically with worktree-local symlinks (§7).

**Phase 4 — TDD & verify.** 101 new assertions across new/edited test files; then the full
suite surfaced 20 failures. The AI **categorized** them: 16× jimp env issue, 1×
publish-allowlist (unrelated packages), 3× spa-fallback (needs a built `dist/client`) —
all confirmed pre-existing on `develop`, none touching the change. *Why it worked:*
disciplined mine-vs-theirs triage prevented chasing environmental noise.

**Phase 5 — Ship (with the one steer).** The human said **"archive first."** The AI drove
`ship-change` inline: verify gate (incl. `npm run build`), then `openspec archive` — which
**refused** because two main specs were pre-corrupted with delta headers. The AI repaired
them, archived (folding 7 requirements), committed, pushed, opened PR #323, and watched CI
green. CodeRabbit was account-rate-limited for ~9.5h; after the wait `develop` had advanced
→ one `App.tsx` union conflict resolved → re-pushed → CI green → squash-merged
(`820a7584`) → worktree removed.

## 4. Prompts that worked

- **The goal prompt (skill invocation).** Invoking `ship-it` *from inside the worktree* was
  the entire kickoff — it carries the orient→apply→test→ship contract, so no prose brief was
  needed. *Effective because* the skill encodes the phase order; the operator supplies only
  the location.
- **High-leverage follow-up: "archive first."** Two words that corrected the ship sequence
  (fold specs + archive **before** commit, so the archive is part of the PR diff rather than
  a follow-up on `develop`). *Effective because* it's a precise sequencing constraint that
  changes where the archive lands.
  - Stronger reusable form: *"Archive the change (fold specs) before the commit so the
    archive lands on the branch as part of the PR — do not archive from the parent repo."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach the commit step with the archive still pending | "archive first" | Stating up front: *archive + sync specs before commit, from the worktree so it lands on the branch* |
| Trust `tsc`/`vitest` resolving to the parent repo's unedited packages | (self-corrected) diagnosed the empty worktree `node_modules` scope | Create worktree-local `@blackbelt-technology/*` symlinks immediately after entering a worktree |
| Wait open-endedly on a rate-limited external gate (CodeRabbit, ~9.5h / 18 cycles) | tolerated it, then "merge now" | Cap the external-review wait; treat green CI + full tests as the merge gate when the cloud reviewer is down |

The only explicit human steer was **"archive first."** The other rows are self-corrections
worth pre-empting because they cost real time (the resolution trap) or wall-clock (the
rate-limit wait).

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the work was *driven by* existing
skills (`ship-it` → `openspec-apply-change` → `ship-change` → archive). The reusable asset
the session **produced in code** is `packages/extension/src/auto-session-namer.ts`: pure,
testable naming helpers + a stateful factory with a provenance latch. *Worth capturing as a
memory:* the **worktree node-resolution fix** (empty worktree `node_modules` → symlink the
`@blackbelt-technology/*` scope to the worktree's own packages) — it recurs for every
cross-package change built in a worktree and cost a full diagnostic detour here.

## 7. Pitfalls & dead ends

- **Worktree resolves to the parent's packages.** The worktree's `node_modules` was nearly
  empty, so `tsc`/`vitest` imported `@blackbelt-technology/*` from the parent repo's
  unedited source — your worktree edits are invisible. *Fix:* create worktree-local
  workspace symlinks pointing at the worktree's own `packages/*`; node resolves the closer
  scope first, third-party deps still fall through to the parent.
- **`openspec archive` refuses on pre-corrupted main specs.** `global-preferences/spec.md`
  and `session-rename/spec.md` began with `## ADDED Requirements` (delta headers) instead of
  `## Purpose`/`## Requirements`. *Fix:* convert them to proper main-spec structure, then
  re-run archive. (102 repo-wide failures were the same pre-existing corruption — out of
  scope; only fix the two your archive touches.)
- **Full-suite noise ≠ your regressions.** 20 failures (jimp constructor, publish-allowlist,
  spa-fallback needing a built `dist/client`) were all environmental/pre-existing. *Fix:*
  confirm each fails identically on `develop` before dismissing; verify your touched files
  are green.
- **CodeRabbit account-level rate limit doesn't self-clear via retries.** ~9.5h / 18 cycles
  of "next review available in 14 minutes." *Fix:* don't loop open-ended — decide a wait cap;
  green CI + full test coverage is a defensible merge gate.
- **`--delete-branch` can't check out `develop` locally** when the parent worktree holds it.
  The remote branch still deletes; remove the worktree from the parent repo afterward.

## 8. Reproduce it faster — checklist

- [ ] Be **inside the change worktree** (`.worktrees/os-<change>`, branch `os/<change>`).
- [ ] Read `proposal.md` + `design.md` + spec deltas before editing.
- [ ] No `test-plan.md`? → legacy change → `openspec-apply-change` + keyword-defer.
- [ ] Create worktree-local `node_modules/@blackbelt-technology/*` symlinks → worktree edits resolve.
- [ ] Map the wiring (config-push, rename handler, `agent_end`, prefs accessors) in one batch.
- [ ] Implement **shared → server → extension → client**, `tsc`/`vitest` between stages.
- [ ] TDD new modules; categorize full-suite failures as mine vs pre-existing (check `develop`).
- [ ] **Archive first**: fold specs + `openspec archive` from the worktree → then commit.
- [ ] Repair any pre-corrupted main specs blocking archive (delta headers → `## Purpose`/`## Requirements`).
- [ ] Commit → push → PR vs `develop` → watch CI → cap external-review wait → squash-merge → remove worktree.

**Key inputs to have ready:** the change worktree, the OpenSpec change artifacts, `gh` auth,
CI access. **Final artifacts:** PR #323 (merged, squash `820a7584` on `develop`); new source
`packages/extension/src/auto-session-namer.ts`; 5 new source/test files; +390/−33 across 30 files.

---

_Generated from session `019f6259` · `pi-agent-dashboard/.worktrees/os-add-auto-session-naming` · 2026-07-14. Source extract: deterministic facts sheet._
