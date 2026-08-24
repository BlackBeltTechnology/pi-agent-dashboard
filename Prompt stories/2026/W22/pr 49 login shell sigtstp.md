---
session: 019e7a6d
week: 2026/W22
type: planning
model: "@fast"
premium: true
premium_reason: "yes — heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [document-login-shell-non-interactive-fix, replace-wmic-with-powershell]
proposal_excerpt: "Commit `c6cc2d33` (\"fix: remove -i flag from whichViaLoginShell to prevent SIGTSTP\") changed `whichViaLoginShell()` in `packages/shared/src/platform/binary-lookup.ts` from `$SHELL -ilc \"which <cmd>\"` to `$SHELL -lc \"w…"
---

# How we did it: Land a one-char SIGTSTP fix with a documented invariant — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was terse:

> "rebase to develop. Check this fix in the current environment how suitable is. Create proposal for code to be documented"

The *real* objective, once steering clarified it: take an external contributor's PR (#49 on a fork — `tpatzig/pi-agent-dashboard:fix/login-shell-sigtstp`) that flips `whichViaLoginShell()` from `$SHELL -ilc` to `$SHELL -lc`, rebase it cleanly onto `develop`, **validate the fix is sound**, then *harden it so it can't silently regress*: lock the "no interactive shell" rule with a code invariant comment + a strengthened test, propagate the rationale into all stale docs via an OpenSpec change, archive/sync the spec, push to the fork's PR branch, and squash-merge once CI is green. A tiny diff turned into a durable, self-defending invariant.

## 2. TL;DR playbook

