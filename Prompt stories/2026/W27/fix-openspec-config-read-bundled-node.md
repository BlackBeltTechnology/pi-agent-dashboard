---
session: 019f32ee
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [fix-openspec-config-read-bundled-node]
proposal_excerpt: "The global OpenSpec profile section in the dashboard Settings panel shows \"not found\" / fails to load the current profile when the dashboard runs as a bundled Electron app on macOS (and Windows) — even though the…"
---

# How we did it: land the last testing task for the bundled-Electron OpenSpec config-read fix — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was two words: **"Implement the testing"**. In context, the operator was in
the `os-fix-openspec-config-read-bundled-node` worktree with an OpenSpec change already
mostly implemented — only the *testing* task (task **5.6**) was left. The real objective,
once steering clarified it: **finish the remaining QA regression gate that proves the
bundled-Electron OpenSpec config-read bug stays fixed, get it through CI on the actual
Electron build legs, then open/merge a PR and clean up the branch + worktree.** The bug:
on a bundled Electron app (macOS/Windows), the managed-bin `openspec` shebang script died
exit 127 on a stripped PATH → `/api/openspec/config` returned 502 → Settings showed the
profile as "not found". The fix node-wraps the spawn; the task was to lock that in with a
launch-smoke assertion.

## 2. TL;DR playbook

1. **Read the task list first.** `cat openspec/changes/<change>/tasks.md` and find the one
   unchecked box (here: 5.6). Read the QA scripts it references before touching anything.
2. **Reproduce the topology in the test, not just assert green.** Seed the exact affected
   filesystem shape: managed-bin `.js` shebang script + `.bin/openspec` symlink + a global
   `config.json` with a known profile (`core`).
3. **Add a post-`/api/health` assertion:** `GET /api/openspec/config` must return 200 +
   `profile=core`; `curl -sf` failing (the 502 the bug produces) → hard FAIL; SKIP only if
   the seed can't be created.
4. **Verify locally in an isolated `HOME`** before pushing — reproduce node-wrap-succeeds
   vs raw-shebang-dies-127 in `/tmp` with a stripped PATH.
5. **Update the per-file `qa/AGENTS.md` rows** for both scripts and check the task box.
6. **Handle the PR reality:** if the branch's old PR is already merged, GitHub won't let you
   reopen it — commit, re-push the branch, and open a **fresh** PR against `develop`.
7. **The QA smoke tests aren't in the auto `ci` check** — manually dispatch `ci-electron.yml`
   with correct `legs` (`darwin-arm64,linux-x64`, not bare platform names) and poll the run.
8. **Grep the CI logs to confirm the new assertion actually executed** (`profile=core`), not
   just that the leg was green.
