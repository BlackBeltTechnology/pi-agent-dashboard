---
session: 019ea14f
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "yes — heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [add-worktree-spawn-placeholder-card]
proposal_excerpt: "Spawning a normal session shows an immediate placeholder skeleton card in the target folder group, giving instant feedback during the spawn→register window. Spawning a worktree session shows nothing — the user cli…"
---

# How we did it: Ship a worktree-spawn placeholder card, end-to-end — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened in a worktree and fired a single slash command:

```
/skill:openspec-apply-change add-worktree-spawn-placeholder-card
```

The *real* objective, once the follow-up steering made it explicit, was **the whole
delivery arc for one OpenSpec change** — not just "apply the tasks." The user wanted:
implement the spec-driven tasks → run/verify tests → archive the change and sync
delta specs → commit, push, open a PR against `develop`, watch CI → wait for
CodeRabbit and triage every comment → merge and clean up the branch + worktree. Six
short prompts drove the AI through five gates; each prompt was a nudge to advance to
the next gate rather than a course-correction on the code itself.

The feature: a worktree spawn previously showed **no** placeholder card because the
placeholder was keyed to the worktree's own path — a "homeless" cwd that no session
group ever matched. The fix renders the skeleton under the **parent repo group** from
the moment "Spawn →" is clicked, covering both the `createWorktree` latency window and
the spawn→register window.

## 2. TL;DR playbook

1. From inside the worktree, run `/skill:openspec-apply-change <change>` — the skill
   auto-detects the change and reads proposal/specs/tasks.
2. Let the AI grep the wiring first (`WorktreeSpawnDialog`, `useSessionActions`,
   `useMessageHandler`, `App.tsx`, `SessionList`) and read existing tests **before**
   editing. This maps every call site so nothing is missed.
