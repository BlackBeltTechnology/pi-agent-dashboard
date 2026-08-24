---
session: 019f58c8
week: 2026/W29
type: planning
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies)"
upgrade_status: pending
openspec_changes: [copy-file-path]
proposal_excerpt: "The editor pane's file-tree rail (`EditorFileTree`) lets a user browse the session cwd and open files, but offers no way to lift a file's path out of the UI. Copying a path is a constant need — pasting it into the…"
---

# How we did it: `copy-file-path` — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command: `/skill:openspec-apply-change copy-file-path`.
The *real* objective, once the change's proposal was read, was to **implement a
hover-revealed copy-path popup on every row of the editor's file-tree rail**
(`EditorFileTree`) — Copy full path / relative path / file name, for both files and
directories — then **ship it end-to-end**: TDD the component, sync the delta spec into
the main spec, archive the change, open a PR against `develop`, survive CI + CodeRabbit,
and clean up the worktree. Two short steering prompts turned the single "apply" command
into a full apply→ship pipeline across an isolated git worktree.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — let the skill resolve the change, read
   the proposal + delta spec + `contextFiles`, and print the task list.
2. **TDD first**: add the failing test suite to the existing component test file, run it
   scoped (`HOME=$(mktemp -d) npx vitest run <one test file>`), confirm the new cases
   fail, *then* implement.
3. Build the component surgically — reserve layout space so the new glyph never overlaps
   the row label; use `stopPropagation` on the glyph so clicking it never opens the file.
4. Guard the browser API: `navigator.clipboard?.writeText(...)` and **swallow the async
   promise rejection** (permission denied) so failure is silent per spec.
5. Update the checkboxes in `tasks.md`, the source-tree `AGENTS.md` row, and run
   `openspec validate <change> --strict`.
6. Prove pre-existing test noise is not yours: **stash your change and re-run the failing
   files on base**; if they fail identically, they're environmental. Confirm the missing
   dep (`node -e "require('jimp')"`) and that `develop` CI is green.
7. `ship-change`: sync delta → main spec, `git mv` the change into
   `openspec/changes/archive/<date>-<change>/`, commit via a **message file** (avoids
   backtick issues), push, open the PR.
8. Watch CI to completion; **verify CodeRabbit did a real review, not a rate-limit ACK**
   ("Review limit reached, next review in N minutes") — if ACK, wait then
   `@coderabbitai full review`.
9. Apply actionable threads, re-run your scoped test, push; wait for CI green + threads
   non-actionable, then `gh pr merge --squash --delete-branch`.
10. Expect the **worktree collision** on merge (gh can't switch the parent's `develop`);
    verify the merge landed on GitHub, then delete the remote branch, `git branch -D`,
    and remove the worktree **from the parent checkout** (the session cwd is now gone).

## 3. How the collaboration unfolded

**Discovery.** The skill resolved the change (`copy-file-path`, state `ready`, 0/8 tasks),
read the proposal, delta spec, and context files, and inspected the target
`EditorFileTree.tsx`, its `AGENTS.md` row, and available mdi icons. *Why it worked:*
grounding in the actual spec + component before writing a line kept the change surgical.

**Build (TDD).** The AI added 10 failing test cases (glyph reveal, popup without opening
the file, full/relative/name copies, directory copy, outside-click / Escape / rail-scroll
dismiss, clipboard-undefined no-op), confirmed they fail, then implemented
`RowCopyAffordance` — an anchored popup that flips above near the rail bottom via a
`data-file-rail` marker, with `stopPropagation` so the glyph never opens the file. All 12
tests green. *Decision point:* the AI noticed an unused `name` prop and removed it to stay
surgical.

**Verify.** `tsc` surfaced one error — traced to a **pre-existing** `qa/fixtures`
rootDir issue the change never touched, confirmed by checking the base. The live-browser
task (2.3) couldn't run truthfully: the port-8000 dashboard serves the *parent* build, not
this worktree's changed component, so a real isolated instance would be needed. Everything
automatable was completed first.

**Ship gate.** The full suite showed 17–19 fluctuating failures. The AI didn't panic:
it **stashed the change and re-ran the failing files on base** (they failed identically),
proved the cause was a missing `jimp` in *this worktree's* `node_modules`
(`Jimp is not a constructor`), and confirmed `develop`'s CI was green. Build passed. It
then synced the delta into the main spec, archived the change, committed via a message
file, pushed, and opened PR #293.

**CI + CodeRabbit loop.** CI passed (10m14s). CodeRabbit's first "pass" was a **rate-limit
ACK**, not a review — the AI waited, requested `@coderabbitai full review`, then got 2
actionable threads: a Major async-rejection bug and a Minor proposal contradiction. Both
fixed, re-tested, pushed. CI green again (9m57s); both threads went non-actionable.

