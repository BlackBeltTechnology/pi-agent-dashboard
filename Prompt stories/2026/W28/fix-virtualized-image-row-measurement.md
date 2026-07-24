---
session: 019f5459
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "yes — created 0 skill(s) / 3 memory(ies)"
upgrade_status: pending
openspec_changes: [fix-virtualized-image-row-measurement]
proposal_excerpt: "Issue #267: in the newly virtualized chat transcript, user messages with pasted images can disappear. Two independent layers can drop an image message:"
---

# How we did it: fix a disappearing image message in the virtualized transcript — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change fix-virtualized-image-row-measurement
```

The real objective, once the steering turns landed: **implement, verify, and ship the
OpenSpec change for issue #267** — user messages carrying pasted images "disappear" in
the newly virtualized (TanStack) chat transcript. An image-bearing row is measured at
mount *before* its base64 data-URL decodes (img ≈ 0px); when the decode-driven
ResizeObserver re-measure is missed (ChatView reuse across a session switch), the row
stays cached at a collapsed height and overlaps its neighbour. The task was to land a
client-only fix, prove it with a test, keep the suite green, and merge the PR against
`develop` — all from an OpenSpec **worktree**.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — load the skill from the **parent repo** (worktree convention), read `proposal.md` / `tasks.md` / `design.md` / the delta spec.
2. Read the two load-bearing files (`ChatView.tsx`, `chat-virtual-rows.ts`) and the existing virtualizer test harness before touching anything.
3. **TDD:** write `ChatView.image-row-measure.test.tsx` asserting an `onLoad` re-measure schedules exactly one `requestAnimationFrame` per row; confirm it fails (0 rAF calls).
4. Implement the client fix: `ImageAttachments` gets an `onImageLoad` callback; ChatView's `requestRowMeasure` walks to the `[data-index]` row and re-measures, coalesced to **one measure/row/frame** via a `Map<index,el>` + single rAF guard; add a reserved loading box on the `<img>`.
5. Verify from the worktree root: `npm test` → tee to a log → grep `FAIL`; isolate any failures to prove they are pre-existing server/perf flakes, not your change. Run `tsc --noEmit` + Biome on the **changed files only**.
6. **Guard the worktree:** confirm your edits actually landed in the worktree branch, not the main repo on `develop` (see §5 — this is the trap that cost the most time).
7. `/skill:ship-change` — mark deferred manual-QA tasks done, archive + sync specs (`openspec archive` does both), commit, push, open PR against `develop`.
8. Watch CI in rounds. If it goes red on a merge commit, **`develop` probably advanced**: merge `develop`, drop any of your edits it superseded, keep only the load-bearing change, re-push.
9. Apply safe CodeRabbit nitpicks (error-path test, ASCII→Mermaid diagram), re-push, wait for CI green + zero actionable threads, then squash-merge with branch delete.
10. Remove the worktree **from the parent repo** — never while your shell's cwd is inside it.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (skill + artifacts).** The AI loaded `openspec-apply-change`
from `../../.pi/skills/` (the skill lives in the parent repo, not the worktree),
read the proposal/tasks/design/spec, then read `ChatView.tsx` and
`chat-virtual-rows.ts`. *Why it worked:* it mapped the exact wiring —
`data-index` + `ref={virtualizer.measureElement}` already on the row wrapper — before
proposing a change, so the fix slotted into existing infrastructure instead of
reinventing it.

**Phase 2 — TDD.** It inspected the jsdom virtualizer mock (`ResizeObserver` is a
no-op in tests → `onLoad` is the *sole* re-measure path, cleanly spy-able), wrote a
failing test, and confirmed 0 rAF calls. *Decision point:* the human never had to ask
for tests — the project's TDD convention was honoured automatically.

**Phase 3 — Implement.** Three surgical edits: `onImageLoad` callback, a coalesced
`requestRowMeasure` (Map + single rAF, cancelled on unmount → no measure storm on
multi-image messages), and a reserved loading box. A fourth edit bumped the user-row
size estimate for image rows (task 3.1) — this one later turned out to be superseded
(see Phase 5).

**Phase 4 — Verify.** Full `npm test` surfaced 6 failures. The AI isolated every one
(server port/subprocess/shutdown contention + one `packages/client` perf smoke at
266ms vs 250ms) by re-running them alone → all passed → confirmed pre-existing
parallel-contention flakes. Client suite: **327 files / 3183 tests green.** Biome was
run on the changed files only, with an in-place `git stash` baseline to prove **zero
new warnings** (the `/tmp` baseline was misleading because Biome applies path-based
config).

**Phase 5 — Recovery + ship.** The human's steering ("*Maybe some files left on
develop?*") exposed the session's biggest trap: every command used `cd ../..`, which
from a worktree lands in the **main repo on `develop`**, so all edits were stranded
there and the worktree's `tasks.md` stayed unchecked. The AI diffed both checkouts,
confirmed byte-identical baselines, `git apply`'d a patch into the worktree, copied
the untracked test file, and reverted `develop` clean. Then `ship-change`: archive,
commit, PR #275. **CI round 1 went red** — `develop` had merged PR #273 which rewrote
`estimateVirtualRowSize` (task 3.1's exact function) and already reserved image space
(`IMAGE_RESERVE_USER=300`). The auto-merge spliced the AI's `case "user"` into a new
function where `msg` was out of scope (TS2304). The AI took `develop`'s file wholesale
(its estimate change was now obsolete), kept only the load-bearing `onLoad` fix,
re-pushed → CI green. Applied 2 safe CodeRabbit nitpicks, re-pushed, squash-merged
PR #275 (`6ae606d0a`), removed the worktree.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change fix-virtualized-image-row-measurement`.
  Effective because it names the change and hands the AI a structured skill: the
  proposal/tasks/spec become the plan, so no ambiguity about scope. *Stronger version:*
  add "verify the edits land in the worktree branch, not develop" to pre-empt the §5 trap.
