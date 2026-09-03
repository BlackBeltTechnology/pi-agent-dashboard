---
session: 019f5cb1
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [sweep-worktree-residual-on-remove]
proposal_excerpt: "Removing a worktree leaves a resurrected husk directory behind. Evidence: 113 orphan `.worktrees/*` dirs, each reduced to `.pi/dashboard/kb/{index.db, index.db-wal, index.db-shm}` and nothing else — no `.git`, no source."
---

# How we did it: Sweep worktree-residual husks on remove — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change sweep-worktree-residual-on-remove`. The real objective, spelled out in the change proposal, was to stop a nasty resource leak: removing a git worktree left behind a **resurrected husk** — an empty `.worktrees/<name>/` directory containing only `.pi/dashboard/kb/{index.db, index.db-wal, index.db-shm}` and nothing else (no `.git`, no source). The repo had accumulated **113 such orphans**. The task was to root-cause the resurrection mechanism, fix it at the source, add a belt-and-suspenders sweep, clean up the existing 113 husks, and land the change end-to-end. The second (and only) steering turn was `ship-it`, which pushed the finished implementation through the full archive→PR→CI→merge→worktree-removal pipeline.

## 2. TL;DR playbook

1. **Apply the change with the skill:** `/skill:openspec-apply-change <change-name>` — it selects the change, reads context + design, and drives TDD.
2. **Ground the mechanism empirically first** (systematic-debugging): build a throwaway repo in `/tmp`, reproduce the husk, and confirm the exact resurrection vector before writing any fix.
3. **Write the RED regression test against the real vector** — here a *fresh* `getKb` cache-miss after `cwd` removal, not the cached handle (the cached path passed spuriously).
4. **Fix at the source (extension self-heal):** make `getKb` refuse to `mkdirSync`-recreate a store for a vanished `cwd`; make `reindexNow` evict + no-op; add `closeKbForCwd`.
5. **Add belt-and-suspenders (server sweep):** `removeWorktree` sweeps the residual dir *after* git confirms success, hard-guarded to realpath strictly inside `<mainPath>/.worktrees/`.
6. **Ship the one-shot cleanup:** write `scripts/prune-orphan-worktrees.ts`, dry-run it, verify no *registered* worktree is in the husk list, then `--write` (cleared 113, idempotent re-run = 0).
7. **Update docs rows** in the nearest `AGENTS.md` (caveman style, source-tree rows edited directly).
8. **`ship-it`** — reality-check the test files exist+pass, then drive `ship-change` inline: build, archive+sync specs, commit, PR against `develop`, watch CI green, clear CodeRabbit, squash-merge, remove worktree (dogfooding the new sweep).

## 3. How the collaboration unfolded

**Phase 1 — Discovery & context load.** The AI selected the change (`spec-driven` schema), read the context files, design doc, and the source it would touch (`git-routes.ts`, `git-operations.ts`, kb-extension `extension.ts`/`reindex.ts`), and located the existing test seams. It also hunted the pi `ExtensionAPI` for a server→extension "cwd removed" event and found none — a key constraint that shaped the design (self-detection on the reindex tick instead of an event).

**Phase 2 — Evidence-first root cause.** Instead of guessing, the AI built a disposable git repo in `/tmp/husk-exp`, added a worktree, seeded a kb dir, and reproduced the husk. It confirmed the exact vector: `git worktree remove` fully deletes the dir, then the extension's `getKb → new SqliteFtsStore` runs `mkdirSync(recursive)` and **recreates the dir by path**. It separately verified `node:sqlite` `store.close()` cleanly drops the `-wal`/`-shm` sidecars (so task "2.2" was verify-only, no change). *Why it worked:* the fix targeted a proven mechanism, not a hypothesis.

**Phase 3 — TDD both layers.** The first RED attempt passed spuriously because the store stayed cached (no fresh `mkdirSync`). The AI caught this and rewrote the test to hit the real cache-miss vector, getting a faithful RED (`existsSync(dir)` true after reindex). Then it implemented the extension self-heal (green, 11/11), followed by the server-side guarded sweep with its own RED test → implementation (green, 28/28).

**Phase 4 — One-shot cleanup with safety rails.** The AI wrote `prune-orphan-worktrees.ts`, ran it dry (113 husks), then *proved safety*: cross-checked the 6 registered worktrees against the 118 on-disk dirs, confirmed the current worktree was excluded, and confirmed every husk was pure kb residue (no `.git`, no source) before `--write`. Result: 113 cleared, `git worktree list` unchanged, idempotent.

**Phase 5 — Docs + discipline checkpoints.** Source-tree `AGENTS.md` rows updated directly (caveman style); the security-hardening and doubt-driven-review checkpoints were reasoned through (guard is symlink/traversal-tested; close↔remove↔sweep ordering is race-safe because `getKb` can no longer recreate the dir regardless of timing).