**Merge + cleanup.** `gh pr merge --squash --delete-branch` hit the known **worktree
collision** (gh tried to check out `develop`, already live in the parent). The merge had
in fact landed (SHA `e5b0c52d`); only local cleanup failed. The AI deleted the remote
branch, `git branch -D`'d the local branch, and removed the worktree from the parent
checkout — noting the session cwd was now gone, so shells had to start elsewhere.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change copy-file-path`. Effective because
  the change already existed with a proposal, delta spec, and a task list; the slash
  command let the skill do the resolution and planning. A stronger kickoff states the ship
  intent too: *"apply copy-file-path, then ship it to a PR against develop."*
- **High-leverage follow-up #1** — *"The worktree may not contain the opsx skill. In this
  case use the worktree's parent to check for the skill."* One sentence that unblocked skill
  resolution in an isolated worktree — a reusable rule, not a one-off.
- **High-leverage follow-up #2** — `ship-change`. A single word that handed off the entire
  archive→PR→CI→CodeRabbit→merge→cleanup pipeline to the ship skill.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Look for the OpenSpec skill only inside the worktree | "use the worktree's parent to check for skill" | Stating up front: in a worktree, resolve OpenSpec skills from the main repo root |
| Stop at "apply" once tasks were done | Follow-up `ship-change` | Kick off with the full intent: "apply **and ship**" |
| Treat a full-suite failure count as a blocker | (self-corrected) stash-on-base comparison | Rule: never trust a worktree's flaky suite — diff failures against base + check `develop` CI |
| Accept CodeRabbit's first "pass" as a review | (self-corrected via skill pitfall) | Always confirm it's not a "Review limit reached" ACK before trusting green |

## 6. Skills, tools & memory created — and why they're effective

- **Memory (attempted)** — the AI tried to record a worktree gotcha: *in
  `.worktrees/os-*`, `npm test` shows ~17–19 flaky failures in `src/__tests__/`
  (`Jimp is not a constructor` / `JimpMime` undefined) because `jimp` isn't installed in
  the worktree's `node_modules`; CI's clean `npm ci` is the authoritative gate.* The store
  was full so the write was skipped — but this is **exactly the memory worth keeping**: it
  turns a 10-command investigation into a one-line "known noise, ignore" next time.
- **No skill created**, but the workflow is clearly repeatable. The recommended skill:
  *"triage-worktree-flaky-tests"* — stash change → re-run failing files on base → confirm
  a missing dep → check `develop` CI → proceed. That five-step dance recurred throughout
  the ship gate and deserves codifying.

## 7. Pitfalls & dead ends

- **Worktree missing the OpenSpec skill** → resolve it from the worktree's parent repo root.
- **Flaky `src/__tests__/` failures (17–19, jimp)** → not your change; stash + re-run on
  base, confirm `require('jimp')` fails locally, trust `develop` CI.
- **Pre-existing `tsc` error in `qa/fixtures`** → confirm it exists on base before treating
  it as yours.
- **`tee` log collapsed by `\r` progress rewrites** → strip ANSI/CR
  (`perl -pe 's/\e\[[0-9;]*m//g'`) or run the single failing file scoped instead of parsing
  the mega-log.
- **Live-browser task can't verify the worktree** on the port-8000 instance (it serves the
  parent build) → needs a separate isolated instance; don't fake the check.
- **CodeRabbit rate-limit ACK** masquerading as a passing review → wait, then
  `@coderabbitai full review`.
- **`git commit` with backticks in the message** → use a message file (`-F`).
- **`gh pr merge --delete-branch` worktree collision** → merge still lands; verify on
  GitHub, then clean the branch + worktree manually from the parent checkout.
- **Session cwd removed after worktree deletion** → subsequent shells must start in a valid
  directory (the parent repo).

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an existing OpenSpec change with proposal + delta spec + task
list; a git worktree checked out for it; `gh` authenticated; the parent repo available for
skill resolution.

- [ ] `/skill:openspec-apply-change <change>` (resolve skills from the parent if the
      worktree lacks them)
- [ ] Add failing tests to the component's existing test file; confirm red; implement;
      confirm 12/12 green
- [ ] Guard `navigator.clipboard?.writeText` and swallow its async rejection
- [ ] Check boxes in `tasks.md`, update the `AGENTS.md` row, `openspec validate --strict`
- [ ] Stash + re-run any failing suite files on base; confirm environmental; check
      `develop` CI is green
- [ ] `ship-change`: sync delta → main spec, `git mv` to
      `openspec/changes/archive/<date>-<change>/`, commit via message file, push, open PR
- [ ] Watch CI; confirm CodeRabbit did a real review; apply threads; re-test; push
- [ ] CI green + threads non-actionable → `gh pr merge --squash --delete-branch`
- [ ] Verify merge landed; delete remote branch, `git branch -D`, remove worktree from the
      parent

**Final artifacts:** PR #293 (merged, SHA `e5b0c52d`) into `develop`;
`packages/client/src/components/editor-pane/EditorFileTree.tsx` (+ `RowCopyAffordance`) and
its test suite; `openspec/specs/internal-monaco-editor-pane/spec.md` (synced);
`openspec/changes/archive/2026-07-13-copy-file-path/`.

---

_Generated from session `019f58c8-1ec8-75b8-b45b-5cccc755d312` · `pi-agent-dashboard` · 2026-07-13. Source extract: `/tmp/facts-1784846985N.md`._
