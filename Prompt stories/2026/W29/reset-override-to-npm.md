---
session: 019f627b
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [reset-override-to-npm]
proposal_excerpt: "The Packages settings UI already detects source overrides: a recommended extension declared as npm (RECOMMENDED_EXTENSIONS[].source = \"npm:<name>\") but actually installed from a local checkout or git URL renders…"
---

# How we did it: Reset a package source-override back to published npm — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was the **`ship-it` skill invocation** itself — not a prose request.
The operator handed the AI a fully-planned OpenSpec change (`reset-override-to-npm`)
sitting in its own git worktree and said, in effect, *"run ship-it on this."* The
real objective, once the skill's decision logic engaged: **implement the entire
feature end-to-end (TDD), verify it, and land it as a squash-merged PR against
`develop` — headless, no hand-holding.**

The feature: the Packages settings UI already *detects* when a recommended
extension declared as `npm:<name>` is actually installed from a local checkout or
git URL (a "source override"). This change adds the **action** to undo that — an
in-UI "↺ Reset to npm" that atomically re-installs the published variant
(install-first, remove-second) and reports partial success honestly.

## 2. TL;DR playbook

1. **Invoke `ship-it` inside the change's worktree** (`.worktrees/os-<change>`, branch `os/<change>`). It orients itself: reads the change artifacts, checks filesystem reality, detects no `test-plan.md` → legacy path → delegates to `openspec-apply-change`.
2. **Read the whole slice in parallel first** — specs + every source file you'll touch (`rest-api.ts`, `package-manager-wrapper.ts`, `package-routes.ts`, the enricher, the client hook/tracker/row). Find the **existing `move` operation** and use it as the template for the new `reset` op.
3. **Implement TDD, bottom-up:** shared types + WS protocol → server resolver/enricher + atomic `reset()` op + route → client api/hook/tracker + `PackageRow` dual-line + confirm dialog + shared partial-success banner → wire into both package lists.
4. **Run server unit tests with `HOME=$(mktemp -d)`** to isolate config, iterate to green, then client tests, then a whole-repo `tsc --noEmit`.
5. **When worktree `tsc` reports phantom errors on your new shared field**, don't chase them — the worktree resolves `pi-dashboard-shared` through the *parent repo* symlink (main checkout, lacking your field). Prove types are clean with a `paths`-override tsconfig; CI checks out the branch normally and resolves correctly.
6. **Update docs directly** (AGENTS.md rows + split-file sidecars + the `switch-extension-source` skill cross-ref), mark `tasks.md`, note the E2E deferral.
7. **Steer: merge `develop` before the PR, archive before commit.** Check for file overlap first (`git status` vs develop diff) — zero overlap → clean merge guaranteed. Stash → merge → restore → re-run targeted tests.
8. **Archive the change + sync specs**, commit, push, `gh pr create --base develop`, watch CI + CodeRabbit, fix the **substantive** review items only, re-push, squash-merge with branch delete, remove the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Orient (skill-driven).** `ship-it` read the change artifacts, saw all
tasks unchecked, found no `test-plan.md` (legacy change), confirmed a clean worktree
(nothing implemented yet), and routed to `openspec-apply-change`. *Why it worked:* the
skill's `filesystemRealityCheck` gates on actual files, not the tasks.md checkbox, so
it never re-does work or trusts stale state.

**Phase 2 — Read the slice in parallel.** Before writing a line, the AI read the
specs and every file it would modify, explicitly hunting for the **`move` operation**
as a proven template for the symmetric new `reset` operation. *Decision point:* model
the new op after `move` (same partial-success/WS/tracker machinery) rather than invent
new plumbing — this is what kept the change bounded.

**Phase 3 — Implement TDD, bottom-up.** Shared types first (`publishedVariantSource`/
`publishedVariantVersion`, WS `action` union += `"reset"`), then server (`resolvePublishedVariant`,
`attachPublishedVariants`, `PackageManagerWrapper.reset()`/`executeReset()` +
`InvalidResetRequestError`, `POST /api/packages/reset-to-npm`), then client (`resetToNpm`
helper + hook, `move-tracker` reused via `kind:"reset"`, dual-line `PackageRow` + inline
button + ⋮ item + confirm dialog, a shared `PackagePartialSuccessBanner` extracted so both
lists reuse it). Tests written before each implementation.

**Phase 4 — Verify.** `HOME=$(mktemp -d)` isolated vitest runs per layer, then the full
6545-test suite (one unrelated `doctor-route` timing flake, confirmed by isolated re-run),
then Biome (auto-fix formatting; remaining items `warn`-level `noExplicitAny` matching the
existing `movePackage` pattern), then the advisory CodeRabbit gate on the diff (clean).

**Phase 5 — Steered ship.** The operator's one steering turn — *"merge develop before PR
and archive before commit"* — reordered the ship sequence. The AI checked file overlap
(zero), stashed/merged/restored, re-ran tests, archived + synced specs, committed, pushed,
opened PR #325, watched CI + CodeRabbit (green first pass), fixed the 4 substantive review
items, re-pushed (green again), and squash-merged with full worktree/branch cleanup.

