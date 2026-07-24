---
session: 019f1613
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts); large facts sheet (~11926 tok)"
upgrade_status: pending
openspec_changes: [modernize-pi-version-handling, restore-pi-version-skew-surface]
---

# How we did it: Rechecking a stale OpenSpec proposal, folding the survivor, and shipping it — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a three-word prompt: **"recheck this proposal with current state"**. The user was sitting on an OpenSpec change (`modernize-pi-version-handling`) that had been drafted a while back and never implemented — and they suspected the codebase had moved on. The *real* objective, which crystallized over the next few steering turns, was: **audit the proposal against reality, keep only the idea that still has value, fold it into the sibling change that was already staged for it, then take that change all the way to a merged PR.** In one arc: recheck → salvage → fold → fast-forward artifacts → implement with TDD → ship.

## 2. TL;DR playbook

1. **Recheck against reality first.** Ask the AI to verify every claim in the stale proposal against current source (grep the actual functions, check installed versions, look at what archived changes already landed). Demand a phase-by-phase verdict table (obsolete / mostly-solved / survives).
2. **Salvage the one surviving idea** and rebase it onto the *current* architecture — don't rewrite the whole proposal in place, map the survivor onto an existing idiom the codebase already uses.
3. **Fold, don't duplicate.** If a sibling change already exists for this area, merge the survivor into it as a new phase and *retire* the stale change (`rm -rf` its dir). Keep the rationale ("why both surfaces belong") in the proposal.
4. **Fast-forward the missing artifacts** with `/skill:openspec-ff-change <name>` (generates design + tasks from the proposal + specs).
5. **Apply with TDD** via `/skill:openspec-apply-change <name>` — read the real integration points, write tests to match existing harness style, implement in dependency order, run tests per group.
6. **Ground every implementation claim in real code** before writing it (grep the interface, read the poll tick, confirm the idiom) — correct the artifacts when reality differs from the spec (e.g. "60s heartbeat" was actually a 30s git-poll tick).
7. **Isolate pre-existing test failures** from your own — run failing tests on `main`/`develop` to prove they're not yours before trusting the gate.
8. **Ship with `use ship-change skill`** — archive + sync specs, commit, PR against `develop`, resolve the inevitable docs merge conflict (keep develop's rows, re-apply yours), watch CI, confirm CodeRabbit clean, squash-merge, clean up worktree last.

## 3. How the collaboration unfolded

**Phase 1 — Recheck (Discovery).** The AI read the stale proposal, then verified each premise against source: `grep`'d for `readCurrentPiVersion`, `_resetVersionSkewCache`, `runPostInstallRepair`; checked the installed pi version (`0.80.2`) vs the proposal's floor-bump target; and cross-referenced archived changes. It produced a phase-by-phase verdict table: floor bump **fully obsolete** (already at 0.78), probe rewrite **mostly solved** by an archived change, cache-invalidation **deleted** entirely by `eliminate-electron-runtime-install`. Only one Phase-2 idea survived. *Why it worked:* the verdict was evidence-backed (real grep output, real version numbers), not a vibe check — so the user could trust "retire most of this" in one glance.

**Phase 2 — Salvage & rebase (Design).** Prompt `2` (the user picking option 2 from a presented choice) told the AI to rewrite down to the surviving idea. Crucially, the AI didn't invent new plumbing — it found that the bridge **already** pushes per-session observations (`git_info_update`, `model_update`, `session_name_update`) that the server stores and re-broadcasts, and mapped "report the pi version each session runs" straight onto that idiom. *Decision point:* grounding the survivor in an existing pattern instead of a speculative design.

**Phase 3 — Fold & retire.** Prompt 3 (**"fold this into restore-pi-version-skew-surface"**) redirected the work into a sibling change that was a deliberate proposal-stage placeholder (its gating 0.75/0.76 bumps had since landed, unblocking it). The AI framed the two surfaces as complementary — a **global advisory** ("is the dashboard's pi recent enough?") and a **per-session label** ("what pi is *this* session running?") — documented *why both belong* (out-of-band `pi update --self` changes a session's pi but not the server's bundled copy), added the spec delta, then `rm -rf`'d the retired change.

**Phase 4 — Fast-forward artifacts.** Prompt 4 (`/skill:openspec-ff-change`) generated `design.md` + `tasks.md`. The AI grounded two implementation facts first (the `BootstrapCompatibility` shape, the current `/api/health` handler) so the tasks were accurate, then removed the now-fulfilled `DEFERRED.md`.

**Phase 5 — Apply (TDD implementation).** Prompt 5 (`/skill:openspec-apply-change`) drove the build. The AI read every real integration point, wrote tests matching the existing Fastify-inject / WS-driven harness style, and implemented in dependency order across 7 groups, running tests per group. It corrected the artifacts mid-flight when reality diverged ("60s heartbeat" → the real 30s `runGitPollTick`).

**Phase 6 — Ship.** Prompt 6 (**"use ship-change skill"**) archived + synced specs, opened PR **#204** against `develop`, resolved a `docs/file-index-client.md` merge conflict, watched CI to green (8m10s), confirmed CodeRabbit `pass` with 0 threads, squash-merged, and removed the worktree — which is what the session was running inside, so it was the deliberate last action.

## 4. Prompts that worked

- **The goal prompt — "recheck this proposal with current state"** — short but perfectly scoped: it names the artifact (the proposal), the action (recheck), and the yardstick (current state). A stronger version bakes in the deliverable: *"Recheck `modernize-pi-version-handling` against current source — give me a phase-by-phase verdict (obsolete / solved / survives) with grep evidence, then recommend what to keep."*
- **"fold this into restore-pi-version-skew-surface"** — a high-leverage redirect: one sentence that avoids a duplicate change and reuses staged work. Effective because it names the exact target.
- **"2"** — a terse pick from a presented menu. Works *only because* the AI had laid out numbered options; the lesson is that the AI should always present choices as a numbered list so the human can steer with a single character.
- **The skill invocations** (`/skill:openspec-ff-change`, `/skill:openspec-apply-change`, `use ship-change skill`) — each handed off a whole phase to a known procedure. High leverage: one line = one complete workflow.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the stale proposal as a to-do list to implement | "recheck … with current state" | Always verify a proposal's premises against live source *before* implementing anything old |
| Rewrite the survivor as a standalone change | "fold this into restore-pi-version-skew-surface" | Check for a sibling/placeholder change covering the area before creating or keeping a separate one |
| Rely on the artifact's wording ("60s heartbeat") | (self-corrected after reading `git-poll.ts`) | State up front: "ground every timing/interval claim in the real code before implementing" |
| Trust a failing full-suite as a blocker | (self-corrected by running tests on `main`) | Require: prove a test failure is *yours* by running it on the base branch first |
| Proceed past irreversible steps silently | ship-change surfaced branch/name mismatch + test-gate for the human's call | Keep the "flag before any irreversible step" gate — push/PR/merge/worktree-removal each get an explicit checkpoint |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — this session was a *consumer* of the existing OpenSpec skill chain (`openspec-ff-change` → `openspec-apply-change` → `ship-change`) plus one `general-purpose` subagent for docs. That chain is the reusable asset: it took a three-word prompt to a merged PR with minimal steering.

**Skill that *should* exist (and is worth codifying): "recheck-stale-proposal."** The opening phase — verify each premise against live source, produce a phase-by-phase verdict table, salvage survivors, fold into a sibling and retire the stale change — is a repeatable, high-value workflow that isn't captured anywhere. It would remove the manual grep-and-compare toil and make "is this old proposal still worth doing?" a one-command answer. Invoke it whenever an OpenSpec change has sat unimplemented while the codebase moved.

## 7. Pitfalls & dead ends

- **Worktree shared-module trap.** In a git worktree, `@blackbelt-technology/pi-dashboard-shared` resolved *up to the main checkout*, so `tsc` didn't see the worktree's `types.ts` edits (runtime tests passed anyway — JS objects don't enforce types). Adding a `node_modules` symlink to fix tsc then caused **dual shared-module instances**, breaking singletons and cascading ~unrelated server-test failures. **Fix:** remove the symlink; accept that tsc-in-worktree has this blind spot, and lean on the CI clean-env run as the source of truth.
- **Pre-existing failures masquerading as yours.** The full suite showed 28 failures (17 `image-fit`/Jimp + heavy server-integration flakes). They **passed in isolation** and failed **identically on `main`**. Don't debug them — prove they're pre-existing and move on.
- **PR `CONFLICTING`/`DIRTY` silently blocks CI.** No CI run appeared until the branch was merged with `origin/develop` and the `docs/file-index-client.md` conflict resolved. If CI "won't start," check mergeability first.
- **`git mv` on an already-deleted file** (`DEFERRED.md`) choked — use a plain `mv` and let `git add -A` capture it.
- **Branch/change-name mismatch.** The worktree branch was `os/modernize-pi-version-handling` but the shipped change was `restore-pi-version-skew-surface` (folded + retired). ship-change expects `os/<change>` — flag it and proceed deliberately.
- **Removing the worktree severs the session.** The session ran *inside* `.worktrees/os-modernize-pi-version-handling`; worktree removal was correctly the final action, and the bash tool dying afterward was the confirmation of success.

## 8. Reproduce it faster — checklist

- [ ] `openspec show <stale-change>` — read the proposal you're rechecking.
- [ ] For each premise: `grep`/read the real function, check installed versions, scan `openspec/changes/archive/` for changes that already landed → build a verdict table.
- [ ] Identify the survivor; find the existing idiom it maps onto (`grep` for sibling `*_update` message patterns).
- [ ] If a sibling/placeholder change exists, fold the survivor in as a new phase + spec delta; `rm -rf` the stale change dir.
- [ ] `/skill:openspec-ff-change <name>` → design + tasks; ground key interface shapes first; drop any fulfilled `DEFERRED.md`.
- [ ] `/skill:openspec-apply-change <name>` → TDD in dependency order; correct artifacts when code contradicts them.
- [ ] Prove any test failure is pre-existing by running it on `main`/`develop` before trusting the gate.
- [ ] `use ship-change skill` → archive + sync specs, PR vs `develop`, resolve docs conflicts (keep base rows + re-apply yours), watch CI green, confirm CodeRabbit clean, squash-merge, remove worktree **last**.

**Inputs to have ready:** a stale OpenSpec change name; write access to the repo + a worktree; `openspec`, `gh`, and the OpenSpec/ship skill chain installed.

**Final artifacts produced:** merged PR **#204** → `develop`; change archived at `openspec/changes/archive/2026-06-30-restore-pi-version-skew-surface/`; two synced specs (`pi-core-version-check`, `bridge-extension`); the global `PiVersionAdvisory` (Settings → General) and per-session pi-version label (`SessionHeader`), backed by a new `pi_version_update` protocol message and 50 passing tests.

---

_Generated from session `019f1613-f092-7138-b3e3-291724d152f6` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-30. Source extract: `/tmp/facts-1784864193.md`._
