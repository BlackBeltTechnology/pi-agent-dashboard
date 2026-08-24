---
session: 019f103c
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-darwin-dmg-maker-macos-alias]
proposal_excerpt: "Local `electron-forge make` invocations on macOS (arm64 native) fail in the DMG-maker step with `Cannot find module '../build/Release/volume.node'` from the transitive `macos-alias` native module pulled in by `appdmg`…"
---

# How we did it: Fix the macOS DMG-maker `volume.node` crash — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a *trust-but-verify* framing: **"Current proposal is:
fix-darwin-dmg-maker-macos-alias. The code improved a lot from the proposal. Validate."**
The real objective, once the session unfolded, was not just validation — it was to take
a written-but-unbuilt OpenSpec change all the way to a merged PR: implement the
`macos-alias`/`volume.node` self-heal, add a Doctor diagnostic, wire a build-time gate,
document it, and land it on `develop` through the full ship pipeline. The first prompt's
premise ("the code improved a lot") turned out to be **false** — zero code existed on the
branch — so the AI's first job was to disprove the premise honestly before building.

## 2. TL;DR playbook

1. **Ask for validation first, not implementation.** "Validate that <change> is
   implemented" forces an evidence pass (`git status`, `git log main..HEAD`, existence
   checks per task) before any code is written.
2. When validation shows **nothing is built**, pivot with `/skill:openspec-apply-change
   <change>` — the apply skill drives spec-first, TDD implementation task-by-task.
3. **Write the Doctor predicate test first** (TDD), run it with an ephemeral
   `HOME=$(mktemp -d)` so pi's real config never pollutes the run.
4. **Smoke-test native self-heal on the real host** — a darwin-only `.mjs` that
   `require.resolve`s the module and `npm rebuild`s `volume.node`. Prove it produces the
   artifact, don't just assert.
5. **Delegate every `docs/` write to a subagent** with the caveman-style rule verbatim
   (repo docs protocol). Main agent never edits `docs/` directly.
6. **Ship with `/skill:ship-change`**: verify gate → push → PR against `develop` →
   watch CI → CodeRabbit loop → squash-merge → remove worktree.
7. When CI fails on a file **your change never touched**, suspect a **stale branch** —
   merge `develop` in; if the failure persists it's an *inherited* red test, fix the
   hardcoded count and move on.
8. Treat a green **"CodeRabbit pass"** check as suspect — fetch the actual review
   ("Actionable comments posted: N") before merging; a rate-limited ACK looks identical.

## 3. How the collaboration unfolded

**Phase 1 · Validate (disprove the premise).** The AI ran `git status`, `git diff --stat
main`, `git log main..HEAD`, and per-task existence checks. It produced a crisp
task-by-task table showing all 13 tasks unbuilt, the tree clean, and the large diff-vs-main
as *unrelated drift*. It refused to accept "the code improved a lot" without evidence —
the single most valuable move of the session.

**Phase 2 · Apply (TDD implementation).** Driven by `openspec-apply-change`. Order:
(a) `ensure-macos-alias.mjs` self-heal script; (b) Doctor predicate `checkMacosAliasVolume()`
in `doctor-core.ts` **with its test written first**, run under `HOME=$(mktemp -d)`; (c) the
`build-installer.sh` darwin gate (`bash -n` clean); (d) CHANGELOG + docs. The `.mjs` was
**smoke-tested on the real darwin host** — it located `macos-alias`, ran `node-gyp rebuild`,
and produced `volume.node`. All 13/13 doctor tests + the 1185-test shared suite passed.

**Phase 3 · Harden under a degraded gate.** The advisory CodeRabbit gate hit its rate
limit (55-min cooldown) after returning 5 findings whose detail wasn't persisted. Rather
than block, the AI **self-reviewed** and converted the shell-string `execSync(\`...${prefix}...\`)`
to argv-form `spawnSync(shell:false)` — eliminating the injection-shaped finding — then
re-verified self-heal still worked.

**Phase 4 · Archive + spec-sync.** Delta specs carried two new requirements not in the
main `electron-build-pipeline` spec. The AI paused with `ask_user` to confirm the sync,
then delegated the append to a subagent, validated, and archived the change.

**Phase 5 · Ship.** `ship-change`: the worktree had an **empty `node_modules`** (relied on
parent upward-resolution), so the AI honestly refused to call the verify gate green until it
ran `npm install` in the worktree. Down to one **load-sensitive timing** failure
(`elapsed < 3000ms`, got 3468ms) that passed 14/14 in isolation. Pushed, opened PR #187.

