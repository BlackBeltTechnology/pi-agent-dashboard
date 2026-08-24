---
session: 019eec13
week: 2026/W25
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-automation-slot-parity-and-routing]
proposal_excerpt: "The sidebar **Automations** row (added by `add-automation-plugin`) does not match the **OPENSPEC** row beside it, and its link is dead:"
---

# How we did it: Fix Automation slot parity & routing — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change fix-automation-slot-parity-and-routing`. The real objective — read from the attached proposal — was to make the sidebar **Automations** row visually match the **OPENSPEC** row next to it and, critically, fix its dead link. In practice that meant re-homing the automation board from a stale `command-route /automation` claim onto a live per-folder route (`shell-overlay-route /folder/:encodedCwd/automations`), re-skinning `FolderAutomationSection` to the `FolderOpenSpecSection` anatomy, and carrying the whole change end-to-end through OpenSpec apply → archive → PR → CI → CodeRabbit → merge → cleanup.

## 2. TL;DR playbook

1. Launch inside the worktree: `/skill:openspec-apply-change <change-name>`. If the skill isn't found, tell the AI the OpenSpec skills live in the **parent** repo, not the worktree checkout.
2. Let the AI read the change's context files + the *reference* sibling component (here `FolderOpenSpecSection` / the run-monitor's `shell-overlay-route`) so it mirrors an existing, working pattern instead of inventing one.
3. Verify the real runtime contract before coding: the slot prop was `params`, not `routeParams` as the task text claimed — the AI checked `ShellOverlayRouteRender` in `dashboard-plugin-runtime` and adjusted.
4. Implement per task list; add a local `folder-encoding.ts` (base64url `encode/decodeFolderPath`) in the plugin because it can't import client internals.
5. Update the two affected test files, run just those (`npx vitest run …`), then the full suite; classify any failures as in-scope vs pre-existing/environmental (missing `canvas`, perf-timing smoke, server-integration timing).
6. Give the AI the finish line as a numbered checklist: mark manual task complete, archive+sync, PR to `develop`, monitor CI, fix CodeRabbit, merge, delete branch, delete worktree.
7. On CodeRabbit review, have the AI assess each thread against the code (valid/invalid + severity) before applying, then re-run affected tests, rebuild, push, and wait for CI on the **new** commit before merging.

## 3. How the collaboration unfolded

**Phase 1 — Locate the skill & orient (Discovery).** The apply skill wasn't resolvable from inside the worktree; a wide `find /` failed. The human's one-line steer ("opsx skills presented in worktree's parent dir") pointed the AI at the parent repo's `.pi/skills`. The AI then pulled `openspec status`/`instructions apply --json` to get the authoritative task list.

**Phase 2 — Read before writing (Gather).** The AI read the automation package.json, the reference `FolderOpenSpecSection`, and the run-monitor that already uses `shell-overlay-route`, plus grepped for `params`/`routeParams` and `@mdi` resolvability from the plugin. This is the phase that made the change correct: it grounded every edit in an existing working sibling.

**Phase 3 — Implement (Design/Generate).** Fifteen edits + four writes: new `folder-encoding.ts`, `AutomationBoard.tsx` now derives `cwd` from decoded `params.encodedCwd` and gets a Back button, `package.json` claim swapped to the live route, `FolderAutomationSection` re-skinned to match the OpenSpec row (uppercase label + count, `mdiArrowRight`, `mdiRefresh`, `flex-1` spacer).

**Phase 4 — Verify (Verify).** Ran the two touched test files in isolation (8/8), then `npm test`. The AI triaged the 14 failing files as pre-existing/environmental and confirmed **zero** automation failures — a clean "my scope is green" call rather than chasing unrelated red.

