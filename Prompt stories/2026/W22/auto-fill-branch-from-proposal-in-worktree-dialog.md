---
session: 019e7b7f
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (10 user prompts)"
upgrade_status: pending
openspec_changes: [auto-fill-branch-from-proposal-in-worktree-dialog]
proposal_excerpt: "`WorktreeSpawnDialog` derives the worktree path from the branch input (`derivedPath = <repo>/.worktrees/<slug(newBranch)>`). The per-change `⑂+` entry (`FolderOpenSpecSection`) passes `initialBranch=\"os/<change>\"` as…"
---

# How we did it: Auto-fill worktree branch from an OpenSpec proposal — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change auto-fill-branch-from-proposal-in-worktree-dialog
```

The real objective, per the attached proposal: make `WorktreeSpawnDialog.tsx` **react**
to a changing `attachProposal` prop so the branch input auto-fills `os/<change>` when a
proposal is attached — without clobbering what the user has already typed. The session
then ran the full lifecycle: implement → test in a real browser → keep rebasing onto a
fast-moving `develop` → write the PR body → merge → watch CI → tear down the worktree.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` inside the change's worktree — it reads `proposal.md` + `tasks.md` and drives implementation.
2. Let the AI make the surgical edit: add a `branchDirty` state, set it in the `<input>` `onChange`, add a `useEffect([attachProposal])` that only writes when the field is pristine.
3. Add a focused `describe(... reactive attachProposal)` test block (mount-with-prop, late arrival, dirty-wins, prop-cleared, prop-swap, `initialBranch` back-compat) and run vitest with `HOME=$(mktemp -d)` to avoid config pollution.
4. Delegate the doc-index row update to a subagent (Documentation Update Protocol), not inline.
5. Verify in the browser: **rebuild first** (`npm run build`) — the dashboard serves the production bundle, so unbuilt TS edits are invisible. Restart via `POST /api/restart`.
6. Before every push, `git fetch origin develop` then `git rebase origin/develop`; re-run tests after each rebase. Repeat as develop moves.
7. Write the PR body grounded strictly in the proposal + diff (Why · What · Tests table · Risk · OpenSpec pointer · Files).
8. Merge: `git push --force-with-lease` (history was rewritten by rebases) then squash-merge; the local `checkout develop` step failing is expected if develop is checked out in the main worktree.
9. Monitor CI on the merged develop SHA; on green, remove the worktree + delete the branch **from the main repo**.

## 3. How the collaboration unfolded

**Phase 1 — Implement (opus, medium thinking).** The AI read the proposal/tasks, edited
`WorktreeSpawnDialog.tsx` (added `branchDirty`, the `onChange` flag, and the reactive
`useEffect`), and appended a 6-test block to the component's test file. *Why it worked:*
the pristine/dirty guard is the whole correctness story — auto-fill only when the user
hasn't touched the field — and the tests encode exactly those branches. 42/42 passed.

**Phase 2 — Docs.** The doc-index row for the new file went to an `Explore` subagent
rather than being edited inline, per the repo's Documentation Update Protocol. The file
wasn't strictly alphabetized, so the row was appended.

**Phase 3 — Browser verify.** First load showed a **blank page** — a JS error from the
change. Root cause: the server was serving the *production* bundle and the TS edits
weren't built. `npm run build` + `POST /api/restart` fixed it; then both manual tasks
(plain `+Worktree` = empty input; per-change `⑂+` = `os/<change>` prefilled) verified via
`agent-browser` (47 browser calls, console/errors inspected).

**Phase 4 — The rebase treadmill.** `develop` moved repeatedly (6 commits, then 1, then
1 more) across the ~11h session. Each time the human said "rebase develop", the AI
fetched, rebased (always clean, no conflicts), and re-ran the 42 tests. *Decision point:*
when asked to rebase again the human corrected with "no. merge" — cut the loop and ship.

**Phase 5 — Ship + teardown.** Force-push-with-lease, squash-merge PR #67, monitor CI to
green on the merged SHA, then remove the worktree and delete the branch from the main
repo. The session's cwd ceased to exist after teardown.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change <name>`. Effective because it hands the
  AI the proposal + tasks contract, so implementation is spec-grounded from turn one. Have
  the OpenSpec change fully written *before* this.