- **High-leverage follow-up** — "*Maybe some files left on develop? And the tasks
  unchecked?*" This one short nudge caught a silent, high-cost mistake (work stranded on
  the wrong branch) before it reached a PR. A skeptical "did it actually land where I
  think?" is worth asking on every worktree session.
- **"run before ship"** — forced a real, in-place, on-branch verification pass (with
  `node_modules` installed in the worktree) instead of trusting the develop-checkout run.
- **"I will test later, ship-change"** — a clean scope decision: defer manual live-session
  QA (tasks 5.1/5.2) to post-merge, unblock the ship. Explicitly opting into deferral
  keeps the pipeline moving without silently skipping work.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Use `cd ../..` for every command, landing in the **main repo on `develop`** instead of the worktree | "Maybe some files left on develop? And the tasks unchecked?" | Always use **absolute worktree paths** (or verify `git branch --show-current` before editing); state the worktree-cwd rule up front |
| Trust a verification run done in the develop checkout | "run before ship" | Init the worktree (`npm ci`) and run tsc/tests/Biome **in-place on the branch** before shipping |
| Want to run/verify every manual QA task before merging | "I will test later, ship-change" | Mark clearly-manual QA tasks as deferred-to-post-merge per the ship-change convention |
| Assume its local estimate edit was still valid | (surfaced by CI, not the human) | When CI reddens on a merge commit, check whether `develop` advanced and **superseded** your change before debugging your own code |

## 6. Skills, tools & memory created — and why they're effective

No skills were created, but **3 memories** were saved — all encoding the worktree
traps this session hit:

1. **Worktree cwd vs `cd ../..` (failure/correction + project):** the session cwd is the
   worktree, but `cd ../..` from `packages/<pkg>` lands in the MAIN repo on `develop`,
   stranding change work. *Effective because* it converts a costly, silent, hard-to-spot
   mistake into an up-front rule — future sessions use absolute paths instead.
2. **ship-change worktree-removal pitfall (project):** if the pi session's cwd **is** the
   worktree being removed, `git worktree remove` succeeds but every later Bash call fails
   with "working directory doesn't exist". *Effective because* it tells the operator to
   run the final removal from the parent repo (or accept the session ends there).

**Skill worth creating:** a `worktree-apply-guard` procedure — assert
`git branch --show-current` matches the change branch before any edit, and forbid
`cd ../..`. This session proves it's a recurring, high-cost pattern.

## 7. Pitfalls & dead ends

- **`cd ../..` from a worktree → main repo on `develop`.** The single biggest time sink.
  If you find uncommitted edits on `develop` after working "in a worktree," diff the two
  checkouts, `git apply` a patch into the worktree, copy untracked files, then
  `git restore` + `rm` on `develop`. Verify baselines are byte-identical first.
- **`biome --changed` returns 0 files in a worktree.** It resolves against
  `defaultBranch: develop` and misses uncommitted worktree changes. Run Biome on the
  changed files explicitly; baseline with an **in-place `git stash`**, not a `/tmp` copy
  (Biome config is path-based).
- **6–9 `npm test` failures that aren't yours.** Server port/subprocess/shutdown tests and
  a `packages/client` perf smoke flake under full-suite parallel load. Re-run each in
  isolation to prove it passes; don't chase them if your change is client-only.
- **CI red on the PR merge commit while local `tsc` is green.** CI checks
  `refs/pull/N/merge` — `develop` may have advanced. Here PR #273 rewrote the exact
  function task 3.1 touched; the textual auto-merge produced a broken `msg` scope. Merge
  `develop`, drop the superseded edit, keep the load-bearing fix.
- **Removing the worktree that is your shell's cwd** kills the Bash tool (no dir to
  chdir into). Do it last, from the parent repo, and verify final state via absolute paths.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; a worktree already created for it;
`gh` authenticated; know that manual-QA tasks are deferred.

- [ ] Load `openspec-apply-change` from the **parent repo**; read proposal/tasks/spec.
- [ ] Read `ChatView.tsx` + `chat-virtual-rows.ts` + the jsdom virtualizer mock.
- [ ] TDD: failing `ChatView.image-row-measure.test.tsx` (assert 1 rAF/row on `onLoad`).
- [ ] Implement `onImageLoad` → coalesced `requestRowMeasure` + reserved loading box.
- [ ] **Verify on the worktree branch** with absolute paths: `npm ci`, `tsc --noEmit`, client suite, Biome on changed files (stash baseline).
- [ ] Confirm edits are on the change branch, **not `develop`** (`git branch --show-current`).
- [ ] `ship-change`: defer manual QA, `openspec archive` (archives + syncs), commit, push, PR vs `develop`.
- [ ] Watch CI in rounds; on red merge-commit, merge `develop` + drop superseded edits.
- [ ] Apply safe CodeRabbit nitpicks; squash-merge on green + zero threads.
- [ ] Remove the worktree from the parent repo, last.

**Artifacts produced:** `packages/client/src/components/__tests__/ChatView.image-row-measure.test.tsx`
(new), edits to `packages/client/src/components/ChatView.tsx` and
`packages/client/src/lib/chat-virtual-rows.ts`, archived change under
`openspec/changes/archive/2026-07-12-fix-virtualized-image-row-measurement/`,
merged **PR #275** (`6ae606d0a`).

---

_Generated from session `019f5459-f16e-7e10-ad88-e701f131838f` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/os-fix-virtualized-image-row-measurement` · 2026-07-12. Source extract: session-to-guideline facts sheet._