**Phase 5 — Ship (the human's 8-step checklist).** archive+sync → commit → push → PR #145 → poll CI → fetch CodeRabbit → assess & fix 3 Major issues → re-run tests → rebuild → push → wait for CI on the new SHA → squash-merge → delete remote branch → remove worktree. The human supplied the full sequence in one prompt; the AI executed it linearly.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change fix-automation-slot-parity-and-routing`. Effective because the proposal already encoded the *what* and the *why*; the skill invocation just aimed the AI at it. A future operator with a proposal should lead with the apply skill, not a prose re-description.
- **High-leverage steer #1** — "opsx skills presented in worktree's parent dir". Six words that unblocked the whole session; the AI had burned three `find` commands hunting the skill. Bake this into the kickoff instead.
- **High-leverage steer #2** — the explicit 8-step finish checklist ("1. mark complete 2. archive and sync 3. create a PR 4. Monitor CI 5. Fix coderabbit 6. merge 7. delete branch 8. delete worktree"). Turning "ship it" into an ordered, numbered list gave the AI an unambiguous runway and it executed all eight without further steering.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Hunt for the apply skill inside the worktree (wasted `find /` calls) | "opsx skills presented in worktree's parent dir" | State up front: OpenSpec skills resolve from the **main repo root**, not the checkout |
| Leave "ship" ambiguous after code was done | Hand it the explicit 8-step archive→merge→cleanup checklist | Provide the finish-line steps as a numbered list in the first ship prompt |
| Trust the task text's prop name (`routeParams`) | (self-corrected) verified `params` against `ShellOverlayRouteRender` | Note in tasks: confirm runtime slot props against `dashboard-plugin-runtime`, task text may drift |

Note: only three user prompts total — most of the quality came from the AI grounding itself in sibling code, not from heavy correction.

## 6. Skills, tools & memory created — and why they're effective

No skills or memories were created this session. One subagent was spawned:

- **`general-purpose` subagent — "Update file-index-plugins.md rows"**: isolates the docs-index update from the main coding context, honoring the repo's Documentation Update Protocol (docs writes delegated, caveman style). Reusable pattern: after a plugin's route/claim changes, delegate the doc-row refresh rather than editing docs inline.

Recommended skill to create: a **`ship-openspec-change`** playbook capturing the exact 8-step archive→PR→CI→CodeRabbit-assess→merge→worktree-cleanup sequence with the CodeRabbit per-thread assessment table — it was reconstructed by hand here and is clearly repeatable. (The repo now has `ship-change`/`ship-it` skills that cover this.)

## 7. Pitfalls & dead ends

- **Skill not found in worktree** → resolve OpenSpec skills from the parent repo root; don't `find /`.
- **Task text prop name was wrong** (`routeParams` vs runtime `params`) → verify slot props against `ShellOverlayRouteRender` in `dashboard-plugin-runtime` before coding.
- **`btoa`/`atob` throw on non-ASCII paths** → CodeRabbit caught this; use `TextEncoder`/`TextDecoder` for UTF-8-safe base64url. ASCII output is identical so no route-format breakage.
- **Full-suite red ≠ your bug** → 14 failing files were environmental (missing `canvas`/`jimp`, perf-timing smoke `345ms>250ms`, server-integration timing). Classify before chasing.
- **CI didn't re-fire on `synchronize` push** → the new-commit run lagged; wait it out and poll `gh run list` by SHA rather than assuming a stuck pipeline. Always wait for CI green on the **new** commit before merging.
- **Bash pinned to a deleted worktree dir** → after `git worktree remove`, the shell's cwd is gone; run the final branch-delete via a fresh process (the sandbox executor) instead.
- **`--delete-branch` on merge failed** (base `develop` checked out in main repo) → delete the remote branch explicitly, then remove the worktree.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name + proposal, a worktree at `.worktrees/<name>`, `gh` authenticated, the reference sibling component to mirror.

- [ ] `/skill:openspec-apply-change <name>` from the worktree; if skill missing, point at parent repo `.pi/skills`.
- [ ] Read the reference sibling + verify runtime slot props (`params` via `ShellOverlayRouteRender`).
- [ ] Implement; add plugin-local `folder-encoding.ts` (UTF-8-safe base64url) if the plugin can't import client internals.
- [ ] Run touched test files in isolation, then full suite; triage red as in-scope vs environmental.
- [ ] Ship (numbered): archive+sync → commit+push → PR to `develop` → poll CI → assess+fix CodeRabbit per-thread → re-test → rebuild → push → wait CI green on new SHA → squash-merge → delete remote branch → remove worktree.

**Artifacts produced:** `packages/automation-plugin/src/client/folder-encoding.ts`, `FolderAutomationSection.tsx`, `AutomationBoard.tsx` (edited), `package.json` claim swap, updated tests, archived change `2026-06-21-fix-automation-slot-parity-and-routing`, merged PR #145 (`d0bbccb7`).

---

_Generated from session `019eec13` · `pi-agent-dashboard/.worktrees/os-fix-automation-slot-parity-and-routing` · 2026-06-21. Source extract: session facts sheet._
