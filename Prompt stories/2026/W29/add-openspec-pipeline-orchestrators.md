---
session: 019f5be8
week: 2026/W29
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-openspec-pipeline-orchestrators]
proposal_excerpt: "Landing an OpenSpec change today is a manual relay: draft artifacts, remember to run `doubt-driven-review`, remember to run `scenario-design`, hand-fold its catalog into `tasks.md`, `openspec-apply`, hand-run e2e, the…"
---

# How we did it: add-openspec-pipeline-orchestrators — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The first prompt was a single skill invocation: `/skill:openspec-apply-change add-openspec-pipeline-orchestrators`. The literal ask was "implement the tasks of this OpenSpec change." The *real* objective (clear once the change's own proposal is read) was to **turn the manual OpenSpec relay into two orchestrator skills** — `plan-proposal` (develop-side: scaffold → doubt-driven-review → scenario-design → category-routed fold into `tasks.md`, stop at the worktree boundary) and `ship-it` (worktree-side: filesystem-reality gate → verify → manifest-aware defer → drive `ship-change` inline). It was a **skills/workflow change, no production code**: 26 tasks across schema edits, two new TDD'd pure-logic helpers, two new SKILL.md files, and edits to `scenario-design` + `ship-change`. The second prompt — `ship-it` — then asked the AI to dogfood the very orchestrator it had just built to land the change itself.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — the AI reads `openspec status`, the proposal, tasks.md, and every context file **before** touching anything.
2. Let it enumerate tasks (here 26) and group them into sections; implement in task order.
3. For pure-logic helpers, **TDD**: write `scripts/__tests__/*.test.mjs` first, run `npx vitest run --project scripts` to confirm RED, then write `.pi/skills/<skill>/scripts/*.ts` to green.
4. Typecheck new modules: `npx tsc --noEmit --strict --skipLibCheck --moduleResolution bundler ...`; lint with `npx biome check --write`.
5. Update the directory `AGENTS.md` tree rows for every new/changed file (and sidecar `.AGENTS.md` for >200-char rows).
6. Mark automated tasks `[x]`; leave `manual-only` tasks for post-merge defer. Verify `openspec status` parses cleanly.
7. `ship-it` — filesystem-reality gate (test files exist) → full `npm test` + `npm run build` verify gate → drive `ship-change` inline (archive+sync specs → commit → push → PR → watch CI → address CodeRabbit → loop → squash-merge → delete branch → remove worktree).
8. When local `npm test` goes red on a package you didn't touch, **prove it's pre-existing/env-only** (diff vs develop = 0, CI green) before proceeding or fixing.

## 3. How the collaboration unfolded

**Phase 1 — Discovery.** The AI ran `openspec status`, read the proposal + tasks.md + every context file, and inspected the existing `scenario-design`, `ship-change`, harness state-file format, and `scripts/__tests__` conventions. *Why it worked:* it found the repo's established pattern (helper `.ts` in `.pi/skills/<skill>/scripts/`, tests in `scripts/__tests__/*.test.mjs`) and matched it instead of inventing structure.

**Phase 2 — Implement in task order.** §1 schema (`disposition` column: `automated`|`manual-only`), §2+§6 TDD helpers (`manifest.ts`, `no-weakening.ts`, 25 unit tests), §3 `plan-proposal/SKILL.md`, §4 `ship-it/SKILL.md`, §5 `ship-change` edits. Decision point: box-drawing chars in the schema didn't match on edit — the AI read the exact bytes rather than guessing.

**Phase 3 — House-keeping gates.** Ran the full scripts project (98 pass), confirmed the `skill-frontmatter` test validated its new SKILL.md frontmatter, updated `AGENTS.md` tree rows + sidecars, ran the Biome code-quality gate (fixed import order, extracted a row-parse helper for a complexity warning).

**Phase 4 — Dogfood `ship-it`.** The user's `ship-it` prompt kicked off the orchestrator on its own change. Verify gate hit **17 red** image-fit tests. Decision point: the AI surfaced "proceeding past red local `npm test`" as a non-trivial decision rather than silently pushing — the human said fix the env first.

**Phase 5 — Ship.** Archived + synced specs (2 new capabilities), committed via a message *file* (backtick-safe), pushed, opened PR #306. CI didn't start (conflict DIRTY) → merged develop → re-verified → CI green + CodeRabbit → applied fixes over 3 rounds → squash-merged (`6f0a5931`) → deleted remote branch → removed the worktree via the dashboard endpoint.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-openspec-pipeline-orchestrators`. Effective because the change already carried a complete spec (proposal + 26 tasks + context files); the skill invocation let the AI self-orient with zero extra prose. *For a weaker starting point, add:* "read the proposal and all context files first, implement in task order, TDD the pure-logic helpers."
- **High-leverage follow-up** — `ship-it`. One word triggered the entire land-the-change pipeline. Effective only *because* the orchestrator skill existed to give it meaning; without it, you'd need the full "archive, commit, push, open PR, watch CI, address review, merge, clean up" list.
- **Implicit steering** — when the AI paused at the red suite, the human's "fix the env first" (reconstructed) redirected it from "document + proceed" to "make it actually green." Strong because it enforced a real quality bar over a plausible rationalization.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Want to proceed past a red `npm test` after proving it was pre-existing/unrelated | Insist on fixing the local env green first, not just documenting it away | State up front: "local suite must be green before push, even for unrelated packages" |
| Treat a stalled CI as a queue delay | (self-corrected) inspect `mergeStateStatus` and find `DIRTY`/`CONFLICTING` blocking CI | Check PR mergeability *before* waiting on CI |
| Risk backtick/heredoc breakage in commit + PR bodies | Write messages to `/tmp/*.txt` files and pass with `-F` | Always route multi-line git/PR bodies through a file |
| Leave archived-doc + living-spec placeholders (`TBD`, stale `[manual-only]` tag) | CodeRabbit flagged the contradiction; AI fixed only the *new* files, left pre-existing ASCII untouched | Fill spec Purpose lines during archive; keep edits surgical to changed files |