**Phase 6 · CI + CodeRabbit loop.** CI failed on `recommended-routes.test.ts`
(`toHaveLength(15)` vs 18) — a file the change never touched. The AI merged `develop`,
found the mismatch **inherited from develop itself** (develop's own CI red on it), derived
the true top-level count (18) from the manifest, and fixed the stale assertion. It then
distrusted the green "CodeRabbit pass" check, fetched the real review (**4 findings: 2 Major,
2 Minor**), applied 3, reasoned-skipped 1, replied on the thread, and squash-merged PR #187
(merge commit `9b9b4256`). Removing the worktree killed the session's own cwd — the expected
terminal state.

## 4. Prompts that worked

- **Goal prompt — "…Validate."** Excellent kickoff *because* it invited disproof. Framing a
  task as "validate X is done" (not "do X") makes the AI gather evidence first and catches a
  false premise before wasted implementation. Stronger still:
  *"Validate that `<change>` is actually implemented on this branch — show me the per-task
  evidence (git status, existence checks) before assuming anything."*
- **`/skill:openspec-apply-change fix-darwin-dmg-maker-macos-alias`** — a high-leverage
  single line that switched from audit mode to spec-first TDD implementation.
- **"yes"** — a one-word unlock that approved the spec-sync-then-archive path at the
  `ask_user` gate. Cheap, decisive.
- **"Use ship-change skill"** — handed the whole land-it pipeline (verify→PR→CI→merge→cleanup)
  to one skill instead of hand-driving each step.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| stop after validating (audit only) | `/skill:openspec-apply-change …` | state up front "validate, then if unbuilt, implement it" |
| pause at the spec-sync decision point | "yes" | pre-authorize: "sync delta specs the recommended way, then archive" |
| finish at "implementation complete" | "Use ship-change skill" | say "implement AND ship to develop" in the goal |

Beyond explicit steering, the AI **self-imposed** the right quality bars: it refused to call
the verify gate green with an un-`npm install`ed worktree, and refused to trust the green
CodeRabbit check without fetching the real review. Encode those as standing rules so they
never depend on luck.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session **consumed** existing repo skills
(`openspec-apply-change`, `ship-change`) and the docs-delegation protocol. Three
`general-purpose` subagents were spawned, each isolating a mechanical docs/spec edit:

- **"Update electron file-index + faq docs"** — offloads caveman-style `docs/` writes so the
  main context stays focused on code; mandated by the repo docs protocol.
- **"Sync electron-build-pipeline delta spec"** — appends the two new requirements verbatim
  into the main spec, keeping the archive step clean.
- **"Merge duplicate docker-make.sh index row"** — a CodeRabbit-flagged index-integrity fix,
  delegated per the same docs protocol.

If anything deserved to become a durable skill it's the **"validate-before-you-build" audit
move** (per-task existence table from `git status`/`git log`/file checks) — worth a small
skill so every "is this change actually implemented?" starts from evidence, not the operator's
claim.

## 7. Pitfalls & dead ends

- **False premise in the ask.** "The code improved a lot" was untrue — nothing was built.
  *If told a change is done, verify with `git status` + per-task existence checks first.*
- **CodeRabbit rate limit / misleading green check.** The gate returned 5 findings then hit a
  55-min cooldown; the in-process script didn't persist detail; a later green "pass" check was
  actually a real 4-finding review. *Always fetch the real review body ("Actionable comments
  posted: N"), never trust the check state alone.*
- **Empty worktree `node_modules`.** The worktree resolved deps upward from the parent, so the
  full suite failed on missing `jsdom`/`sharp` until `npm install` ran locally. *Run
  `npm install` in the worktree before calling any verify gate green.*
- **Inherited stale test from `develop`.** CI red on `recommended-routes.test.ts`
  (`toHaveLength(15)` vs 18) — untouched by the change; develop's own CI carried the mismatch.
  *Merge `develop`, derive the true count from the manifest, fix the assertion — don't chase
  your own diff.*
- **Load-sensitive timing assertion.** A doctor `elapsed < 3000ms` check failed (3468ms) under
  full-suite + `npm install` load but passed 14/14 isolated. *Re-run suspected timing failures
  in isolation before treating them as regressions.*
- **Removing your own worktree kills the session.** The final `git worktree remove` deleted the
  session's cwd; the shell could no longer spawn. *Do local worktree cleanup from a session
  rooted in the parent repo, not from inside the worktree.*

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an OpenSpec change dir (`openspec/changes/<name>/` with
proposal/design/tasks), a darwin arm64 host (for the native smoke test), `gh` authenticated,
and a `.worktrees/<name>` checkout.

- [ ] Validate first: `git status`, `git log main..HEAD`, per-task existence checks → table.
- [ ] `/skill:openspec-apply-change <name>` — implement spec-first, TDD.
- [ ] Doctor predicate test written first; run under `HOME=$(mktemp -d) npx vitest run …`.
- [ ] Smoke-test the native self-heal `.mjs` on the real host (must produce `volume.node`).
- [ ] Use argv-form `spawnSync(shell:false)` for any shell interpolation.
- [ ] Delegate all `docs/` writes to a subagent (caveman-style rule verbatim).
- [ ] Confirm spec-sync at the `ask_user` gate, delegate the append, archive.
- [ ] `npm install` in the worktree before the verify gate.
- [ ] `/skill:ship-change`: push → PR vs `develop` → CI → CodeRabbit → squash-merge.
- [ ] On CI red in an untouched file: merge `develop`, fix the inherited assertion.
- [ ] Fetch the real CodeRabbit review, not the green check; apply/skip with reasons.
- [ ] Clean up the worktree from the **parent** repo session.

**Artifacts produced:** `packages/electron/scripts/ensure-macos-alias.mjs`,
`packages/electron/package.json` (postinstall hook), `packages/electron/scripts/build-installer.sh`
(darwin gate), `packages/shared/src/doctor-core.ts` (`checkMacosAliasVolume`),
`packages/shared/src/__tests__/doctor-macos-alias.test.ts`, CHANGELOG + faq/file-index docs,
synced `openspec/specs/electron-build-pipeline/spec.md`, **merged PR #187** (`9b9b4256`).

---

_Generated from session `019f103c` · `pi-agent-dashboard` · 2026-06-29. Source extract: `/var/folders/qb/m1_q3v6d5bnfzbpmc0dkkqx40000gn/T/session_facts.BML1cHDyKS`._