**Phase 6 — Ship (`ship-it` → `ship-change` inline).** Reality-checked test files, ran the verify gate, isolated the only failures to a **worktree-local jimp resolution artifact** (image-fit passes 29/29 in the main checkout), archived + synced 3 new scenarios into the `worktree-lifecycle` spec, committed, opened PR #308 against `develop`, watched CI to green (~10m — confirming the jimp failures were worktree-only), cleared 0-actionable CodeRabbit, squash-merged, and removed the worktree — **the new sweep step verified no residual husk, dogfooding the fix.**

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change sweep-worktree-residual-on-remove`. Effective because the change already carried a well-scoped proposal with hard evidence (113 orphans, exact husk contents). A skill invocation on a ready change lets the AI go straight to root-cause + TDD. *Lesson:* front-load the evidence into the proposal so the apply step has a target, not a mystery.
- **High-leverage follow-up** — `ship-it`. A two-word prompt that unlocked the entire land pipeline (verify→archive→PR→CI→merge→cleanup) because the project's `ship-it`/`ship-change` skills encode all the steps. *Lesson:* when the implementation is done and green, one word ships it — the discipline lives in the skill.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| (self-corrected) write a RED test against the *cached* store that passed spuriously | — (AI caught it) | State the real failure vector explicitly: "the resurrection happens on a *fresh* `getKb` cache-miss, not the cached handle." |
| (self-corrected) treat worktree-local test failures as regressions | — (AI isolated them) | Establish the rule up front: verify suspicious failures against the **main checkout** / a clean `npm ci` before blaming the change (jimp resolves fine in CI). |
| leave the 113 husks a black box before deleting | — (AI proved safety) | Always gate a bulk `--write` on: registered-worktree cross-check + "husks are pure residue" assertion + dry-run first. |

The session needed almost no human redirection — the two prompts were both forward moves. The *implicit* quality bar the AI held itself to (evidence-first root cause, faithful RED, proven-safe bulk delete, CI-as-authoritative-gate) is the reusable discipline.

## 6. Skills, tools & memory created — and why they're effective

No new skill was created, but the session leaned on and extended several project skills:

- **`openspec-apply-change`** — drove select→read→TDD→tasks. Reusable for any spec-driven change.
- **`ship-it` / `ship-change`** — the two-word ship pipeline. Encodes reality-check→verify→archive→PR→CI→merge→worktree-remove so a single prompt lands a change.
- **`scripts/prune-orphan-worktrees.ts`** (new artifact) — a reusable, idempotent, dry-run-by-default husk cleaner. Invoke it whenever `git worktree list` count and on-disk `.worktrees/*` count diverge. Effective because it self-verifies safety (excludes registered worktrees) before any deletion.

*Recommended memory to save:* "worktree-local test failures (jimp/image-fit) are environmental — verify against main checkout / clean `npm ci` before treating as a regression; CI is the authoritative gate."

## 7. Pitfalls & dead ends

- **Spurious-green RED test:** a regression test that exercises the *cached* store won't reproduce a husk (no fresh `mkdirSync`). Force a cache-miss / fresh `getKb` to hit the real vector.
- **No server→extension "cwd removed" event exists** in pi's `ExtensionAPI`. Don't hunt for one — self-detect the vanished `cwd` on the reindex tick instead.
- **Worktree-local dependency artifacts look like regressions:** the worktree's `node_modules` mis-resolved jimp → 11–17 image-fit failures that **do not exist** in the main checkout (29/29 pass). Isolate by stashing your changes and re-running the affected files on the clean base, or trust CI's clean `npm ci`.
- **`gh pr merge --delete-branch` fails the local checkout step** when `develop` is checked out in the main worktree — the remote merge still succeeds; delete the remote branch separately and verify `MERGED` via the API.
- **Your shell cwd can be the directory you just removed:** after `git worktree remove`, re-anchor to the main repo (explicit `cwd`) before running further commands.
- **Backticks in a `gh pr create` heredoc break the shell** — write the PR body to a file (`/tmp/pr-body-*.md`) and pass `--body-file`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a well-scoped OpenSpec change with evidence in the proposal; `gh` authenticated; ability to run the docker/vitest suites.

- [ ] `/skill:openspec-apply-change <change-name>`
- [ ] Reproduce the bug in a throwaway `/tmp` repo; confirm the exact mechanism.
- [ ] Write a RED test against the *real* vector (force cache-miss / fresh construction).
- [ ] Fix at source (extension self-heal) + belt-and-suspenders (guarded server sweep).
- [ ] One-shot cleanup script: dry-run → prove safety (registered-worktree cross-check, pure-residue assertion) → `--write` → idempotent re-run = 0.
- [ ] Update nearest `AGENTS.md` rows (caveman style, direct edits for source-tree).
- [ ] Reason through discipline checkpoints (security-hardening, doubt-driven-review).
- [ ] `ship-it` → verify gate → isolate any worktree-local failures vs main checkout → archive+sync → PR against `develop` → CI green → clear CodeRabbit → squash-merge → remove worktree (dogfood the sweep).

**Artifacts produced:** `scripts/prune-orphan-worktrees.ts`; edits to `packages/kb-extension/src/reindex.ts` (+ `extension.ts`, tests), `packages/server/src/git-operations.ts` (+ lifecycle tests); `.pi/skills/ship-change/SKILL.md` sweep step; AGENTS.md rows; **PR #308 squash-merged to `develop` (`ce84be4`)**.

---

_Generated from session `019f5cb1-f7a7-7893-a903-5ca9007045d5` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-sweep-worktree-residual-on-remove` · 2026-07-13. Source extract: session facts sheet._
