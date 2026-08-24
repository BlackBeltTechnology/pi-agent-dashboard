---
session: 019ec6b5
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [fix-popover-viewport-flip]
proposal_excerpt: "The `⚙ View` popover (`ChatViewMenu`) opens off the bottom of the screen: its lower rows (\"Use global settings\", the tool-call toggles) render past the viewport edge and are unreachable. The menu lives in the bott…"
---

# How we did it: fix-popover-viewport-flip — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command: **`/skill:openspec-apply-change fix-popover-viewport-flip`**.

There was no prose brief — the intent lived entirely in the OpenSpec change already on
disk. The real objective, once the change context was read: the `⚙ View` popover
(`ChatViewMenu`) opens off the bottom of the screen and its lower rows are unreachable.
Fix it by making viewport-anchored popovers **flip up and clamp their height** to stay
on-screen, do it via a **shared reusable hook** (not another hand-rolled one-off), and
apply the same fix to every other latent-risk down-opening popover in the client — all
under TDD, then archive, PR, merge, and clean up the worktree.

## 2. TL;DR playbook

1. **Kick off from the change, not a prose brief:** `/skill:openspec-apply-change <change-name>` — the skill reads `tasks.md` + proposal and drives the work.
2. **Read the existing hand-rolled popovers first** to steal conventions before writing anything. Match the codebase, don't invent.
3. **TDD each task red→green:** write the failing hook test, implement `usePopoverFlip.ts`, then adopt it component-by-component with a flip test each.
4. **Static-analysis sweep for latent duplicates:** grep for `top-full` / `bottom-full` / `max-h-` with no cap in scroll containers; adopt the hook everywhere, but **skip dead components** (grep for actual render sites first).
5. **Run only the affected client tests + `tsc --noEmit`** as you go; treat pre-existing failures in *other* workspaces as noise, confirm the client workspace is fully green.
6. **Build + restart, then verify visually** — but know which instance the browser hits (see §7: the running `:8000` served the main repo, not the worktree bundle).
7. **Sync delta specs → main specs.** If the delegated sync subagent hangs, do it inline (edit the MODIFIED requirement, create the ADDED main spec by stripping the delta header), then `openspec validate`.
8. **Archive → commit (excluding unrelated local artifacts) → `gh pr create` → watch CI → merge → delete branch + worktree.**

## 3. How the collaboration unfolded

**Phase 1 — Discovery & context load.** The AI opened the change's `tasks.md`, proposal,
and the *existing* hand-rolled flip components + a sample hook test to learn conventions
before writing a line. Why it worked: grounding in current patterns kept the new hook
idiomatic and the tests shaped to existing scaffolding.

**Phase 2 — TDD the shared primitive.** Red test for `usePopoverFlip` (module absent), then
implemented the hook: measure trigger rect on open + on passive `resize`/`scroll`, return
`{ flipUp, maxHeight }`, default down, flip up when below-space is short and above-space is
larger, floor `maxHeight` at 120, guard `typeof window`. 6 unit tests. Then adopted it in
`ChatViewMenu` (the actual bug) with its own flip test.

**Phase 3 — Latent-risk sweep.** Static analysis found four more down-openers
(`WorktreeActionsMenu`, `PackageRow`, `ThemePicker`, `OpenSpecGroupPicker`). Decision point:
the AI grepped for render sites and found `OpenSpecGroupPicker` is **dead code** — defined
but never rendered — so it **skipped** it. The other three got the hook + flip tests. It also
retired duplication by refactoring `ModelSelector`, `ThinkingLevelSelector`, and `CommandInput`
onto the same hook.

**Phase 4 — Verify.** Client workspace fully green (2427 passed); `tsc --noEmit` clean for the
touched files. Build + restart, then browser screenshot — which appeared to still show the bug
(decision point, see §7).

**Phase 5 — Sync & archive.** Steering turn `sync stucked`: the delegated `openspec-sync-specs`
subagent hung, so the AI synced inline (MODIFIED `chat-display-preferences`, ADDED
`popover-viewport-positioning`), validated, and archived.