## 6. Skills, tools & memory created — and why they're effective

- **`plan-proposal` SKILL.md** (new) — develop-side planning orchestrator. Chains scaffold → doubt-driven-review → scenario-design → category-routed fold into `tasks.md`, then STOPS at the git-worktree boundary for the human checkpoint. Removes the "remember to run X, then Y, then hand-fold" relay. Invoke on "plan this change / draft the proposal and plan."
- **`ship-it` SKILL.md** (new) — worktree-side implementation orchestrator. Idempotent: gates automated scenarios on **filesystem reality** (test file exists + passes), not the tasks.md checkbox. Owns the red-test fix loop and drives `ship-change` inline with a manifest-aware defer. Invoke on "ship it / build and ship this change."
- **`manifest.ts` + `no-weakening.ts`** (new, TDD'd) — pure-logic helpers: `parseManifest`, `deferDecision` (manifest-aware + legacy-keyword fallback), `filesystemRealityCheck`, `assertNoWeakening` (rejects `.only`/skip/deletion/matcher-weakening). Effective because they make the orchestrator's judgments **testable in L1 units** — no docker harness needed.
- **`scenario-design` manifest change** — added a mandatory `disposition` column so the manifest, not a tasks.md tag, is the single source of truth for automated-vs-manual. Also fixed a stale `:18000` → dynamic harness port from `.pi-test-harness.json`.

## 7. Pitfalls & dead ends

- **`jimp` version mismatch in a worktree.** Worktree `node_modules/` held only `.vite` caches; it resolved deps upward to the parent repo's stale hoisted `jimp@0.16.13`, but `image-fit` needs its nested `jimp@1.6.1` (v1 constructor API). CI was unaffected (clean `npm ci`). Fix: `npm install` in the *parent* to restore the nested copy, then symlink the worktree's `packages/image-fit-extension/node_modules/jimp` → the parent's nested `1.6.1`. Scoped — only image-fit sees v1.
- **CI never starts → suspect a merge conflict, not a queue.** `mergeStateStatus: DIRTY` / `mergeable: CONFLICTING` blocks CI. Fetch + merge `origin/develop`, resolve, re-verify, push.
- **AGENTS.md tree-file conflict on merge.** Trivial — take develop's side, re-apply your rows, grep for leftover `<<<<<<<`/`>>>>>>>` markers before committing.
- **`gh pr merge` errors on the local `develop` update** when develop is checked out in the parent worktree — but the *API merge still lands*. Verify PR state (`MERGED`) before assuming failure.
- **Can't remove the worktree from inside it.** The session runs *in* the worktree; use the dashboard's force-remove endpoint (returns `removed: true`) instead of `git worktree remove`.
- **`grep -c '^ FAIL '` returning 0 exits 1** — that's success (zero failures), not an error.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <change>` — read proposal + tasks + context files first.
- [ ] Implement in task order; TDD pure-logic helpers (RED → green via `npx vitest run --project scripts`).
- [ ] `npx tsc --noEmit --strict` + `npx biome check --write` on new `.ts`.
- [ ] Update directory `AGENTS.md` rows + sidecars for every changed file.
- [ ] Mark automated tasks `[x]`; leave `manual-only` for defer; confirm `openspec status` parses.
- [ ] `ship-it` — verify gate (`npm test` + `npm run build`) must be **green** (fix env before push).
- [ ] Route commit/PR bodies through `/tmp/*.txt` files.
- [ ] Check PR `mergeStateStatus` before waiting on CI; merge develop if DIRTY.
- [ ] Loop CI + CodeRabbit until green + 0 actionable threads; squash-merge; delete branch; remove worktree via dashboard endpoint.

**Key inputs to have ready:** a complete OpenSpec change (proposal + tasks.md + context files), a clean git worktree, `gh` auth, a running dashboard on :8000 (for worktree removal).

**Final artifacts produced:** `.pi/skills/plan-proposal/SKILL.md`, `.pi/skills/ship-it/SKILL.md` (+ `scripts/manifest.ts`, `scripts/no-weakening.ts`), `scripts/__tests__/ship-it-{manifest,no-weakening}.test.mjs`, `scenario-design` + `ship-change` edits, specs `plan-proposal-orchestrator` + `ship-it-orchestrator`. Shipped as PR #306 → `develop` (`6f0a5931`).

---

_Generated from session `019f5be8-cd55-76b1-97a0-ac24dfde18b5` · `pi-agent-dashboard` · 2026-07-13. Source extract: `/tmp/facts-1784847438-67857.md`._