## 4. Prompts that worked

- **The goal prompt = a skill invocation.** Handing the AI `ship-it` on a
  pre-planned, worktree-isolated change is the highest-leverage kickoff possible: the
  skill carries the entire orient→apply→test→ship contract, so the "prompt" is just
  *point it at the change.* A future operator should ensure the change is fully
  planned (specs + tasks.md) and living in its worktree **before** invoking.
- **High-leverage steering follow-up:** *"merge develop before PR and archive before
  commit"* — nine words that corrected the ship ordering and prevented a stale-branch
  PR + an unarchived change. Short, imperative, sequence-explicit.
- **Rewrite for next time:** bake the ordering into the skill/checklist so it needn't
  be steered at all — *"always sync develop into the branch, then archive + sync specs,
  then commit → PR."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Head straight to commit → PR after implementation | "merge develop before PR and archive before commit" | Making "sync develop → archive+sync specs → commit" a fixed pre-PR step in `ship-it`/`ship-change` |
| Treat worktree `tsc` phantom errors as real bugs | (self-corrected) prove types via a `paths`-override tsconfig | Documenting the worktree-symlink resolution quirk so it's recognized instantly |
| Risk overfitting review-fix churn | Fix only the **4 substantive** CodeRabbit items; skip advisory AGENTS.md style nitpicks | A triage rule: address code-correctness/security review comments; batch style nitpicks separately |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this session *consumed* the existing pipeline
(`ship-it` → `openspec-apply-change` → docker-harness/tests → `ship-change`) rather
than producing new tooling. That's the point: a well-composed skill chain turns a
large 18-file, full-stack feature into a headless, single-invocation ship.

Two reusable lessons worth persisting as memory if not already captured:
- **Worktree shared-package resolution quirk:** a worktree with no local
  `node_modules` resolves `@blackbelt-technology/pi-dashboard-shared` through the
  *parent* repo symlink (main checkout), so a newly-added shared field shows phantom
  `tsc` errors locally though CI (normal checkout) is clean. Verify with a
  `paths`-override tsconfig instead of chasing the errors.
- **`HOME=$(mktemp -d)` for isolated vitest** avoids config/state bleed from the real
  home dir during server-test runs.

## 7. Pitfalls & dead ends

- **Phantom `tsc` errors in the worktree** (6 × `publishedVariantSource`): *not* a bug
  — the worktree symlinks shared to the main checkout. If you hit this, don't rebuild
  or edit types; run `tsc` with a `paths` override pointing shared at the worktree src
  to confirm cleanliness.
- **Atomic `ask_user`/edit batch silently no-op'd** because one line had unquoted
  `not files` in the tasks.md batch. If a batch edit applies nothing, look for an
  unquoted token breaking the payload; re-apply with it quoted.
- **`doctor-route.test.ts` timing flake** (`elapsed 3099 < 3000`): unrelated to the
  change (the test even comments "~1 s on slow CI"). Confirm by re-running the single
  test in isolation before treating it as a regression.
- **`--delete-branch` failed after squash-merge** because `develop` was checked out in
  the main worktree. Expected — delete the remote branch and remove the worktree
  manually from the main repo (`cd` out of the worktree first).
- **Persistent shell cwd died** when the worktree was removed. Harmless; run remaining
  commands from an absolute path / fresh shell. Syncing local `develop` is optional —
  `origin/develop` already has the merge and fast-forwards on the next pull.

## 8. Reproduce it faster — checklist

- [ ] Change is **fully planned** (specs + `tasks.md`) and lives in its worktree (`.worktrees/os-<change>`, branch `os/<change>`).
- [ ] Invoke **`ship-it`** inside that worktree; let it orient + route to `openspec-apply-change`.
- [ ] Read specs + every target file **in parallel**; locate the `move` op as the template.
- [ ] Implement **TDD bottom-up**: shared types/protocol → server op/route/enricher → client hook/tracker/row/banner → wire both lists.
- [ ] Verify: `HOME=$(mktemp -d) npx vitest run …` per layer → full suite → `tsc --noEmit` (ignore worktree-symlink phantom errors; prove via `paths` override) → Biome (errors 0) → CodeRabbit advisory gate.
- [ ] Update docs directly: AGENTS.md rows + sidecars + `switch-extension-source` cross-ref; mark `tasks.md`, note E2E deferral.
- [ ] **Sync develop into the branch (check overlap first) → archive + sync specs → commit** — in that order.
- [ ] `git push` → `gh pr create --base develop` → watch CI + CodeRabbit → fix **substantive** items only → re-push → squash-merge → remove worktree/branch.

**Key inputs:** a planned OpenSpec change in its worktree; `gh` auth; docker harness available for E2E (deferred here). **Final artifacts:** PR #325 squash-merged into `develop` (`4b1cbcc`); 18 code files (shared/server/client) + tests + AGENTS docs; change archived as `2026-07-14-reset-override-to-npm`.

---

_Generated from session `019f627b-8283-7567-8f8e-aeec59c71a78` · `pi-agent-dashboard` · 2026-07-15. Source extract: `/tmp/facts-49522-1784849170.md`._
