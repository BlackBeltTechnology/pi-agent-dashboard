---
session: 019ec570
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [fix-openspec-board-mobile-scroll]
proposal_excerpt: "On phone/tablet widths the full-page OpenSpec board (`/folder/:cwd/openspec`) clips its stacked columns and offers no way to scroll to content below the first viewport height. The board is effectively unusable past the first viewport height."
---

# How we did it: Fix the OpenSpec board mobile scroll — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with `/skill:openspec-apply-change fix-openspec-board-mobile-scroll`
— i.e. "implement the change we already scoped." The real objective, once the
proposal was in view, was narrow and concrete: at phone/tablet widths the full-page
OpenSpec board (`/folder/:cwd/openspec`) stacks its columns vertically but **clips
everything below the first viewport** with no way to scroll. Make the stacked board
vertically scrollable, prove it at phone/tablet/desktop widths, then carry the change
through the full OpenSpec lifecycle: apply → archive → commit → PR → CI → merge →
worktree cleanup. This was a one-line CSS fix wrapped in a full ship pipeline.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — load the change, confirm the current CSS
   matches the proposal's diagnosis before touching anything.
2. Apply the fix: on `.board-columns` at `@media (max-width: 900px)`, replace
   `overflow-x: visible` with `overflow-x: hidden; overflow-y: auto`. Leave
   `.board-column` / `.board-column-body` alone.
3. `npm run build`, then restart the live server via `curl -X POST http://localhost:8000/api/restart`.
4. Verify in the browser — **but** the live server serves the *main* repo's dist,
   not the worktree's. So don't trust a plain reload: inject the fixed CSS rule into
   the live 390px page and measure `scrollTop` / `scrollHeight` / `clientHeight` via
   `agent-browser eval` to prove the scroll container works. Screenshot the scrolled
   state to confirm the header stays fixed.
5. Mark tasks complete, `npx openspec validate <change> --strict`.
6. `/skill:openspec-archive-change <change>` — sync the delta spec into the main spec,
   then archive. If the sync subagent stalls, apply the precise spec edit directly.
7. Commit (exclude unrelated `.pi/settings.json` worktree-path noise), push,
   `gh pr create --base develop`, then `gh pr checks <n> --watch`.
8. Merge with `gh pr merge <n> --squash --delete-branch`; delete the remote branch and
   remove the worktree **from the main repo**, not from inside the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply & confirm diagnosis.** The AI loaded the change, read the current
`packages/client/src/index.css`, and confirmed it matched the proposal's root-cause
exactly: `overflow-x: visible` left `overflow-y` at its default `visible`, so the
region stopped being a scroll container and the stacked columns got clipped by the
`overflow-hidden` MobileShell. It applied the single-rule fix and built clean. *Why
it worked:* verifying the live code matched the proposal's diagnosis before editing
meant the fix was a two-property change, not a guess.

**Phase 2 — Runtime verification (the hard part).** The AI restarted the server and
tried to visually confirm the fix at mobile width. It hit a wall: the running server
serves the **main repo's dist**, not the worktree build. Rather than fake it, the AI
proved the behavior by injecting the fixed rule into the live 390px page and measuring
scroll: old CSS → `scrollTop` pinned at 0 (the bug); fixed CSS → `scrollTop` reaches
10859 (`scrollHeight` 11337 − `clientHeight` 478), last card reachable. It then
verified tablet (760px, columns wrap, no horizontal scroll) and desktop (>900px,
kanban unchanged). *Decision point:* accept that the served build is stale and
measure the actual DOM behavior instead of chasing the worktree's dist into the server.

**Phase 3 — Archive & spec sync.** The archive skill found one delta spec that
MODIFIED the "Responsive column layout" requirement, adding vertical-scroll guarantees
the main spec lacked. The AI spawned a subagent to sync it — the subagent **stalled**,
so after the "go on, synch stuck" nudge the AI applied the precise spec edit directly
and validated with `openspec validate openspec-board --strict`, then archived.

**Phase 4 — Ship.** Commit (deliberately excluding the unrelated `.pi/settings.json`
worktree-path change), push, open PR #116 against `develop`, watch CI to green. Later
the operator asked about CodeRabbit; the AI reported the review was **rate-limited**
(0 actionable comments — the `pass` status meant "nothing to fix," not "approved").

