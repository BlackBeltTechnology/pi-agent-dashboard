---
session: 019e7975
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
---

# How we did it: Unblock & land PR #56 (editor keeper sidecar) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a small factual question — *"Is there any openspec for that
feature?"* — but the **real objective** surfaced over the next few steering turns: **get
the `add-editor-keeper-sidecar` PR (#56) unstuck and green.** The branch had already
landed its feature commit but the PR was still open, conflicting with `develop`, and
would later fail CI. The finished result: PR #56 rebased cleanly, CI 10/10 green, and a
rewritten PR description ready for review/merge.

## 2. TL;DR playbook

1. **Locate the spec** — `ls openspec/changes/archive/ | grep -i editor` to confirm the
   proposal was archived (feature already specced, not active).
2. **Diagnose PR state, don't assume** — `gh pr view 56 --json state,mergeable,mergeStateStatus,reviewDecision`.
   Here: `OPEN` / `CONFLICTING` / `DIRTY`.
3. **Rebase onto develop** — stash a dirty `package-lock.json` first, then
   `git rebase origin/develop`. Expect conflicts only where develop moved.
4. **Resolve per current policy** — the lone `AGENTS.md` conflict was the old 270-row
   Key Files table vs. the new "no per-file index" policy. Take `--ours` (HEAD); verify
   the new rows already live in `docs/file-index-server.md`.
5. **Force-push safely** — `git push --force-with-lease` → PR flips to `MERGEABLE`/`CLEAN`.
6. **Monitor CI** — `gh run list` / `gh run view <id>`; poll ~60s. Grab failure logs the
   moment the `ci` job goes red.
7. **Fix the fixture drift** — rebasing onto develop pulled in newer tests that didn't
   know the feature's new fields. Make the new config field optional; stub new registry
   methods in mocks; fix `as any` cast positions. Re-run lint to `0 errors`.
8. **Push the fix, re-watch CI to fully green** (10/10), then **rewrite the PR body**
   with Summary / What changed / Tests / Migration / Rebase notes.

## 3. How the collaboration unfolded

**Phase A — Discovery (is there a spec?).** The AI grepped `openspec/changes/` and its
`archive/`, found `2026-05-28-add-editor-keeper-sidecar` archived, and correctly reported
the feature was already specced. Effective because it answered with the concrete path
rather than a yes/no guess.

**Phase B — PR triage (why is this open?).** The AI first *mis-stated* status by confusing
worktree HEAD with the branch tip, then self-corrected: worktree HEAD was `develop`, the
branch was 1 commit ahead, and PR #56 was genuinely `OPEN` + `CONFLICTING` + `DIRTY`. The
decision point — human asked "Then why is PR open?" — forced the AI to query `gh` for real
state instead of narrating from `git log`.

**Phase C — Rebase & resolve.** Single conflict in `AGENTS.md`. The AI recognized the
conflict as a *policy* difference (obsolete Key Files table vs. new pointer-only rule),
resolved with `--ours`, and **verified** the keeper rows survived in
`docs/file-index-server.md` before continuing. Force-pushed with `--force-with-lease`;
PR went `MERGEABLE`. The human confirmed the push ("1" / "Done") at the ask_user gate.

**Phase D — Monitor CI (steering: "monitor CI").** The `ci` job failed on lint: 23 TS
errors. The AI reproduced locally, root-caused it as **test-fixture drift** — develop's
newer tests required `stopOnDashboardExit` on `EditorConfig` and `adoptOrphans` on the PID
registry, plus 2 mock-cast issues. It picked the *smallest* fix (make the field optional
since consumption was already null-safe; stub the mocks; move the casts), got to `0
errors`, pushed `41c3ab4a`, and polled the new run to 10/10 green.

**Phase E — Ship polish ("update PR description").** Rewrote the PR body into Summary /
What changed / Tests (22 new across 4 files) / Migration & compatibility / Rebase notes.

## 4. Prompts that worked

- **Goal prompt — *"Is there any openspec for that feature?"*** — a good, cheap opener
  that grounds the AI in the existing spec before touching code. Stronger version: *"Find
  the openspec change for the editor-keeper feature and tell me if PR #56 is ready to
  merge."*
- **High-leverage follow-up — *"Than why PR is open?"*** — one skeptical question exposed
  the AI's HEAD-vs-branch mistake and pivoted it to authoritative `gh` state. Skepticism
  about a confident-but-wrong answer is the highest-leverage move here.
- ***"monitor CI"*** — two words that delegated the entire poll-diagnose-fix-repush loop.
  Effective because the AI already had the run id and could own the loop end to end.
- ***"update PR description"*** — terse ship-polish trigger; worked because all facts were
  already in context.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Narrate PR status from `git log` and confuse worktree HEAD with the branch tip | "Check develop and changes in this PR" / "Than why PR is open?" | Query `gh pr view --json state,mergeable,mergeStateStatus` first — never infer merge state from local git |
| Treat the `AGENTS.md` conflict as a normal 3-way merge | (implicit, via policy) | Recognize doc-index conflicts as *policy* changes: take HEAD's pointer-only version, confirm rows live in `docs/file-index-<area>.md` |
| Risk clobbering remote history on force-push | ask_user confirm gate ("1"/"Done") | Always `git push --force-with-lease`, and gate the push on explicit confirm |
| Over-fix the 23 TS errors | (self-imposed quality bar) | Prefer the smallest correct fix: make new field optional when consumption is already null-safe, stub only the missing mock methods |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was persisted this session. The workflow is highly repeatable, so the
recommended artifact is a **project skill `unblock-and-land-pr`** capturing:

- **Captures:** the diagnose → rebase → resolve-by-policy → force-push-with-lease →
  monitor-CI → fix-fixture-drift → rewrite-PR-body loop.
- **Why effective:** removes the repeated manual `gh` state queries and the recurring
  "test-fixture drift after rebase" fix (optional field + mock stubs), which is a
  predictable failure mode whenever a feature branch rebases onto a moved `develop`.
- **When to invoke:** any PR that is `OPEN`/`CONFLICTING`, or any post-rebase CI failure
  that turns out to be tsc errors from newer tests on the base branch.

## 7. Pitfalls & dead ends

- **Confident-but-wrong status report.** The first PR summary claimed the branch was "0
  commits ahead / already merged." → Always confirm with `gh pr view --json`, not local
  `git log`.
- **Rebase reintroduces CI failure.** A clean rebase + green mergeability does **not** mean
  green CI — develop's newer tests failed against the feature's types. → After any rebase,
  run lint/tsc locally before assuming success.
- **Dirty `package-lock.json` blocking rebase.** It was stashed (1742/151) and left in the
  stash. → Remember to `git stash list` / pop and inspect it afterward.
- **`as any` cast in the wrong place.** Casting inside `vi.fn(...)` broke typing; move the
  cast to *outside* the `vi.fn` call for `sock.write`/`sock.end`.

## 8. Reproduce it faster — checklist

Inputs to have ready: `gh` authenticated, the worktree checked out, PR number (#56).

- [ ] `gh pr view <n> --json state,mergeable,mergeStateStatus,reviewDecision`
- [ ] `git stash` any dirty lockfile, then `git rebase origin/develop`
- [ ] Resolve doc-index conflicts with `--ours`; verify rows in `docs/file-index-<area>.md`
- [ ] `git push --force-with-lease` → confirm PR is `MERGEABLE`/`CLEAN`
- [ ] `gh run list` → `gh run view <id>`; poll ~60s
- [ ] On lint/tsc failure: make new config fields optional, stub new mock methods, fix cast
      positions → re-run to `0 errors` → push fix
- [ ] Watch CI to full green (Linux + Windows smoke can lag)
- [ ] Rewrite PR body: Summary · What changed · Tests · Migration/compat · Rebase notes

Final artifacts: rebased commit `24b3c4b4`, fix commit `41c3ab4a`, CI run `26687708657`
(10/10 ✅), PR #56 body updated.

---

_Generated from session `019e7975-b890-733c-a3df-a2955fcd2b51` · `pi-agent-dashboard` · 2026-05-30. Source extract: `facts.XXXXXX.4ziupwVUEB`._