- **`test with browser tool`** — short, high-leverage; forced real-UI verification that
  surfaced the blank-page/stale-bundle bug a unit test would never catch.
- **`no. merge`** — a one-word course-correction that broke an unnecessary rebase loop.
  Worth copying: interrupt a repeating maintenance action the moment it's no longer needed.
- **`monitor CI`** — delegates the post-merge watch instead of eyeballing GitHub.

Weak-prompt rewrite: `rebase develop` (used 4×) → `rebase onto origin/develop and re-run
the WorktreeSpawnDialog tests` bundles the verification the AI did anyway, in one turn.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Verify UI against a **stale production bundle** (TS edits invisible → blank page) | `test with browser tool`, then rebuild was needed | State up front: "the dashboard serves the built bundle — `npm run build` + restart before browser checks" |
| Leave the branch on an increasingly stale `develop` | Repeated `rebase develop` / `rebase to develop` | Rebase + re-test as one habit before each push; expect develop to move on long sessions |
| Keep offering to rebase again | `no. merge` | Say "merge now" once the diff is green and current |
| Edit the doc index inline | (Protocol) delegate to subagent | Route file-index rows to `Explore`/DocScribe per the Documentation Update Protocol |

Also note the AI dropped auto-generated `.pi/settings.json` cruft (`git checkout --`)
before committing — a good default: don't commit pi's path rewrites.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session *consumed* existing ones:

- **`openspec-apply-change`** turned a proposal into a spec-grounded implementation loop
  (edit → test → mark tasks → docs) without re-explaining scope.
- **`Explore` subagent** isolated the doc-index update so the main context stayed on code.
- **`agent-browser`** gave real-DOM verification (console + errors) that caught the
  stale-bundle blank page.

Recommended skill to create if this recurs: a **"rebase-and-retest before push"** micro-skill
(fetch origin/develop → rebase → run the touched test file with `HOME=$(mktemp -d)`), since
that exact three-step ran four times here.

## 7. Pitfalls & dead ends

- **Blank page after a client edit** → you're looking at the production bundle. `npm run
  build` then `POST /api/restart`; don't debug the JS until you've rebuilt.
- **`grep`-ing the doc index for the new file row failed repeatedly** (5 dead `grep`
  attempts on `docs/file-index-client.md`) — the file wasn't alphabetized/formatted as
  assumed. Just append the row and let the subagent place it.
- **`checkout develop` fails during merge** — expected when `develop` is already checked
  out in the *main* worktree. The server-side squash-merge still succeeded; ignore the
  local checkout error.
- **Force-push needed** after rebases — use `git push --force-with-lease`, never a bare
  `--force`.
- **cwd disappears after teardown** — once the worktree is removed, further bash in that
  session fails; `cd` back to the main repo root.

## 8. Reproduce it faster — checklist

Inputs to have ready:
- A complete OpenSpec change at `openspec/changes/<name>/` (proposal + tasks).
- A running dashboard on `localhost:8000` and `agent-browser` available.
- Push access + `gh` for the PR/merge steps.

Checklist:
1. In the change's worktree: `/skill:openspec-apply-change <name>`.
2. Guard the reactive prop with a dirty flag; add the focused test block; `HOME=$(mktemp -d) npx vitest run <test file>`.
3. Delegate the doc-index row to a subagent.
4. `npm run build` → `POST /api/restart` → browser-verify both entry paths.
5. `git fetch origin develop && git rebase origin/develop` → re-test (repeat as develop moves).
6. Write the PR body from proposal + diff only.
7. `git push --force-with-lease` → squash-merge → monitor CI on the merged SHA.
8. On green: `git -C <main repo> worktree remove .worktrees/<name>` + `branch -D os/<name>`; `cd` back to the main repo.

Artifacts produced:
- `packages/client/src/components/WorktreeSpawnDialog.tsx` (reactive `attachProposal`)
- `packages/client/src/components/__tests__/WorktreeSpawnDialog.test.tsx` (6 new tests, 42/42)
- `docs/file-index-client.md` (new row) · PR #67 (squash-merged) · worktree removed

---

_Generated from session `019e7b7f` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-31. Source extract: session facts sheet (mktemp)._