1. **Rebase + assess first, don't edit.** `git rebase origin/develop`, then `git show <sha>` the fix and `npm test` the affected package. Confirm the diff is minimal and tests pass *before* proposing anything.
2. **Grep for blast radius.** `grep -rn "\-ilc\|\-lc " packages/ --include="*.ts"` to prove there's exactly one call site, then `grep -rni "login.shell\|SIGTSTP\|-ilc" docs/ README.md` to find every stale doc reference.
3. **Deconflict against sibling PRs.** Before scaffolding, diff file-paths + capabilities against any open PR the user names (here PR #60) and state the intersection is ∅.
4. **Scaffold an OpenSpec change** for the documentation/invariant work: `openspec change new <name>`, then write `proposal.md`, `tasks.md`, and a `specs/<capability>/spec.md` delta.
5. **Apply the change**: add a JSDoc invariant comment above the function (the `-l` required / `-i` forbidden rule + `tcsetpgrp`/`SIGTSTP` rationale), and add a negative-assertion test (`expect(capturedCmd).not.toMatch(/-i\b|-il\b|-ilc\b/)`).
6. **Delegate doc edits to a subagent** in caveman style (AGENTS.md Rule 6) — never edit `docs/` prose directly from the main agent.
7. **Validate + archive**: `openspec validate --strict`, fix the delta op (`MODIFIED` → `ADDED` when no matching requirement exists in main spec), then `openspec archive <name> --yes` to sync into the main spec.
8. **Push to the fork PR + squash-merge**: add the contributor's fork as a remote, `git push --force-with-lease=<branch>:<fetched-sha> <fork> HEAD:<branch>`, wait for CI, then `gh pr merge --squash`. Clean up the worktree, branch, and temporary remote.

## 3. How the collaboration unfolded

**Phase 1 — Rebase & suitability triage.** The AI rebased onto `develop` (clean, single commit), ran the package test (17/17 green), and grepped to prove `-ilc` was gone from all sources with one canonical spawn site (`binary-lookup.ts:601`, called from `ToolResolver.resolveSystemTool`). *Why it worked:* it grounded the "is this suitable?" verdict in evidence — minimal diff, single call site, green tests, correct root cause (`-i` → `tcsetpgrp()` grabs the tty foreground group → parent pi gets `SIGTSTP` on shell exit; `-l` alone still sources `~/.zprofile` for nvm/volta/homebrew PATH). It also flagged the one gap: 4 stale `-ilc` doc references.

**Phase 2 — Deconfliction (human decision point).** The human asked whether this overlapped PR #60. The AI produced a file-path × capability table proving disjointness (`binary-lookup` vs `headless-spawn`/`rpc-keeper-sidecar`), concluding both land cleanly in either order. *Why it worked:* a crisp ∅-intersection answer let the human proceed without merge anxiety.

**Phase 3 — Scaffold + apply the OpenSpec change.** Driven by `/skill:openspec-apply-change`. The AI added the invariant JSDoc, strengthened the test with a command-capture negative assertion, delegated the three doc edits to a `general-purpose` subagent (caveman style), and ran the full suite (**6819 passed / 19 skipped / 0 failed**). *Why it worked:* the test now *mechanically* forbids re-adding `-i`, so a future "improvement" fails CI instead of shipping a regression.

**Phase 4 — Archive + spec sync.** Driven by `/skill:openspec-archive-change`. The AI caught that the delta was marked `MODIFIED` but no matching requirement existed in the main spec, fixed it to `ADDED` before archiving, then archived + synced (+1 requirement at `dashboard-server/spec.md:504`). *Why it worked:* fixing the op *before* archive made the sync land cleanly in one pass.

**Phase 5 — Push to fork + merge.** PR #49 lived on a fork. The AI added `tpatzig` as a remote, force-pushed *with a lease keyed to the fetched SHA* (safe), confirmed 11 green checks, read `develop` history to infer the repo's **squash-merge** convention, merged, and cleaned up (worktree removed, branch deleted, temp remote dropped). The human drove each transition with one-word prompts ("commit and push", "CI ok", "ok", "merge PR and cleanup").

## 4. Prompts that worked

- **The goal prompt** (`"rebase to develop. Check this fix … how suitable is. Create proposal …"`) — effective because it separated three phases (rebase → assess → document) and asked for a *suitability judgement*, not a blind edit. A stronger version: *"Rebase PR #49 onto develop, assess whether the -ilc→-lc fix is sound (single call site? tests green? root cause correct?), and scaffold an OpenSpec change to document the invariant and fix stale docs."*
- **`"Is any overlap with <PR #60 URL>?"`** — high-leverage: forced an explicit deconfliction table before any risky scaffolding.
- **One-word drivers** (`"commit and push"`, `"CI ok"`, `"ok"`, `"merge PR and cleanup"`) — these worked *because Phases 1–4 had already established full context and a verified state*; the human could ratchet each git transition with minimal typing.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the task as "just rebase + edit" | "Check … how suitable is. Create proposal" | State up front that external fixes get a *suitability verdict + an OpenSpec documentation change*, not a silent edit |
| Not proactively check sibling-PR collisions | "Is any overlap with PR #60?" | Ask the AI to diff against open PRs whenever landing onto a shared `develop` |
| Advance the workflow only when prompted | `/skill:openspec-apply-change`, then `/skill:openspec-archive-change` | Chain the openspec skills in the plan so apply→archive runs without re-prompting |
| Pause after each git step | "commit and push", "merge PR and cleanup" | Pre-authorize the git tail (commit → push → merge → cleanup) once CI is defined as the gate |

Quality bars the human implicitly imposed: minimal/surgical diff, evidence-backed suitability, no stale docs left behind, and repo-convention-correct merge (squash).

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode existing rails:

- **`/skill:openspec-apply-change`** — captured the apply loop (invariant comment → strengthened test → delegated doc edits → validate). Invoke when an OpenSpec change is scaffolded and ready to implement.
- **`/skill:openspec-archive-change`** — captured validate-strict → fix delta op → archive → sync. Invoke once tasks are complete to land the requirement in the main spec.
- **`general-purpose` / `Explore` subagents** — used for the caveman-style `docs/` edits, honoring AGENTS.md Rule 6 (main agent never edits `docs/` prose directly).

**Recommended skill to create:** *"harden-and-land-a-fork-PR"* — a reusable procedure for rebase → suitability triage → OpenSpec doc/invariant change → force-with-lease push to a fork PR → squash-merge → worktree cleanup. This session executed it manually across 8 prompts; it's clearly repeatable.

## 7. Pitfalls & dead ends

- **`npm test` MCP call timed out at 120s.** The full suite takes ~442s. *If you hit this, do:* run via Bash with a real timeout instead of the 120s-capped MCP tool.
- **Grep for `-ilc` "regressions" false-positived on the new test.** The remaining `-ilc` matches were the *negative-assertion regex itself* (`/-i\b|-il\b|-ilc\b/`) plus its comment — the invariant mechanism, not a regression. *If you hit this, do:* confirm the matches are in the test's forbidding assertion, not a shell-invocation site.
- **Delta marked `MODIFIED` with no matching main-spec requirement.** Archive-sync would land badly. *If you hit this, do:* change the op to `ADDED` before `openspec archive`.
- **Skill-directory `find` failed** (one bash error) because the openspec skills live outside the worktree's `.pi/skills`. *If you hit this, do:* resolve OpenSpec skills from the main repo root, not the worktree checkout.
- **Force-pushing to someone else's fork.** *Guardrail:* only `--force-with-lease=<branch>:<exact-fetched-sha>` so the push aborts if the fork tip moved since you fetched.

## 8. Reproduce it faster — checklist

Inputs to have ready:
- The PR number + its head repo/branch (may be a **fork** → you'll add it as a remote).
- Write access to `origin`; `gh` authenticated; a clean worktree on the PR branch.

Checklist:
1. `git rebase origin/develop` — confirm clean.
2. `git show <sha>` + `npm test` (via Bash, not the 120s MCP tool) — confirm minimal diff + green.
3. `grep -rn "\-ilc\|\-lc " packages/ --include="*.ts"` (single call site) + `grep -rni "SIGTSTP\|-ilc" docs/ README.md` (stale docs).
4. Deconflict against any named open PR (file-paths × capabilities → ∅).
5. `openspec change new <name>` → write proposal/tasks/spec-delta.
6. Apply: JSDoc invariant + negative-assertion test + **delegate doc edits to a subagent** (caveman style).
7. `openspec validate --strict` → fix delta op (`MODIFIED`→`ADDED`) → `openspec archive <name> --yes`.
8. Commit → add fork remote → `git push --force-with-lease=<branch>:<sha> <fork> HEAD:<branch>` → wait CI → `gh pr merge --squash` → remove worktree/branch/temp-remote.

Final artifacts produced:
- `openspec/changes/document-login-shell-non-interactive-fix/{proposal,tasks}.md` + `specs/dashboard-server/spec.md` (archived to `openspec/changes/archive/2026-05-30-document-login-shell-non-interactive-fix/`).
- Main spec `openspec/specs/dashboard-server/spec.md` (+1 requirement, 503→531 lines).
- `packages/shared/src/platform/binary-lookup.ts` (invariant JSDoc) + `__tests__/binary-lookup.test.ts` (strengthened).
- `docs/faq.md`, `docs/service-bootstrap.md`, `docs/file-index-shared.md` (caveman-style updates).
- PR #49 squash-merged as `568b5121` on `develop`.

---

_Generated from session `019e7a6d-0bce-7bec-a5c5-b8451e7a8032` · `pi-agent-dashboard` · 2026-05-30. Source extract: session-to-guideline facts sheet._
