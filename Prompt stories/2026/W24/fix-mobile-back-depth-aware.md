---
session: 019ec38a
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [fix-mobile-back-depth-aware]
proposal_excerpt: "On mobile, the back-arrow and swipe-back can't return to the session-card list (depth 0) from ChatView (depth 1). Reported repro: shrink a desktop window to mobile size while a session is open, then press back — you s…"
---

# How we did it: Depth-aware mobile back navigation — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change fix-mobile-back-depth-aware
```

The real objective (from the proposal): on mobile the back-arrow and swipe-back
couldn't return from `ChatView` (depth 1) to the session-card list (depth 0). Repro:
shrink a desktop window to mobile size with a session open, press back, and you get
stuck. The task was to **implement the already-approved OpenSpec change end-to-end** —
write the fix TDD-style, land it through CI and CodeRabbit, and clean up — with the
human supplying only short "go on / archive / commit / merge" nudges at each phase
boundary.

## 2. TL;DR playbook

1. Invoke `/skill:openspec-apply-change <change-name>` to start from the approved proposal + tasks.md.
2. Read the change artifacts and the touched source (`history-back.ts`, `mobile-depth.ts`, `route-builders.ts`, `App.tsx`) **before writing anything**.
3. Walk tasks.md in order, strictly TDD: write the failing test (task N.1), confirm it fails, then the minimal implementation (task N.2). Repeat per helper.
4. Run client tests in an isolated HOME: `HOME=$(mktemp -d) npx vitest run packages/client/src/lib/__tests__/<file>.test.ts` (avoids config bleed).
5. Wire the new pure helpers into `App.tsx` last; typecheck with `npx tsc -p packages/client/tsconfig.json --noEmit`.
6. Run the full suite once (`npm test 2>&1 | tee /tmp/pi-test.log`), then **prove pre-existing failures are unrelated** by matching them to errors that predate your edits.
7. Delegate the `docs/file-index-*.md` row update to a subagent (Documentation Update Protocol, caveman style).
8. `openspec archive <change> --yes`, then `openspec validate <capability>` (targeted, not `--specs`) to confirm the spec applied cleanly.
9. Commit (exclude local-only `.pi/settings.json`), push, `gh pr create`, monitor `gh pr checks` with a poll loop until CI + CodeRabbit settle.
10. Triage CodeRabbit line-by-line: fix the valid ones, post a reasoned rebuttal for false positives, re-push, re-poll, then `gh pr merge --squash --delete-branch` and tear down the worktree from **outside** it.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (prompt 1).** The AI located the change dir, ran
`openspec instructions apply --json` to get the ordered task list, and read every
context file plus the existing nav source before touching code. *Why it worked:*
grounding in the real route builders and `getMobileDepth` meant the fix single-sourced
depth derivation instead of re-inventing it.

**Phase 2 — TDD generation (prompt 1 → "go on").** Each helper was built test-first:
`back-target.ts` (pure `computeBackTarget(route)`), `nav-tracker.ts` (depth-tagged
in-app nav stack with one `popstate` listener), then a hybrid `goBack` in
`history-back.ts`. The AI confirmed each test *failed* before implementing, and ran
tests in a `mktemp` HOME to dodge config bleed. Wiring into `App.tsx` came last. A
regression suite exercised tracker + goBack together (32 passing). *Decision point:*
the human's "go on" simply unblocked the next batch — the ordering was the AI's.

**Phase 3 — Verify + isolate noise.** The full suite showed 18 failures; the AI proved
all 18 were pre-existing (`pi-image-fit` jimp import breakage + one flaky
`doctor-route` timing test) by matching them to the same errors seen in `tsc` *before*
any edit. Docs row update went to a subagent. A production client build confirmed
compilation.

**Phase 4 — Archive (prompt 3, "checked as done and archive").** `openspec archive`
moved the change to `archive/<date>-<name>/` and applied the `url-routing` spec delta;
targeted `openspec validate url-routing` was clean (repo-wide `--specs` noise ignored).

**Phase 5 — Ship (prompt 4, "commit, create PR and monitor CI").** Committed (staging
only `docs/ openspec/ packages/client/`, restoring the local `.pi/settings.json`),
pushed, opened PR #110. A heredoc backtick got shell-interpreted and mangled the body;
the AI rewrote it via `gh pr edit --body-file`. Poll loop watched `gh pr checks` until
`ci` + `CodeRabbit` went green.

**Phase 6 — Review triage (prompt 5, "fix coderabbit issues") + merge (prompt 6).**
Four CodeRabbit suggestions: made `initNavTracker` idempotent (single-listener guard +
test), scoped a stale spec scenario to browser Back, fixed doc path prefixes via
subagent, and posted a reasoned rebuttal for the false positive ("move out of
`archive/`" — that's exactly where the CLI puts archived changes). Re-pushed, re-polled
green, squash-merged. `gh`'s auto-cleanup aborted (base `develop` checked out in main
worktree), so the AI deleted the remote branch, force-removed the worktree from
outside it, and deleted the local branch manually.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change fix-mobile-back-depth-aware`. Effective
  because the *proposal + tasks.md already existed*: the skill gave the AI an ordered,
  testable plan so the human never had to describe the fix. **Reusable pattern:** do the
  spec/plan work first, then hand the AI one skill invocation.
