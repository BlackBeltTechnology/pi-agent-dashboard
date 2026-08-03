---
session: 019f277b
week: 2026/W27
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts); large facts sheet (~12818 tok)"
upgrade_status: pending
openspec_changes: [migrate-file-index-to-agents-tree, project-init-skill-and-profiles, add-markdown-knowledge-base]
proposal_excerpt: "The repo adapted agent0ai/dox (a recursive per-directory `AGENTS.md` tree) but **kept only its philosophy, not its data structure**. `2026-06-23-add-markdown-knowledge-base` §6d shipped the DOX *tooling* (`kb dox init…"
---

# How we did it: Retire the `docs/file-index` splits, make the `AGENTS.md` tree the sole per-file record — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened as a throwaway question — *"Is there any reference to doc-index? Which was migrated"* — immediately corrected to *"I mean file-index"*. What looked like a one-line grep turned into the real objective once the third prompt landed: **remove the `docs/file-index*.md` splits entirely and let the per-directory `AGENTS.md` tree (the "DOX" rollup) be the single source of truth for per-file records.** That flips an already-implemented OpenSpec change from design option **B** (keep the splits as *generated rollups*) to option **A** (retire them). From there the task grew end-to-end: reverse the design decision, delete the machinery + docs, rewrite the protocol prose, update the proposal, then archive and ship the change through a real merge conflict.

## 2. TL;DR playbook

1. **Scope before touching.** Grep live vs. archived references (`rg -l file-index`, bucket by `openspec/archive/**` vs live). Confirm the change being reversed is already implemented so you know you're editing option B → A, not building fresh.
2. **State the reversal explicitly.** Read design §4d, name the exact machinery that implements the losing option (`exportRollup`, `treeRows`, `parseSplit`, `SPLIT_AREAS`, `RollupResult`, sync banner) and the tests that cover it.
3. **Surface the one real open question** (the 5 orphaned `docs/*.md` topic docs that lose their index home) and get an explicit human call before deleting.
4. **Code first, docs second.** Remove rollup machinery from `migrate-runner.ts` by unique line-markers, drop rollup `describe` blocks from the test, delete orphaned imports. Run `vitest run` + `tsc --noEmit` on the `kb` package — green gate before prose.
5. **Delegate every `docs/` write to a subagent** with the caveman-style rule verbatim (Rule 6). Author `docs/AGENTS.md` (topic docs + root config rows), recovering deleted-file purposes from `git show`.
6. **Edit non-`docs/` prose directly** — root `AGENTS.md` protocol, `packages/kb/src/AGENTS.md`, OpenSpec `design.md §4d` + `tasks.md`.
7. **Verify gate:** `openspec validate --strict`, full `kb` suite, `tsc`, `biome check`, and a repo sweep for dangling references to deleted files/exports.
8. **Ship via the `ship-change` skill** — but expect a merge conflict when your deletions collide with develop's edits to the same splits. **Re-home develop's new rows into the tree** rather than dropping them.

## 3. How the collaboration unfolded

**Phase A — Discovery (the mangled-grep detour).** The first answer was a clean "essentially no `doc-index`; the thing being migrated is `file-index`." Then the AI got bitten three times by ripgrep's `-r` (replace) flag — `file-index` rendered as `n`/`l` in output. It caught the self-inflicted mangling, switched to `rg -l` file-level queries, and produced a clean bucket table (244 archived / 36 live openspec / 11 splits / 9 migration code). *Why it worked:* the AI classified references by lifecycle (frozen vs. live) instead of treating all 314 hits as stale.

**Phase B — Decision reversal.** Prompt 3 ("remove file-indexes, rollup be the DOX AGENT.md") reversed design §4d. The AI refused to touch anything until it had scoped the full blast radius — machinery, tests, prose, spec — and flagged the single genuine open question (5 orphaned topic docs). The human picked "option 1", and only then did editing start.

**Phase C — Surgical removal + green gate.** Code changes landed first (machinery + orphaned imports + rollup tests), verified with `vitest`/`tsc` before any prose moved. Then `docs/AGENTS.md` was authored **through a subagent** per Rule 6, recovering purposes from `git show` of the just-deleted splits. Root `AGENTS.md` (15 passages), `faq.md`, and 5 `.pi/skills` references were repointed.

**Phase D — Proposal + seed-doctrine comparison.** "update proposal and commit" → conventional-commit `0b08b4db4`. Then a subtle steering turn: compare against the *seed* `AGENTS.md` doctrine. The AI discovered there is **no seed file on disk** — the doctrine is spec-only in an unapplied change (`project-init-skill-and-profiles`), checked develop to be sure it wasn't just missing from the worktree, and correctly deferred rather than inventing a file. The human said "I'll do it later."

**Phase E — Ship + conflict re-homing.** "archive proposal and use ship-change skill" triggered the full ship pipeline. The verify gate went red with 18 failures — the AI proved they were **environmental** (empty worktree `node_modules` resolving stale jimp 0.16 from the parent; a host-path env-leak), confirmed develop's CI was green, ran `npm install`, and got to 1 known-CI-passing failure. Then the predicted merge conflict hit: develop's `add-kb-folder-slot` change had documented brand-new code **in the very splits being deleted**. The AI re-homed every authored row into the tree (4 new `kb-plugin/**/AGENTS.md` nodes, 6 docker fixture rows, 1 e2e row, 3 modified rows) so no documentation was lost. PR **#220** squash-merged as `e20cd5aed`; worktree removed (which killed the session's own cwd).

## 4. Prompts that worked

