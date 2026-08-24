---
session: 019e8a50
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 2 memory(ies); heavy steering (12 user prompts)"
upgrade_status: pending
openspec_changes: [relocate-view-menu-to-status-bar]
proposal_excerpt: "The per-session display-preferences popover (`ChatViewMenu` — the \"⚙ View\" button that toggles which chat elements render) currently mounts in its own full-width toolbar row at the top of `ChatView` (`ChatView.tsx:307…"
---

# How we did it: Relocate the per-session View menu into the composer status bar — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single slash-command:

> `/skill:openspec-apply-change relocate-view-menu-to-status-bar`

The *real* objective, made concrete by the attached OpenSpec proposal: the per-session
display-preferences popover (`ChatViewMenu`, the `⚙ View` button) rendered in its own
full-width toolbar row at the top of `ChatView`, wasting a whole band of vertical space.
Move it into the composer **status bar** — specifically the `leading` slot, right after
the refresh button and before the model selector — delete the standalone toolbar row,
keep it reachable on mobile, and land the whole thing end-to-end: implement → test →
build → verify in a real browser → archive the change → PR → CI green → CodeRabbit →
merge → clean up the worktree. This was a full apply-through-ship run driven from an
OpenSpec worktree.

## 2. TL;DR playbook

1. **Start from the change name, not a description:** `/skill:openspec-apply-change relocate-view-menu-to-status-bar` — the proposal already encodes the acceptance criteria.
2. **In a worktree, tell the AI to resolve OpenSpec skills from the parent repo root**, not the checkout: *"Use parent worktree parent directory's openspec skills when in git worktree."*
3. **Let the skill walk tasks.md**: edit `App.tsx` (add `ChatViewMenu` to `StatusBar` `leading`, drop the props off the `<ChatView>` mount), edit `ChatView.tsx` (delete the toolbar row + now-orphaned imports/types).
4. **Add a DOM-order test** in `StatusBar.test.tsx` asserting the menu renders inside `status-bar`, after refresh, before the model selector (use `compareDocumentPosition`).
5. **Run the suite once** (`npm test | tee /tmp/pi-test.log`), then re-run just the touched file to confirm your new assertion; ignore the known unrelated `pi-image-fit` JPEG timeout.
6. **Verify in a browser WITHOUT touching production:** start a second dashboard on a spare port — `node packages/server/bin/pi-dashboard.mjs start --port 8300 --pi-port 9300` — and screenshot a live session.
7. **Stop that secondary server by killing its PID directly** (`kill <pid>`), NOT via `pi-dashboard stop --port 8300` (that footgun also reaps :8000).
8. **Archive → commit → PR against `develop`**, then `monitor CI`, `fix coderabbitai issues`, `monitor CI`, `merge PR and cleanup`.

## 3. How the collaboration unfolded