**Phase 5 — Cleanup.** Squash-merge, delete remote branch, remove the worktree. The
`--delete-branch` step failed (gh couldn't touch the local `develop` checked out in
the main worktree) and the shell was pinned to the now-deleted worktree dir — the AI
routed around both by deleting the remote branch directly and re-anchoring to the main
repo.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-openspec-board-mobile-scroll`.
  Effective because the change was already scoped in OpenSpec; the skill invocation
  loads the proposal + tasks and drives a disciplined apply. A future operator should
  ensure the proposal's root-cause diagnosis is written down first — that's what made
  the fix a two-line edit.
- **"go on"** — a minimal continue that let the AI push through the verification tasks
  without re-litigating each step.
- **"go on, synch stuck"** — high-leverage: a two-word nudge that told the AI to
  abandon the stalled sync subagent and finish the edit inline.
- **"commit, create PR and monitor CI"** — one prompt that unlocked the entire ship
  sequence (stage-exclude-noise → commit → push → PR → watch CI).
- **"Is there any coderabbit issue to fix?"** — good verification gate before merge;
  surfaced that the review was rate-limited rather than silently clean.
- **"merge PR, delete branch and delete worktree"** — a single terminal instruction
  that carried through squash-merge + full artifact cleanup.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Let the sync subagent run and wait on it | "go on, synch stuck" | Time-box subagent sync; if it stalls, apply the precise, well-defined spec edit directly |
| Continue step-by-step, pausing for confirmation | "go on" | State up front "apply all tasks, only stop on a real ambiguity" |
| Treat a `CodeRabbit pass` as reviewed-and-approved | "Is there any coderabbit issue to fix?" | Always distinguish "no actionable comments" from "reviewed"; note rate-limiting explicitly |
| Assume the live server reflects the worktree build | (self-caught during verify) | Remember: live server serves the **main** repo's dist — inject/measure to verify worktree CSS, don't trust a reload |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode existing skills
(`openspec-apply-change`, `openspec-archive-change`) and the `agent-browser` CLI. The
**reusable, skill-worthy pattern** that emerged is *runtime CSS verification against a
stale-served build*: when the running server serves the main repo's dist but you need
to verify a worktree-only CSS change, use `agent-browser eval` to inject the new rule
into the live page and measure `scrollTop`/`scrollHeight`/`clientHeight` before and
after. That proves behavior deterministically without wiring the worktree build into
the running server — worth capturing as a `verify-worktree-css-at-runtime` note.

## 7. Pitfalls & dead ends

- **base64url-encoded cwd URLs trip the browser CLI.** Constructing the board URL by
  hand via `jq @uri` didn't route to the board view; SPA `pushstate` updated the URL
  but never rendered. *Fix:* click through the desktop UI to the "OPENSPEC" button,
  read the resulting real URL, then reuse it.
- **`open` resets the viewport / times out to about:blank.** Set the viewport *after*
  navigation and reload; use a lighter load strategy if `open` times out.
- **Live server serves the main repo's dist, not the worktree.** A plain reload won't
  show your worktree CSS. Inject-and-measure instead (see §6).
- **The sync subagent stalled.** Don't wait indefinitely — apply precise spec edits
  directly and `openspec validate --strict`.
- **`gh pr merge --delete-branch` failed** because `develop` is checked out in the main
  worktree. Delete the remote branch directly with `git push origin --delete <branch>`.
- **The shell was pinned to the deleted worktree** after removal. Re-anchor to the main
  repo (`cd /Users/robson/Project/pi-agent-dashboard`) before further git commands.

## 8. Reproduce it faster — checklist

- [ ] Read the proposal; confirm the live CSS matches its root-cause diagnosis.
- [ ] Edit `packages/client/src/index.css` `@media (max-width: 900px)`:
      `.board-columns` → `overflow-x: hidden; overflow-y: auto`. Leave column rules.
- [ ] `npm run build` → `curl -X POST http://localhost:8000/api/restart`.
- [ ] Verify at 390px / 760px / >900px via `agent-browser eval` inject-and-measure
      (`scrollTop` must reach `scrollHeight − clientHeight`); screenshot fixed header.
- [ ] Mark tasks done → `npx openspec validate <change> --strict`.
- [ ] `/skill:openspec-archive-change` — sync delta into main spec (edit directly if
      the subagent stalls), re-validate, archive.
- [ ] Commit excluding `.pi/settings.json`; push; `gh pr create --base develop`;
      `gh pr checks <n> --watch`.
- [ ] Check CodeRabbit for actionable comments (watch for rate-limited "pass").
- [ ] `gh pr merge <n> --squash`; `git push origin --delete <branch>`; remove worktree
      **from the main repo**.

**Key inputs to have ready:** a scoped OpenSpec change, a running dashboard server on
:8000, `agent-browser` CLI, `gh` authenticated for `BlackBeltTechnology/pi-agent-dashboard`.

**Final artifacts produced:** `packages/client/src/index.css` (one-rule fix),
`openspec/specs/openspec-board/spec.md` (synced), archived change at
`openspec/changes/archive/2026-06-14-fix-openspec-board-mobile-scroll/`, merged PR #116.

---

_Generated from session `019ec570-7165-7e80-a6b5-72c4eeaa8089` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-14. Source extract: `facts-session` sheet._
