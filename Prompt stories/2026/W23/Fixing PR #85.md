---
session: 019e9f1f
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [unify-file-link-openability]
proposal_excerpt: "File references in the dashboard are openable on only one surface — tool *output* bodies (Bash/grep/ctx) rendered through `LinkifiedText` → `FileLink`. Three other surfaces leak:"
---

# How we did it: Fixing CodeRabbit review on PR #85 — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

> "The https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/85 merged, but there was coderabbit suggestions. Fix them"

The real objective, once the terse "commit" / "are you sure?" / "recheck" follow-ups
clarified it: **apply CodeRabbit's actionable inline review comments from an already-merged
PR, land them cleanly on `develop`, and prove — not assume — that the resulting commit
contains exactly the intended files with no WIP contamination.** The twist that dominated
the session was not the code fixes (those were fast) but landing them safely in a `jj`
(jujutsu)-managed repo whose working copy kept re-absorbing unrelated WIP.

## 2. TL;DR playbook

1. Fetch the review as *data*, not prose: `gh api "repos/<owner>/<repo>/pulls/<N>/comments" --paginate` and pretty-print each comment's file/line/body. Don't rely on `gh pr view --comments` alone.
2. Triage every comment into **actionable** vs **false positive**, and write the reason down (you'll defend it in the commit message).
3. Because the PR is already merged, base a **fresh change directly on `develop`** — do not resurrect the PR branch. In `jj`: `jj new develop -m "fix: address CodeRabbit review on PR #<N>"`.
4. Apply the code fixes surgically. Delegate any `docs/` edits to a subagent (project's Documentation Update Protocol).
5. Verify with an **ephemeral HOME**: `HOME=$(mktemp -d) npx vitest run <specs>` and `HOME=$(mktemp -d) npm run lint`. Use the repo's own typecheck script, not raw `tsc --noEmit` (pre-existing project-reference noise).
6. Before pushing, assert the commit's file set: `jj diff -r 'develop..@' --stat` must show **exactly** the intended files. If the parent shifted, `jj rebase -r @ -d develop` to re-base clean.
7. Land as a **fast-forward** onto `develop`: rebase the fix commit onto current `develop@origin`, move the bookmark, `jj git push --bookmark develop`. Confirm origin head via `gh api`.
8. Close the now-redundant follow-up PR with a comment pointing at the landed commit.

## 3. How the collaboration unfolded

**Phase 1 — Read the review as structured data (Discovery).**
The AI pulled the CodeRabbit comments via `gh pr view 85 --comments` *and* the paginated
`gh api .../pulls/85/comments`, then Python-parsed each into file/line/body. Effective
because CodeRabbit's actionable suggestions live in the inline review API, not the PR
conversation — reading only the latter loses them.

**Phase 2 — Triage, including false positives.**
Two comments flagged the openspec change living under an `archive/` path. The AI correctly
identified these as **false positives**: on `develop` the change is legitimately *archived*
at `openspec/changes/archive/2026-06-07-unify-file-link-openability/`, and CodeRabbit's
"don't nest when creating" rule misapplies to an archived change. Decision point: the human
implicitly trusted this by never overriding it, and the reasoning went into the commit message.

**Phase 3 — Base the work correctly (the jj reality check).**
The AI discovered it was in a detached-HEAD-like state with staged WIP, while `origin/develop`
already had the merged PR #85 (`298c0605`). Rather than touch the WIP, it created a fresh
`jj` change on top of `develop`. This is the single most important structural decision:
**don't reopen a merged branch — start from where the code actually is.**

**Phase 4 — Apply fixes + delegate docs.**
Five source/test files edited surgically (Windows `file:///C:/` URI matching, root
preservation, `openEditor` failure fallback, `/api/open-editor` cwd containment for
security, plus new edge/security tests). The two `docs/` edits were delegated to a
`general-purpose` subagent per the Documentation Update Protocol (caveman style + dedup).

**Phase 5 — Verify with ephemeral HOME.**
Tests needed an ephemeral `HOME` to run cleanly (`HOME=$(mktemp -d) npx vitest run …`);
94 tests passed. Raw `tsc --noEmit` surfaced pre-existing project-reference errors — the
AI switched to the repo's own typecheck script and got a clean result. Lint green.

**Phase 6 — Land clean, prove it, don't assume (the long tail).**
This is where the "are you sure?" / "recheck" / "recheck" steering earned its keep. The
`jj` working copy repeatedly re-absorbed unrelated WIP (`elevate-dashboard-add-buttons`,
`separate-workspace-directory-cards`, a markdown mockup) into the fix commit, and the local
bookmark kept drifting ahead of what was pushed. Each recheck, the AI re-verified byte-for-byte
that the pushed commit == PR head == exactly 7 files, rebased when the parent shifted, and
finally — on "commit to develop" — rebased onto the advanced `develop@origin` (`282cbf78`)
and pushed a conflict-free fast-forward to `bc336aa1`. PR #86 was then closed as redundant.

## 4. Prompts that worked

- **Goal prompt** — "PR #85 merged, but there was coderabbit suggestions. Fix them." Good
  because it names the exact PR and the exact source of work (CodeRabbit). To make it even
  stronger, add the landing target up front: *"…fix the actionable ones and land them
  directly on `develop`; skip false positives but justify each in the commit message."*
- **High-leverage follow-up: "are you sure?"** — a two-word prompt that exposed a real
  regression: the working copy had silently re-absorbed WIP into the fix commit. Cheap,
  high-yield. Keep a skeptical "are you sure?" in your pocket for any jj/git landing.
- **"recheck" (×2)** — forced idempotent re-verification. The tell that it was truly settled:
  the recheck returned the *same* green result twice, with only the unrelated local `develop`
  WIP churning.
- **"commit to develop"** — the unlock that ended the PR-branch dance: land the fix as a
  fast-forward on `develop` directly, making the follow-up PR redundant.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Declare "committed and pushed, done" prematurely | "are you sure?" | Always run `jj diff -r 'develop..@' --stat` + compare local head to PR head *before* claiming done |
| Let the jj working copy re-absorb unrelated WIP into the fix commit | "recheck" / "recheck" | Park the working copy off the bookmark (`jj new develop -m "wip: parked"`) so stray files stop landing on the fix |
| Route the fix through a separate PR branch (#86) | "commit to develop" | For a clean descendant of `develop`, fast-forward `develop` directly and skip the PR |
| Treat all CodeRabbit comments as actionable | (AI self-corrected; human didn't override) | Triage archive-path/false-positive comments and record the skip reason in the commit message |
| Run `tsc --noEmit` and trip on pre-existing errors | (AI self-corrected) | Use the repo's own typecheck script; run tests/lint with `HOME=$(mktemp -d)` |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was persisted this session, but one **general-purpose subagent** was
spawned ("Fix file-index dup + architecture caveman style") to handle the `docs/` edits —
correct, because the project's Documentation Update Protocol requires delegating `docs/`
prose writes to a subagent.

**Skill worth creating:** a `jj-land-review-fix` procedure capturing the hard-won moves:
(1) base fixes as a fresh change on `develop`, (2) park the working copy so WIP stops
contaminating the fix commit, (3) assert exact file set with `jj diff -r 'develop..@' --stat`,
(4) rebase-then-fast-forward onto advanced `develop@origin`, (5) confirm origin head via
`gh api`. This session spent most of its 17 minutes re-discovering these; a skill removes
the "are you sure?" loop entirely.

## 7. Pitfalls & dead ends

- **jj working copy re-absorbs WIP.** In this jj repo the fix commit twice picked up
  unrelated staged changes. If you see extra files in `jj diff -r 'develop..@' --stat`,
  `jj rebase -r @ -d develop` and **park the working copy** on a throwaway commit.
- **Local bookmark drifts ahead of origin.** A `*` in `jj bookmark list` means diverged.
  Re-push and re-compare local head to the PR head before trusting it.
- **`origin/develop` moves under you.** It advanced `298c0605 → 282cbf78` mid-session. Always
  re-fetch and rebase onto the *current* `develop@origin` right before the fast-forward push.
- **Tests fail without ephemeral HOME.** Run vitest/lint under `HOME=$(mktemp -d)`.
- **`tsc --noEmit` noise.** Pre-existing project-reference errors are not yours — use the
  repo's typecheck script and grep for your touched files only.
- **CodeRabbit false positives.** Archive-path "don't nest" comments misfire on legitimately
  *archived* openspec changes. Skip, but justify in the commit message.
- **Don't reopen a merged PR branch.** PR #85 was merged; the follow-up branch (#86) became
  redundant once the fix fast-forwarded onto `develop`. Land directly and close the extra PR.

## 8. Reproduce it faster — checklist

- [ ] `gh api "repos/<owner>/<repo>/pulls/<N>/comments" --paginate` → parse file/line/body.
- [ ] Triage actionable vs false-positive; note skip reasons for the commit message.
- [ ] `jj new develop -m "fix: address CodeRabbit review on PR #<N>"` (base on develop, not the merged branch).
- [ ] Apply code fixes surgically; delegate `docs/` edits to a subagent.
- [ ] `HOME=$(mktemp -d) npx vitest run <specs>` + repo typecheck script + `HOME=$(mktemp -d) npm run lint` → all green.
- [ ] `jj diff -r 'develop..@' --stat` shows **exactly** the intended files; rebase if the parent shifted; park the working copy.
- [ ] Rebase fix onto current `develop@origin`; move `develop` bookmark; `jj git push --bookmark develop` (fast-forward).
- [ ] `gh api` confirm origin `develop` head == fix commit; close any redundant follow-up PR.

**Key inputs to have ready:** `gh` auth, the merged PR number, jj installed, an ephemeral
`HOME` for tests/lint.
**Final artifacts:** 7 files landed on `develop` at `bc336aa1` (linkify-tool-output.ts,
useFileOpenRouting.ts, system-routes.ts, two new test files, architecture.md, file-index-client.md);
PR #86 closed as redundant.

---

_Generated from session `019e9f1f-10a6-77a7-802e-72e7935b2d17` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-07. Source extract: deterministic facts sheet._
