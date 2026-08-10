---
session: 019e7937
week: 2026/W22
type: documentation
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [server-launch-smoke-suite]
proposal_excerpt: "Change `unify-server-launch-ts-loader` collapsed five duplicate dashboard-server spawn sites into one shared `launchDashboardServer` primitive. Unit coverage is comprehensive (launcher tests, `ToolResolver.resolveJiti…"
---

# How we did it: Is this worktree branch ready to merge? — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened a session inside a stale OpenSpec worktree and, quote,
*"Can you determinate what openspec is related to this worktree?
gate-publish-on-smoke-and-tests"*. That first prompt reads like a lookup, but the
four steering turns reveal the **real** objective: *"Is this branch actually ready to
merge — and if not, get it there."* By the end the AI had identified the archived
change behind the worktree, confirmed the branch's commit history, attached the
session to the proposal in the dashboard, produced a merge-readiness scorecard, and
executed a rebase-onto-`develop` that cleanly resolved four docs/changelog conflicts.

## 2. TL;DR playbook

1. **Map worktree → change.** `ls openspec/changes/` **and** `openspec/changes/archive/`
   — grep the worktree name across both; archived changes are the usual reason a lookup
   "misses".
2. **Read the branch's real position.** `git log --oneline develop..HEAD` (ahead) and
   `git log --oneline HEAD..develop` (behind) — always diff against the **base branch
   (`develop`)**, not `main`/`origin/main`.