3. Implement task-by-task, marking `tasks.md` checkboxes as you go; typecheck with
   `npm run lint` (it's `tsc --noEmit`) before writing tests.
4. Run the **narrow** test set first (`npm test -- <specs>`), then the full suite to
   catch contract fallout. Expect assertion breakage where the new optional field
   (`placeholderCwd`) is added to `onSpawnSession` opts — update those assertions.
5. Build + restart the live dashboard (`npm run build`, then
   `POST /api/restart`) so the synced behavior goes live. Revert any incidental
   `.pi/settings.json` path rewrite.
6. `/skill:openspec-archive-change <change>` — sync delta specs (delegated to a
   subagent) and move the change to `openspec/changes/archive/YYYY-MM-DD-<name>/`.
7. `commit, push, create PR and monitor CI` — one prompt drives the whole git+gh
   sequence against `develop`; poll `gh pr checks <n>` in a loop.
8. When CodeRabbit posts, triage **each** comment against the actual code and the
   surgical-changes rule: fix the valid ones, reply-and-defer the pre-existing/out-of-
   scope ones, reject false positives with a documented reason.
9. `merge PR and cleanup branch, worktree` — squash-merge, then remove the worktree +
   local/remote branch manually (gh's auto-cleanup fails **inside** a worktree).

## 3. How the collaboration unfolded

**Phase 1 — Discovery & mapping.** The AI opened the change, read the context files,
then grepped for every symbol touching spawn/placeholder wiring across five files. It
explicitly confirmed there was no *third* wiring site for the `+Worktree` button
before editing. *Why it worked:* mapping all call sites up front turned a
multi-file change into a mechanical, low-risk edit pass.

**Phase 2 — Implement task-by-task.** It worked through the numbered tasks
(WorktreeSpawnDialog callbacks → useSessionActions `placeholderCwd` → useMessageHandler
clear logic → App.tsx `pendingSpawnsRef` + `addSpawningCwd` → SessionList props),
marking `tasks.md` boxes as it went. New callbacks were made **optional**
(`onSpawnStart?`/`onSpawnAbort?`) to preserve back-compat.

**Phase 3 — Verify.** Narrow tests first (71 passing), then the full suite surfaced
19 failures. The AI **triaged** them: 17 were pre-existing `image-fit` jimp-import
failures, 1 was a `doctor-route` parallelism flake (passed in isolation via
`git stash` + isolated run), and exactly 1 was a legitimate contract change from its
diff — an assertion that needed `placeholderCwd` added. It fixed only that one. Then
build + restart the live server.

**Phase 4 — Archive & sync.** The AI compared delta specs against main specs, then
delegated the sync to a `general-purpose` subagent (per the skill), and archived to a
dated folder. It noted a **pre-existing** validator quirk (missing `## Purpose`) and
declined to "fix" it since it wasn't introduced by this change.

**Phase 5 — PR, CodeRabbit, merge.** Committed, pushed, opened PR #88 vs `develop`,
polled CI to green. CodeRabbit raised 4 comments; the AI triaged each with a verdict
(fix / defer / reject), fixed the one valid one, replied on every thread, and looped
CI green again. After the human merged, the AI finished the cleanup manually.

**Decision points the human owned:** advancing each gate (archive, PR, merge) and the
"is CodeRabbit done?" checks — the AI never auto-merged.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-worktree-spawn-placeholder-card`.
  Effective because the skill + a well-formed OpenSpec change carry all the context;
  the AI needs no restatement. *Stronger version for a future run:* add the intended
  end-state up front — "apply, verify, archive, PR to develop, and stop before merge"
  — so the whole arc is one prompt instead of five.
- **High-leverage follow-ups** (each unlocked a whole gate):
  - `commit, push, create PR and monitor CI` — one line drove the entire git+gh
    sequence and a CI polling loop.
  - `coderabbit is ready?` / `Is there anythin ing CodeRabbit have to fix?` — pulled
    the AI into a full comment-by-comment triage with verdicts.
  - `merge PR and cleanup branch, worktree` — triggered squash-merge + full worktree
    teardown.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after "implementation complete" | `/skill:openspec-archive-change …` to advance the gate | State the full arc (apply→archive→PR→merge) in the first prompt |
| Pause after CI green, waiting | `commit, push, create PR and monitor CI` | Say "carry through to an open PR on develop, then stop" |
| Report CodeRabbit "still running" and wait | `coderabbit is ready?` | Ask it to *watch* CodeRabbit and triage automatically once posted |
| Ask before merging | `merge PR and cleanup branch, worktree` | Keep this manual — merge should stay a human decision |
| Accept every CodeRabbit comment as work | (implicitly) the surgical-changes rule | Instruct: "triage each — fix in-scope, defer pre-existing, reject false positives with a reason" |

The recurring quality bar the human imposed by cadence: **don't scope-creep**. The AI
correctly declined 3 of 4 CodeRabbit comments (2 pre-existing `Set<cwd>` design
limits, 1 false positive on the archive path) and fixed only the 1 that its own diff
introduced.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session **rode existing skills** end-to-end:
`openspec-apply-change`, `openspec-archive-change` (which delegates spec-sync to a
subagent), and the PR/CI/CodeRabbit ship flow.

**Recommended skill to create** (the workflow is clearly repeatable): a single
**`ship-openspec-change`** orchestrator that chains apply → verify → archive+sync →
commit/push/PR → CI-watch → CodeRabbit-triage → merge+worktree-cleanup, with the
human confirmation gate parked only at merge. This repo in fact already ships
`ship-change`/`ship-it` skills that cover most of this arc — next time, invoke those
instead of driving each gate by hand. That collapses the six manual prompts into one.

## 7. Pitfalls & dead ends

- **Full-suite noise drowns your one real failure.** 19 failures looked alarming; 18
  were pre-existing (`image-fit` jimp imports, a `doctor-route` parallelism flake).
  *Fix:* isolate — `git stash` + run the suspect test alone to prove it's not yours.
  Only touch assertions your diff actually broke.
- **`gh pr merge --delete-branch` cleanup fails inside a worktree.** The merge
  succeeds but the local teardown errors. *Fix:* run cleanup manually from the **main
  repo** — `git worktree remove .worktrees/<name>`, then `git branch -D <name>`, then
  delete the remote branch.
- **Incidental `.pi/settings.json` rewrite.** A relative→absolute path auto-rewrite
  crept into the diff. *Fix:* `git checkout .pi/settings.json` before committing.
- **Archived `tasks.md` under `archive/` triggers a CodeRabbit "Major".** False
  positive — the "never nest under archive/" rule targets *creating* change artifacts,
  not archived ones. Reply and skip.
- **Local `develop` stays behind after a squash-merge in a worktree.** Remember to
  `git pull` in the main repo afterward.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a well-formed OpenSpec change with proposal/specs/tasks; a
running local dashboard (for build+restart verify); `gh` authenticated; CodeRabbit
enabled on the repo; base branch `develop`.

- [ ] `/skill:openspec-apply-change <change>` (from inside the worktree)
- [ ] Grep all wiring sites + read existing tests before editing
- [ ] Implement task-by-task, tick `tasks.md`, `npm run lint` typecheck
- [ ] Narrow tests → full suite; fix only assertions **your** diff broke; isolate flakes
- [ ] `npm run build` + `POST /api/restart`; revert stray `.pi/settings.json`
- [ ] `/skill:openspec-archive-change <change>` (subagent syncs delta specs)
- [ ] `commit, push, create PR and monitor CI` (base `develop`; poll `gh pr checks`)
- [ ] Triage each CodeRabbit comment: fix in-scope, defer pre-existing, reject false positives with a reply
- [ ] `merge PR` (human gate) → **manual** worktree + branch cleanup from the main repo → `git pull` develop

**Artifacts produced:** PR #88 (merged to `develop`); edits across
`WorktreeSpawnDialog.tsx`, `useSessionActions.ts`, `useMessageHandler.ts`, `App.tsx`,
`SessionList.tsx` + 4 test files; archived change at
`openspec/changes/archive/2026-06-07-add-worktree-spawn-placeholder-card/`; synced main
specs `placeholder-spawn-card` + `worktree-spawn-dialog`.

---

_Generated from session `019ea14f-b9b5-7d47-b888-12b72edf5dee` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-07. Source extract: `/tmp/facts-64609-25191.md`._