9. **Merge squash + delete branch, then remove the worktree from the main repo** (not from
   inside the worktree you're deleting).

## 3. How the collaboration unfolded

**Phase 1 — Discovery & implement (task 5.6).** The AI read `tasks.md`, the two Electron
launch-smoke scripts (`08-electron-real-launch.sh` Linux, `09-electron-mac-launch.sh`
macOS), and the openspec config route to learn the expected profile shape. It then wrote a
`seed_openspec` pre-launch function reproducing the affected topology exactly, plus a
post-health assertion. *Why it worked:* the test recreates the real failure signature
(shebang-on-stripped-PATH → 127 → 502) instead of a synthetic stub, so it genuinely guards
the regression.

**Phase 2 — Local verification.** Before pushing, the AI reproduced the fix in an isolated
`HOME` under `/tmp`: node-wrap by absolute path on a stripped PATH succeeds; the raw shebang
dies exit 127. This proved the assertion would actually catch the bug. It also updated
`qa/AGENTS.md` per the repo's per-file documentation protocol and checked the task box.

**Phase 3 — PR (steering: "create PR for it — or reopen one. Choose").** The AI checked git
state, found PR #212 on this branch was already **merged** and its remote branch deleted.
Decision point: a merged PR can't be reopened → it committed the 4 files, re-pushed the
branch, and opened a **new** PR #243 against `develop`.

**Phase 4 — CI (steering: "Execute CI tests, so the new tests").** The AI discovered the new
08/09 smoke tests only run via the manually-dispatched `ci-electron.yml` (not the auto `ci`
check). First dispatch failed on a bad `legs` format; it corrected to `darwin-arm64,linux-x64`,
polled the ~20-min run, and **grepped the logs** to confirm the macOS leg actually ran and
passed the new `profile=core` assertion. It also noted the Linux `08` runs only in the QA VM
harness, not GitHub CI.

**Phase 5 — Testability triage (steering: "There are tests unchecked. Can be tests made for
that cases?").** The AI examined each remaining unchecked box and gave a reasoned verdict:
their testable cores were *already* covered (5 cases in `runner-spawn-env.test.ts`, parity +
integration suites), and the rest were one-time physical-hardware observations no unit test
can substitute. It ran the 11 relevant tests green to back the claim.

**Phase 6 — Merge & cleanup (steering: "I will test later, merge PR delete branch and
worktree").** Squash-merged #243, deleted the remote branch, then removed the worktree +
local branch **from the main repo** — because the session's own cwd was the worktree being
deleted.

## 4. Prompts that worked

- **Goal prompt — "Implement the testing"** (weak but survivable *because* the task list was
  the source of truth). Stronger version: *"Implement the remaining unchecked testing task
  (5.6) in tasks.md — reproduce the bug topology in the QA smoke script and add a
  regression assertion."*
- **"create PR for it — or reopen one. Choose"** — high-leverage: it delegated the
  merged-PR-can't-reopen decision to the AI instead of forcing a round-trip. Good pattern for
  a low-stakes branching decision.
- **"Execute CI tests, so the new tests [run]"** — forced the discovery that the smoke tests
  need a *manual* workflow dispatch, not the auto check. Stronger: *"Dispatch ci-electron.yml
  on this branch and confirm the new 08/09 assertion actually ran in the logs."*
- **"There are tests unchecked. Can be tests made for that cases?"** — a quality-bar prompt:
  it pushed the AI to justify *why* the remaining boxes are non-automatable rather than
  blindly writing filler tests. Excellent guardrail against test-theater.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementing the test, not ship it | "create PR for it — or reopen one. Choose" | State up front: "implement AND land it (PR → CI → merge → cleanup)" |
| Assume the auto `ci` check runs the new smoke tests | "Execute CI tests, so the new tests [run]" | Know that 08/09 live in the manually-dispatched `ci-electron.yml`, not `ci` |
| Leave unchecked task boxes ambiguous | "There are tests unchecked. Can be tests made for that cases?" | Ask for a testability verdict per unchecked box, with reasoning |
| Risk writing low-value tests to close boxes | Same prompt as above | Prefer "already covered / non-automatable, here's proof" over filler tests |
| Clean up from inside the worktree being deleted | "merge PR delete branch and worktree" | Run worktree removal from the **main** repo root, never inside `.worktrees/<name>` |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created in this session. The workflow is nonetheless repeatable, and
two candidate procedural skills would pay off:

- **"land-a-worktree-testing-task"** — the loop of *find unchecked task → reproduce topology
  in QA smoke → verify in isolated HOME → new-PR-when-old-is-merged → dispatch ci-electron.yml
  → grep logs → squash-merge → clean worktree from main repo.* This session already re-derived
  every one of those steps; a skill would remove the re-discovery cost. (The repo's existing
  `ship-change` / `ship-it` skills cover the PR+merge tail but not the reproduce-topology and
  manual-Electron-CI-dispatch specifics.)
- **A memory** noting that **the 08/09 Electron launch-smoke tests run only via a manual
  `ci-electron.yml` dispatch** (Linux `08` is QA-VM-only, not GitHub CI) — this was
  rediscovered mid-session and is exactly the kind of non-obvious CI-topology fact worth
  persisting.

## 7. Pitfalls & dead ends

- **Merged PR can't be reopened.** If the branch's PR already merged and its remote branch was
  deleted, don't try to reopen — commit, re-push the branch, open a fresh PR.
- **`ci-electron.yml` `legs` format.** A bare platform list is rejected; use
  `<platform>-<arch>` tokens (`darwin-arm64,linux-x64`). The first dispatch failed on this.
- **Green leg ≠ assertion ran.** Always grep the CI log for the specific assertion output
  (`profile=core`, "seeded managed-bin openspec symlink") — a leg can pass without your new
  block executing.
- **Linux `08` isn't in GitHub CI.** Only macOS `09` is wired into `_electron-build.yml`;
  `08` runs in the QA VM harness (`make test-linux-x86`). Don't expect the Linux assertion to
  show up in the PR checks.
- **Deleting the worktree you're standing in.** `gh pr merge --delete-branch`'s local
  post-merge checkout fails when `develop` is held by the main worktree, and later `git
  worktree` commands error because the session cwd was the removed worktree. Do the cleanup
  from `/Users/robson/Project/pi-agent-dashboard`, then start a fresh shell.
- **Don't write filler tests to close boxes.** Some unchecked tasks are one-time physical
  observations (which branch fires on real hardware) that no unit test can substitute — say so
  with evidence instead.

## 8. Reproduce it faster — checklist

- [ ] `cat openspec/changes/<change>/tasks.md` — find the unchecked box.
- [ ] Read the QA scripts + config route it references.
- [ ] Seed the exact affected topology in the smoke script (managed-bin `.js` + `.bin` symlink
      + global `config.json` with a known profile).
- [ ] Add a post-health assertion: `GET /api/openspec/config` → 200 + `profile=core`; FAIL on
      502, SKIP only when unseeded.
- [ ] Verify locally in an isolated `HOME` (`/tmp`, stripped PATH): node-wrap succeeds, raw
      shebang dies 127.
- [ ] Update `qa/AGENTS.md` rows; check the task box.
- [ ] Commit + push; open a **new** PR against `develop` if the old one is merged.
- [ ] `gh workflow run ci-electron.yml --ref <branch> -f legs=darwin-arm64,linux-x64`; poll.
- [ ] Grep the run log to confirm the new assertion executed.
- [ ] Give a testability verdict on any other unchecked boxes; run the covering suites green.
- [ ] `gh pr merge <n> --squash --delete-branch`; remove the worktree **from the main repo**.

**Key inputs to have ready:** `gh` authenticated; the worktree checkout; the OpenSpec change
name; knowledge that Electron smoke tests dispatch via `ci-electron.yml`.

**Final artifacts:** `qa/tests/08-electron-real-launch.sh`, `qa/tests/09-electron-mac-launch.sh`,
`qa/AGENTS.md`, `openspec/changes/fix-openspec-config-read-bundled-node/tasks.md` — merged via
PR #243 into `develop`.

---

_Generated from session `019f32ee` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-05. Source extract: `session_facts.XXXXXX.6ri1bDVqKM.md`._