3. **Attach the session to the proposal** in the dashboard so the work is labelled — even
   for an archived change (it's a label, not a live workflow trigger).
4. **Produce a merge-readiness scorecard** — ahead/behind counts, PR state
   (`gh pr view … --json state,mergeable`), local-vs-origin sync, working-tree cleanliness.
   Name every blocker before touching anything.
5. **Clean the working tree first.** A stray `package-lock.json` from an accidental
   `npm install`? `git checkout -- package-lock.json` before rebasing — never rebase a
   dirty tree.
6. **Rebase onto `origin/develop`**, then resolve conflicts by *category*: docs/index
   files → take `--ours` (base already absorbed the branch content); `CHANGELOG.md`
   `[Unreleased]` → **keep both** sibling entries.
7. **`git rebase --continue`**, verify no `<<<<<<<` markers remain, and flag CI re-run as
   the final gate.

## 3. How the collaboration unfolded

**Phase A — Discovery (which change is this?).** The AI grepped
`openspec/changes/` for the worktree name, missed, then checked
`openspec/changes/archive/` and found `2026-05-28-gate-publish-on-smoke-and-tests`. It
cross-referenced AGENTS.md to explain what the change did (gate `publish.yml` on
`[ci-checks, smoke]`) and named the still-active sibling `server-launch-smoke-suite`.
*Why it worked:* checking the archive is the non-obvious move — a finished change leaves
its worktree behind but moves the spec.

**Phase B — Branch forensics.** Prompted *"IS there any commit in this branch?"*, the AI
ran `git log develop..HEAD` and reported **2 commits** (the feature + the archive commit),
noting the branch was unpushed/unmerged. *Decision point:* the human implicitly rejected
`main` as the comparison base — the AI's first `origin/main..HEAD` returned nothing useful,
so it pivoted to `develop`.

**Phase C — Attach + readiness verdict.** The AI attached the session to the proposal, then
on *"So is this ready?"* delivered a scorecard: 2 ahead, **42 behind**, PR #43 **CONFLICTING**,
working tree **dirty** (1742-line `package-lock.json`). Verdict: **not ready**, with three
concrete blockers and an offer to fix. *Why it worked:* it refused to say "yes/no" without
evidence and turned the answer into a fix plan.

**Phase D — Execute the rebase.** On *"yes"*, the AI discarded the lockfile, fetched and
rebased onto `origin/develop`, hit four docs/changelog conflicts, and resolved each by
category (indexes → `--ours`; CHANGELOG → keep both), then `rebase --continue`. *Decision
point:* the human's terse "yes" was a full green-light to execute the earlier-stated plan.

## 4. Prompts that worked

- **Goal prompt** — *"determinate what openspec is related to this worktree?"* Good because
  it anchors on the worktree name; strengthen it by stating the end goal up front: **"Which
  OpenSpec change owns this worktree, and is the branch ready to merge into develop?"** —
  that collapses four turns into one.
- **High-leverage follow-up** — *"So is this ready?"* Four words that unlocked the full
  merge-readiness audit. Effective because it forces a verdict + evidence.
- **The unlock** — a bare *"yes"* authorised the whole rebase-and-resolve sequence. Works
  only because the AI had *already laid out the exact plan* in the previous turn; the value
  is in the plan being explicit enough that "yes" is unambiguous.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Look only in `openspec/changes/` (active) | implicitly needing the archive checked | grep active **and** `archive/` for the worktree name in one pass |
| Compare against `main`/`origin/main` (empty result) | needing the answer vs the base branch | always diff `develop..HEAD` / `HEAD..develop` in this repo |
| Answer "ready?" as a lookup | *"So is this ready?"* → demand a real verdict | produce an ahead/behind + PR + working-tree scorecard, never a bare yes/no |
| Risk rebasing a dirty tree | needing the stray lockfile handled first | `git status --short`; discard/commit before any rebase |

The core guardrail: **state readiness as evidence, not opinion**, and **enumerate blockers
as a fix plan** so a one-word "yes" can safely trigger execution.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created in this session. The workflow is **clearly repeatable**,
though — a *"worktree merge-readiness audit"* skill is warranted:

- **What it would capture:** worktree→change mapping (active+archive), base-branch
  ahead/behind, PR mergeability, working-tree cleanliness, and the category-based conflict
  resolution rules (indexes→`--ours`, CHANGELOG→keep-both).
- **Why effective:** it removes the manual, error-prone base-branch guessing and encodes
  the "check the archive" + "clean tree before rebase" reflexes.
- **When to invoke:** any time a session opens inside a `.worktrees/*` checkout and the
  question is "is this ready to merge?".

## 7. Pitfalls & dead ends

- **`origin/main..HEAD` returns nothing** → you're comparing against the wrong base. In this
  repo the base is **`develop`**. Use `develop..HEAD` / `HEAD..develop`.
- **A dirty `package-lock.json` blocks a clean rebase** → it's almost always a stray
  `npm install`. `git checkout -- package-lock.json` unless the change was intentional.
- **The lookup "misses" the change** → it's *archived*. Always grep
  `openspec/changes/archive/` too.
- **Docs/index conflicts look scary but aren't** → `develop` had already absorbed the
  branch's additions into the split index files; taking `--ours` is correct. Only
  `CHANGELOG.md`'s `[Unreleased]` needed a keep-both merge.
- **Attaching an archived proposal is cosmetic** → it labels the session but triggers no
  live spec workflow. Don't expect it to "do" anything.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the worktree name, push access to `origin`, and (for PR state) an
authenticated `gh`.

- [ ] `ls openspec/changes/ openspec/changes/archive/ | grep -i <worktree-name>`
- [ ] `git log --oneline develop..HEAD` (ahead) · `git log --oneline HEAD..develop` (behind)
- [ ] `gh pr view <branch> --json state,mergeable` (PR status)
- [ ] Attach session → proposal in the dashboard (label only)
- [ ] `git status --short` → discard stray `package-lock.json` if present
- [ ] `git fetch origin develop -q && git rebase origin/develop`
- [ ] Resolve: index/docs conflicts → `git checkout --ours`; `CHANGELOG.md` → keep both
- [ ] `git add … && git rebase --continue`; verify no `<<<<<<<` markers
- [ ] Re-run CI on the rebased diff (the `[ci-checks, smoke]` gate) before merging

**Artifacts produced:** rebased `gate-publish-on-smoke-and-tests` branch; merged
`CHANGELOG.md` (`[Unreleased]`, both entries kept); PR #43 conflicts resolved.

---

_Generated from session `019e7937` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-30. Source extract: session facts sheet (mktemp)._