- **The goal prompt** (`Is there any reference to doc-index? Which was migrated`) was weak — wrong term, no objective. It only became useful after two corrections. **Stronger kickoff:** *"Reverse design §4d of `migrate-file-index-to-agents-tree` from option B (keep splits as generated rollups) to option A (retire the splits; the AGENTS.md tree is the sole per-file record). Scope the machinery, tests, prose, and spec first, then flag any orphaned docs before deleting."*
- **High-leverage follow-up:** `I would like to remove file-indexes and the rollup be the DOX AGENT.md` — one sentence that reversed an implemented design decision. Effective because it named the target end-state (tree = rollup), not the mechanism.
- **High-leverage follow-up:** `archive proposal and use ship-change skill` — delegated the entire land pipeline to a known skill, letting the AI drive gate → archive → PR → conflict-resolve → merge autonomously.
- **Quality-bar steering:** `The seed cannot contain pi-dashboard project specific instructions` — a single constraint that scoped the whole doctrine-sync comparison.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Answer the literal question (`doc-index`) | "I mean file-index" | Confirm the exact identifier before grepping; restate the target term back |
| Treat the design as fixed (option B was implemented) | "remove file-indexes, rollup be the DOX AGENT.md" | State reversals as end-states ("tree is sole source of truth"), not diffs |
| Risk losing the proposal record after code changes | "update proposal and commit" | Update `proposal.md`/`design.md`/`tasks.md` in the same pass as the code, not after |
| Assume the seed doctrine was a real file | "compare this AGENTS.md… seed cannot contain project-specific instructions" | Check disk + develop before diffing; defer cleanly when the target is spec-only |
| Want to keep pushing the seed-sync work | "Okay, I will do it later" | Capture the deferred analysis inline, stop, don't scope-creep |
| Silently override a red ship gate | (AI self-stopped) "never push a red gate" | Prove red is environmental with CI evidence before proceeding; get the call |

The pivotal scope-expansion: at merge time, develop had documented **new code inside the files being deleted**. The correct move was *re-home, not drop* — the AI paused for the human's call before folding 14 authored rows into the tree.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session, but three existing skills carried the work and are the reusable levers:

- **`ship-change`** — drove archive → verify gate → PR → CI watch → squash-merge. Effective because it encodes the "never push a red gate" guardrail that forced the environmental-failure investigation instead of a blind push.
- **The Rule-6 subagent delegation** for every `docs/` write (caveman style, verbatim rule) — kept prose consistent and out of the main agent's hands.
- **`kb dox` tree + `git show` recovery** — the pattern of recovering deleted-file purposes from git to rebuild an index node.

**Skill worth creating:** a `reverse-openspec-design-decision` procedure — scope machinery+tests+prose+spec for the losing option, flag orphans, get the call, then remove-code-first / prose-second with a green gate between. This session executed it ad hoc; it's clearly repeatable.

## 7. Pitfalls & dead ends

- **ripgrep `-r` is replace, not recursive.** `rg -r 'file-index'` rewrote matches to `n`/`l` in output and mangled three separate queries. Use `rg -l` / plain `rg -n`; `rg` recurses by default.
- **Empty worktree `node_modules` resolves stale parent deps.** 17 failures were jimp `0.16` (parent) vs. required `1.6` — fixed by `npm install` in the worktree, not a code change. Always `npm install` a fresh worktree before trusting a red gate.
- **Host-path env-leak in tests.** `resolveExecutor("npm")` picked up a real `~/.pi-dashboard/node` path on this machine; passes on clean CI. Verify against `gh run` (develop green) before treating a local failure as a regression.
- **Deleting files that a parallel change edits = guaranteed modify/delete conflict.** develop's `add-kb-folder-slot` touched the same splits. Anticipate it, and re-home the other change's rows into the tree so its documentation survives.
- **`over-threshold` (30 KB) AGENTS.md cap is not wired into CI.** `packages/server/src/AGENTS.md` was already ~50 KB (pre-existing debt) — noted, left out of scope.
- **Removing a worktree kills the session's own cwd.** The final `--force` worktree removal destroyed the Bash tool's working directory mid-command; one local-branch `-D` cleanup couldn't finish. Do worktree removal last, and from the parent repo.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name + its `design.md` decision section; a clean worktree with `npm install` already run; `gh` authenticated.

- [ ] `rg -l file-index` → bucket live vs. `openspec/archive/**`; confirm the change is already implemented (reversing B→A).
- [ ] Read `design.md §4d`; list the machinery + tests for the losing option; flag orphaned docs; **get the human's call**.
- [ ] Remove code (machinery, orphaned imports, rollup tests) → `vitest run` + `tsc --noEmit` on the package = green before prose.
- [ ] Author `docs/AGENTS.md` **via a Rule-6 subagent**, recovering purposes from `git show` of deleted files.
- [ ] Edit non-`docs/` prose directly (root `AGENTS.md`, `packages/**/AGENTS.md`, `design.md`, `tasks.md`, `proposal.md`).
- [ ] Verify: `openspec validate --strict`, full package suite, `tsc`, `biome check`, dangling-reference sweep.
- [ ] `ship-change`: if the gate is red, prove it environmental via `gh run` before proceeding; at merge, **re-home** a colliding change's rows into the tree.
- [ ] Worktree removal **last**, from the parent repo.

**Final artifacts:** PR #220 squash-merged as `e20cd5aed`; 11 splits deleted; `docs/AGENTS.md` created; rollup machinery removed from `packages/kb/src/migrate-runner.ts`; `dox-source-tree-migration` spec archived to `openspec/specs/`.

---

_Generated from session `019f277b-fde9-7cc3-b656-61c8f215b649` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-03. Source extract: `/tmp/facts-019f277b.md`._