**Phase 6 — Ship & clean up.** Steering `commit, create PR an monitor CI`: staged only
change-related files (excluded an unrelated `.pi/settings.json` path tweak), committed, PR #120,
watched CI to green (lint + test + build + CodeRabbit). Steering `merge PR, delete branch and
worktree`: merged squash; the one-shot `gh pr merge --delete-branch` partially failed (running
from inside a sibling worktree), so it finished branch + worktree deletion manually.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change fix-popover-viewport-flip`.** Effective
  because the spec work was already done: the change artifact carried the full intent, so one
  command launched a disciplined TDD run. Lesson: invest in the OpenSpec change up front and the
  kickoff is one line.
- **`sync stucked`** (high-leverage, 2 words) — unblocked a hung subagent. It told the AI "stop
  waiting, do it yourself," which flipped delegation → inline execution.
- **`commit, create PR an monitor CI`** — a compact multi-step directive that the AI expanded into
  stage→commit→push→PR→watch. Works because each verb is unambiguous.
- **`merge PR, delete branch and worktree`** — clean terminal instruction; the AI handled the
  worktree-checkout edge case without further prompting.

Stronger rewrite of the goal prompt for a cold start (no change yet):
> "Popovers anchored near the viewport bottom clip off-screen. Create an OpenSpec change to add a
> shared `usePopoverFlip` hook that flips up + clamps height, adopt it in every down-opening
> popover that sits in a scroll container (skip dead components), TDD each, then apply."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Wait on a delegated subagent that had hung | "sync stucked" | Add a timeout/liveness check on delegated subagents; fall back to inline after N minutes |
| Stop at "implementation done" | "commit, create PR an monitor CI" | Fold commit→PR→CI-watch into the apply-change definition of done |
| Leave the merged branch/worktree in place | "merge PR, delete branch and worktree" | Treat merge + branch + worktree teardown as the final apply step |

Quality bars the run imposed on itself (worth stating up front): TDD red→green per task; adopt a
**shared** hook rather than another one-off; verify render sites before "fixing" a component;
exclude unrelated local artifacts from the commit; distinguish real CI failures from stale
`node_modules` noise.

## 6. Skills, tools & memory created — and why they're effective

No new pi skill or saved memory was created this session. Two subagents were spawned
(`general-purpose`): one to add file-index rows for the new files, one to sync the delta specs
(the latter hung — see §7).

The clearly-reusable artifact is the **`usePopoverFlip` hook itself** — a single primitive that
retired three separate hand-rolled flip implementations and covers every viewport-anchored
popover. Recommended skill to create for next time: **"adopt-shared-popover-flip"** — grep for
`top-full|bottom-full|max-h-` in scroll containers, filter to components with real render sites,
and wire each onto `usePopoverFlip` with a flip test. That would make this whole latent-risk
sweep a repeatable one-command move instead of manual grepping.

## 7. Pitfalls & dead ends

- **Browser verified the wrong instance.** The running dashboard on `:8000` served the **main
  repo checkout** (bundle `index-BdZV45bU.js`), not the worktree build (`index-BV3tD2TB.js`). The
  screenshot showed the *pre-fix* bug and looked like a failure. **If a visual check still shows
  the bug, confirm the served bundle hash matches your worktree build before believing it** —
  grep your marker string into the served bundle.
- **Delegated sync subagent hung.** `openspec-sync-specs` via subagent never returned. **If a
  delegated sync stalls, do it inline:** edit the MODIFIED requirement in the main spec, create
  the ADDED main spec by stripping the `## ADDED Requirements` delta header, then `openspec validate`.
- **Local `tsc`/Jimp errors were fake.** The `pi-image-fit` type errors seen locally were a
  stale-`node_modules` artifact; CI's `npm ci` + lint gate was clean. **Don't chase pre-existing
  failures in other workspaces — confirm your own workspace is green and trust CI.**
- **`gh pr merge --delete-branch` fails from inside a sibling worktree** because `gh` tries to
  switch the local branch to `develop`, which is checked out in the main worktree. **The merge
  still succeeds server-side; finish branch + worktree deletion manually from the main repo.**
- **Unrelated `.pi/settings.json` edit** kept showing in `git status`. **Explicitly `git reset --`
  it before commit** so environment artifacts never leak into the change.
- Minor: an edit attempt included an invalid `comment` field and had to be retried — match the
  edit tool schema exactly.

## 8. Reproduce it faster — checklist

- [ ] A well-formed OpenSpec change on disk (`tasks.md` + proposal) → kick off with `/skill:openspec-apply-change <name>`.
- [ ] Read existing hand-rolled popovers first; steal conventions.
- [ ] TDD the shared hook red→green (`usePopoverFlip.ts` + unit tests).
- [ ] Adopt in the buggy component, then grep `top-full|bottom-full|max-h-` for latent duplicates; **skip dead components** (check render sites).
- [ ] Run affected client tests + `tsc --noEmit`; confirm the client workspace is green, ignore other-workspace noise.
- [ ] Build + restart; when verifying in-browser, **match the served bundle hash to your worktree build**.
- [ ] Sync delta specs → main; if the subagent hangs, do it inline, then `openspec validate`.
- [ ] Archive → commit (exclude local artifacts) → `gh pr create` → watch CI green → merge → delete branch + worktree (manually if inside a sibling worktree).

**Key inputs to have ready:** the OpenSpec change directory; a running dashboard (and awareness of *which* checkout it serves); `gh` authenticated. **Final artifacts:** `usePopoverFlip.ts` + tests, `ChatViewMenu`/`ThemePicker`/`PackageRow`/`WorktreeActionsMenu`/`ModelSelector`/`ThinkingLevelSelector`/`CommandInput` adoptions, `openspec/specs/popover-viewport-positioning/spec.md`, updated `chat-display-preferences` spec, archived change, PR #120 (merged at `f2f725a`).

---

_Generated from session `019ec6b5-a88c-78f8-878a-11f10f97b8b4` · `pi-agent-dashboard` · 2026-06-14. Source extract: session-to-guideline facts sheet._