- **"go on"** — a zero-content unblock at a phase boundary. High-leverage precisely
  because the AI's plan was trustworthy; the human only confirmed forward motion.
- **"checked as done and archive"** — collapsed "mark the last manual-QA task done +
  run the archive workflow" into five words.
- **"commit, create PR and monitor CI"** — one prompt drove the entire ship pipeline.
- **"fix coderabbit issues"** — delegated review triage wholesale; the AI decided which
  were valid vs false-positive and defended its choices on the PR.

Weak-prompt rewrite: "fix coderabbit issues" worked here only because the AI already
had context. A stronger stand-alone version: *"Address each CodeRabbit thread on PR
#110; fix valid ones with a test, and reply on-thread with a reason for any you skip."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause at each phase boundary awaiting a nudge | "go on" | Add "run the full apply→archive→ship loop without stopping for confirmations" to the goal prompt |
| Stop after implementation, before archiving | "checked as done and archive" | Tell it up front: mark the manual-QA task done and archive when tests pass |
| Not ship on its own | "commit, create PR and monitor CI" | State the ship intent in the kickoff so PR + CI monitoring are part of one run |
| Treat CodeRabbit as informational | "fix coderabbit issues" | Ask it to triage + fix/rebut each thread automatically after PR open |

Quality bars the human's terse prompts implicitly enforced: TDD ordering, isolating
pre-existing test noise (never claiming a green run without proving unrelated failures),
subagent-delegated docs edits, and never committing the local `.pi/settings.json`.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session *consumed* existing ones well:

- **`openspec-apply-change`** — turned an approved change into an ordered TDD task walk.
  Invoke whenever a proposal + tasks.md already exist and you want a disciplined build.
- **Documentation Update Protocol via subagent** — the two `general-purpose` subagents
  (update, then fix, `file-index-client.md` rows) kept `docs/` edits caveman-style and
  off the main agent. Invoke for any `docs/` row change.

**Recommendation:** the ship tail (commit → PR → poll CI → triage CodeRabbit → merge →
teardown worktree) is highly repeatable and matches the project's `ship-change` /
`ship-it` skills — prefer invoking those directly instead of hand-driving `gh` next
time.

## 7. Pitfalls & dead ends

- **Heredoc backticks in `gh pr create --body`** got shell-interpreted and mangled the
  PR body. → Write the body to a file and use `gh pr edit --body-file /tmp/pr-body.md`.
- **`gh pr merge --delete-branch` auto-cleanup aborted** because the base `develop` was
  checked out in the main worktree. → Delete the remote branch, remove the worktree, and
  delete the local branch manually; run the worktree removal from **outside** it.
- **Vitest config bleed** → run client tests under `HOME=$(mktemp -d)`.
- **Repo-wide `openspec validate --specs` is noisy** (pre-existing strict-mode
  failures). → Validate the targeted capability (`openspec validate url-routing`).
- **Full-suite red herrings** — 18 failures were all pre-existing (`pi-image-fit` jimp +
  flaky `doctor-route` timing). → Match failures to pre-edit `tsc`/test output before
  blaming your change.
- **CodeRabbit false positive** ("move change out of `archive/`") — `archive/<date>-<name>/`
  is the canonical post-archive path. → Rebut on-thread with the reason; don't blindly
  comply.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an approved OpenSpec change (`proposal.md` + `tasks.md`), a
worktree on the change branch, `gh` authenticated, CodeRabbit enabled on the repo.

- [ ] `/skill:openspec-apply-change <change-name>`
- [ ] Read change artifacts + touched source before coding
- [ ] TDD each helper (fail → implement), tests under `HOME=$(mktemp -d)`
- [ ] Wire helpers into `App.tsx`; `npx tsc -p packages/client/tsconfig.json --noEmit`
- [ ] Full suite once; prove any failures are pre-existing
- [ ] Subagent-update `docs/file-index-client.md` rows (correct `packages/client/src/...` prefix)
- [ ] `openspec archive <change> --yes` + targeted `openspec validate <capability>`
- [ ] Commit (exclude `.pi/settings.json`), push, `gh pr create` (body via file)
- [ ] Poll `gh pr checks` until green; triage CodeRabbit (fix valid, rebut false)
- [ ] `gh pr merge --squash --delete-branch`; manual worktree/branch teardown from outside

**Final artifacts produced:** `packages/client/src/lib/back-target.ts`,
`nav-tracker.ts`, modified `history-back.ts` + `App.tsx`, four test files (44 passing),
updated `openspec/specs/url-routing/spec.md`, `docs/file-index-client.md` rows, and
merged PR #110 on `develop`.

---

_Generated from session `019ec38a-3c5a-724a-9c56-b458076990e7` · `pi-agent-dashboard` · 2026-06-14. Source extract: session facts sheet._