**Phase 1 — Locate the right skill (worktree friction).** The AI first tried to find the
`openspec-apply-change` SKILL.md and burned two failed `find /` searches. The operator
corrected twice ("Use parent's openspec definitions in workspace" / "…parent worktree
parent directory's openspec skills when in git worktree"). Once told, the AI loaded the
skill from the **main repo root** and proceeded. *Decision point:* skills resolve from the
project root, not the `.worktrees/<name>` checkout.

**Phase 2 — Implement against tasks.md.** The AI grepped `App.tsx` / `ChatView.tsx` for
`ChatViewMenu`, `onSetDisplayPrefs`, `displayPrefsOverride`, made the two edits, then
noticed its own change **orphaned** the `DisplayPrefs` / `PartialDisplayPrefs` type imports
and removed them too. *Why it worked:* it cleaned up only the orphans *its* change created —
surgical, not a drive-by refactor.

**Phase 3 — Mobile reachability check.** Task 3 asked whether the menu stays reachable on
mobile. Instead of assuming, the AI traced the `!isMobile` gating in `App.tsx` and confirmed
`ChatView` + `StatusBar` + `CommandInput` live in the **unconditional** branch (only
`TokenStatsBar` is desktop-gated), so the relocated menu renders on mobile for free — task
satisfied, no code needed.

**Phase 4 — Test + build.** Added a DOM-order assertion to `StatusBar.test.tsx`, ran the
full suite (7102 pass, lone failure = unrelated image test), then the single file to be
sure. Clean `npm run build`.

**Phase 5 — Isolated browser verification.** The live :8000 server was **production, 15
active sessions, served from the main repo** — restarting it would either not reflect the
worktree build or disrupt users. The AI paused and asked. The operator unlocked the right
move: *"start dashboard server in port 8300 and test with that."* A dedicated server on
:8300 / pi-port 9300 served this worktree's fresh bundle. A cache-stale bundle briefly
showed the OLD layout; the AI diffed source-vs-bundle, fully closed and reopened the
browser, and screenshotted a **live** session confirming `⟳ · ⚙ View · model …` and no
top toolbar row.

**Phase 6 — Teardown footgun.** Operator: "stop server at 8300." The AI ran
`pi-dashboard stop --port 8300` — which **also killed the main :8000 production server**
via lsof-based stale-port cleanup. It caught the collateral damage, killed the real :8300
PID directly, restarted :8000 from the main repo, and **saved the footgun to memory**.

**Phase 7 — Archive + ship.** Reverted an incidental machine-specific `.pi/settings.json`
rewrite (caused by starting the server), staged feature+archive only, committed, pushed,
opened PR #71 against `develop`. Then: monitored CI (green), triaged CodeRabbit (1 false
positive skipped with a 385-archived-changes justification, 1 valid test-strength nitpick
fixed), re-ran CI green, squash-merged, and removed the worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change relocate-view-menu-to-status-bar`.
  Effective because the OpenSpec proposal already carries acceptance criteria; the skill
  turns them into a tasks.md the AI executes.
- **`start dashboard server in port 8300 and test with that`** — the single highest-leverage
  turn. It unblocked real-browser verification without risking the 15-session production
  server. Bake this in: *"verify on a spare port, never restart the live server."*
- **High-leverage one-word / short follow-ups that chained the ship pipeline:** `yes`,
  `monitor CI`, `fix coderabbitai issues`, `monitor CI`, `merge PR and cleanup`. Each
  advanced a full phase because the AI already held the PR/branch context.
- **Rewrite of the weak worktree-skill correction** (it took two tries): state up front —
  *"This is a git worktree; load all OpenSpec skills from the parent repo root
  (`pi-agent-dashboard`), not the `.worktrees` checkout."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Hunt for OpenSpec skills with `find /` inside the worktree | "Use parent's openspec definitions" (twice) | State up front: worktrees resolve skills from the project root, not the checkout |
| Consider restarting the live :8000 server to verify the build | Provide a spare port: "start dashboard server in port 8300 and test with that" | Default to a second server on a free `--port`/`--pi-port`; never touch production with active sessions |
| Trust a cached browser bundle showing the OLD layout | (self-caught) diff source vs served bundle, fully reopen browser | Hard-close + reopen the browser after a rebuild; verify the served bundle hash, not the cached one |
| Use `pi-dashboard stop --port 8300` to stop the secondary server | (self-caught, then memory-saved) | Kill the secondary server by PID directly — `stop` reaps :8000 too |
| Accept CodeRabbit's "artifact in disallowed path" flag at face value | (self-triaged) checked repo reality: 385 changes already archived that way | Treat archive-path flags as false positives; the rule targets *new* changes, not archives |

## 6. Skills, tools & memory created — and why they're effective

No skill was created; **two memories** were saved (both capturing the same footgun at
different scopes):

- **`failure`/`tool-quirk` (global) + `project` memory:** *`pi-dashboard stop --port <N>`
  does not only stop port N — its lsof-based stale-port cleanup also kills the default :8000
  server.* **Why effective:** it prevents a repeat production outage; the fix ("kill the
  secondary server's PID directly") is encoded so the next session skips the whole
  discover-damage-restore loop.

**Skill that *should* exist (and now does, per the repo):** an *isolated UI verification*
procedure — start a throwaway dashboard on a spare port from the worktree, screenshot a live
session, tear it down by PID. This session essentially performed that dance by hand; the
repo's `isolated-ui-verification` skill captures exactly this pattern and should be invoked
next time instead of improvising ports.

## 7. Pitfalls & dead ends

- **Skill resolution in a worktree:** `find / -path "*openspec-apply-change/SKILL.md"`
  returned nothing / wasted time. → Load OpenSpec skills from the parent repo root.
- **Stale browser bundle:** after `npm run build`, the browser kept rendering the old layout
  (cached JS). → Verify the *served* bundle (grep the old class string out of
  `dist/assets/*.js`), then fully close and reopen the browser — a plain no-cache reload
  wasn't enough.
- **`pi-dashboard stop --port 8300` killed :8000:** the stale-port cleanup is greedy. → Kill
  the secondary listener by PID (`kill <pid>`); restart :8000 from the *main repo*.
- **Incidental `.pi/settings.json` diff:** starting a server rewrote a relative path to a
  machine-specific absolute one. → `git checkout -- .pi/settings.json` before staging so the
  PR is feature-only.
- **Nested heredoc + backticks choked `gh pr create`:** → write the PR body to a temp file
  (`/tmp/pr-body-*.md`) and pass it with `-F`.
- **CodeRabbit false positive on archive path:** don't blindly comply — check whether the
  repo already follows the pattern (385 archives) before "fixing."
- **cwd vanished after worktree removal:** the shell was pinned to the deleted
  `.worktrees/...` dir, so later commands couldn't spawn. → Run the final cleanup from the
  main repo root (or the sandbox executor).

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an OpenSpec change name with a written proposal; `gh` authed; a
free port pair for the isolated server (e.g. `8300`/`9300`); the knowledge that the live
server is production.

- [ ] `/skill:openspec-apply-change <change-name>` from the worktree; tell it to load skills from the parent repo root.
- [ ] Make the edits per tasks.md; remove only the imports/types your change orphans.
- [ ] Add a DOM-order test (`compareDocumentPosition`) asserting placement; run the suite once, then the single file.
- [ ] `npm run build`; verify on a **spare port** — `pi-dashboard start --port 8300 --pi-port 9300` — never restart production.
- [ ] Screenshot a **live** session; if it shows the old layout, verify the served bundle hash + fully reopen the browser.
- [ ] Stop the secondary server by **PID** (`kill <pid>`), not `pi-dashboard stop`.
- [ ] Revert incidental `.pi/settings.json`; stage feature+archive only.
- [ ] `/skill:openspec-archive-change <change-name>`; commit; PR against `develop`.
- [ ] `monitor CI` → `fix coderabbitai issues` (triage false positives against repo reality) → `monitor CI` → `merge PR and cleanup`.
- [ ] Run final worktree cleanup from the **main repo root**, not the deleted worktree.

**Artifacts produced:** edits to `App.tsx`, `ChatView.tsx`, `StatusBar.test.tsx`,
`ChatView.test.tsx`; archived change under
`openspec/changes/archive/2026-06-03-relocate-view-menu-to-status-bar/`; synced requirement
in `openspec/specs/chat-display-preferences/spec.md`; merged PR #71.

---

_Generated from session `019e8a50` · `pi-agent-dashboard` · 2026-06-03. Source extract: `/var/folders/qb/m1_q3v6d5bnfzbpmc0dkkqx40000gn/T/session_facts.XXXXXX.6GnWNI6Fru`._
