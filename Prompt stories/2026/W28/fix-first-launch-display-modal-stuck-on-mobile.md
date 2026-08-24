---
session: 019f3b7a
week: 2026/W28
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-first-launch-display-modal-stuck-on-mobile]
proposal_excerpt: "The first-launch chat-display preset modal (`FirstLaunchDisplayModal`, shipped by archived `configurable-chat-display`) becomes **permanently stuck on mobile**: the \"How much should the chat view show?\" question appea…"
---

# How we did it: fix the first-launch display modal stuck on mobile — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator wanted to implement a pre-scoped OpenSpec change end-to-end. The opening
prompt was a single skill invocation:

```
/skill:openspec-apply-change fix-first-launch-display-modal-stuck-on-mobile
```

The *real* objective, unpacked from the proposal: the `FirstLaunchDisplayModal`
("How much should the chat view show?") became **permanently stuck on mobile** — it
depended on a WebSocket round-trip to dismiss, so if the socket never delivered the
`display_prefs_updated` echo the modal never closed. The fix had to make dismissal
**optimistic and local** (close on every PATCH outcome), add a **seedless render
gate** so a failed GET doesn't spuriously re-open it, achieve **desktop/mobile
parity** (one DRY modal, not an `isMobile`-gated copy), and add a **connect-time
snapshot** on the server so state resyncs on reconnect. The whole thing then had to
pass tests, docs, quality gates, and ship as a merged PR.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` from inside the change's
   worktree — the skill loads proposal + tasks and drives task-by-task implementation.
2. Let the AI read the source first (`App.tsx`, the modal component, the server
   `browser-gateway.ts`) and map every task ID to a concrete file location before
   editing.
3. Implement the three root causes as separate, labelled edits (RC2 local-close, RC3
   seedless gate + DRY parity, RC1 connect snapshot). Keep the modal element extracted
   once and rendered in both returns.
4. Write tests alongside each RC: modal PATCH-failure coverage, a focused seedless-gate
   test mirroring the existing `display-prefs-migration.test.ts` pattern, and a
   server connect-snapshot test.
5. **Run tests from the worktree root**, not `../..` — otherwise you test the main
   checkout and your changes are never exercised. Use `HOME=$(mktemp -d)` to avoid
   home-dir config bleed.
6. Triage failures: separate *your* failures from pre-existing environmental ones
   (here: 17 `Jimp is not a constructor` failures in `pi-image-fit-extension`) by
   confirming your diff touches zero of those files.
7. Delegate the docs update to a subagent (per Rule 6), mark tasks complete, run
   `openspec validate --strict` and Biome on changed files only.
8. When ready, say **`ship change`** — the AI runs `ship-change`: build+test gate,
   sync delta specs into main, archive, commit, push, open PR against `develop`,
   watch CI, check CodeRabbit, squash-merge, clean up worktree + branches.

## 3. How the collaboration unfolded

**Phase 1 — Load & map (09:29).** The AI read the proposal and tasks, then grepped
`App.tsx`, `FirstLaunchDisplayModal.tsx`, and `browser-gateway.ts` to pin each task ID
to a real code location (`displayPrefs`, `display_prefs_updated`, the `wss.on("connection")`
body). *Why it worked:* it refused to edit before it could point at the exact
insertion sites, so every subsequent edit was surgical.

**Phase 2 — Implement the three RCs (09:30–09:31).** Edits landed in a deliberate
order: RC2 (modal `seed()` calls `onClose(prefs)` on every path — 200 / non-2xx /
thrown), RC3 (`displayPrefsSeedless` state set true *only* when GET is `r.ok &&
displayPrefs === undefined`, plus a single extracted `firstLaunchModal` element
rendered in both mobile and desktop returns), RC1 (server connect-time snapshot).
*Decision point:* the AI chose to extract the modal **once** and gate on
`displayPrefsSeedless && displayPrefs === undefined` rather than duplicate it per
platform — DRY parity was an explicit design goal.

**Phase 3 — Test & triage (09:33–09:38).** First test run happened in `../..` (main
repo) — the AI caught that its worktree changes weren't actually exercised and re-ran
from the worktree root with `HOME=$(mktemp -d)`. All 18 change tests passed. The full
suite showed 17 failures, all `Jimp is not a constructor` in `pi-image-fit-extension`;
the AI proved they were pre-existing by confirming its diff touched **zero** image-fit
files.

**Phase 4 — Docs, validate, quality (09:38–09:43).** Docs update (`docs/chat-display-preferences.md`)
was delegated to a `general-purpose` subagent per Rule 6. Then `openspec validate
--strict`, Biome on changed files (6 pre-existing import-order warnings in an untouched
import block — confirmed by stashing the diff), and the CodeRabbit advisory review gate.

**Phase 5 — Ship (09:45–09:59).** The single steering prompt `ship change` triggered
the full `ship-change` pipeline: build+test gate, sync both MODIFIED requirements into
`openspec/specs/chat-display-preferences/spec.md`, archive to
`openspec/changes/archive/2026-07-07-…`, commit, push, open PR #255 against `develop`,
watch CI (green in 9m47s), verify zero actionable CodeRabbit threads, squash-merge
(commit `e0cb868`), and clean up the remote/local branches + worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-first-launch-display-modal-stuck-on-mobile`.
  Effective because the change was already fully specified (proposal + tasks.md).
  The skill invocation hands the AI a task list to drive, so it needs no further
  scoping. *Reusable form:* pre-scope the change in OpenSpec first, then apply it with
  one skill call — don't describe the bug in prose.
- **High-leverage follow-up** — `ship change`. Two words unlocked the entire
  gate→archive→PR→CI→merge→cleanup pipeline via the `ship-change` skill. This is the
  archetypal short prompt that triggers a large, well-defined workflow.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| (self-corrected) run tests from `../..` (main repo), so worktree edits weren't tested | — the AI caught it itself | State up front: "run tests from the worktree root, not the parent checkout." |
| Face a noisy full-suite run (17 unrelated `Jimp` failures) that could be mistaken for regressions | — the AI proved they were pre-existing / zero files touched | Note known-flaky packages (`pi-image-fit-extension`) so triage is instant. |
| Need explicit permission to advance from implement → ship | `ship change` | If you want a full auto-ship, say "apply and ship" up front. |

This session needed almost no human redirection — the two prompts were the goal and
the ship trigger. The AI's discipline (map-before-edit, worktree-root testing,
failure triage) did the heavy lifting, which is the pattern to reproduce.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created. The session is a clean demonstration of three
existing skills composing end-to-end:

- **`openspec-apply-change`** — drives task-by-task implementation from a pre-written
  proposal + tasks.md. Effective because it keeps the AI honest to a checklist and
  ties every edit to a task ID. Invoke it once the change artifacts exist.
- **`ship-change`** — the full landing pipeline (gate → sync specs → archive → commit
  → PR → CI watch → CodeRabbit → squash-merge → cleanup). Removes ~10 manual gh/git
  steps and their ordering pitfalls. Invoke with `ship change` when tasks are done.
- **Rule-6 docs delegation** — the docs update was handed to a `general-purpose`
  subagent so the prose write stayed out of the main context. Invoke whenever a change
  touches `docs/`.

*Recommendation:* this exact two-prompt flow (`apply-change` → `ship change`) is worth
memorizing as the standard "land a pre-scoped OpenSpec change" recipe.

## 7. Pitfalls & dead ends

- **Testing the wrong checkout.** Running `npm test` from `../..` tests the *main*
  repo, not the worktree — your changes silently go unexercised. Always run from the
  worktree root; use `HOME=$(mktemp -d)` to avoid config bleed. *If you hit it:* re-run
  from `pwd` inside the worktree.
- **Unrelated pre-existing failures.** 17 `Jimp is not a constructor` failures in
  `pi-image-fit-extension` are a native-dep/environment issue, not your regression.
  *If you hit it:* confirm your diff touches zero of those files
  (`git diff --name-only | grep -c image-fit`) before worrying.
- **Pre-existing Biome warnings.** 6 import-order warnings in `browser-gateway.ts`
  sat in an import block the change didn't touch. *If you hit it:* stash your diff and
  re-run Biome to prove the baseline count is unchanged.
- **Squash-merge branch cleanup.** `gh pr merge --squash --delete-branch` fails its
  *local* cleanup step (the worktree still occupies the branch, and `git branch -d`
  refuses because squash commits aren't ancestors). *If you hit it:* the remote merge
  already succeeded — delete the remote branch, remove the worktree, then
  `git branch -D` (force) the local branch. Also: the merge removes your worktree, so
  the Bash cwd vanishes — run final cleanup with an explicit `cd` to the parent repo.

## 8. Reproduce it faster — checklist

- [ ] The OpenSpec change already exists with `proposal.md` + `tasks.md`, and you're in
      its worktree (`.worktrees/<name>`).
- [ ] `gh` is authenticated and the remote resolves.
- [ ] Run `/skill:openspec-apply-change <change-name>`; let the AI map tasks → source
      before editing.
- [ ] Implement each root cause as a labelled, surgical edit; keep shared UI extracted
      once (DRY parity).
- [ ] Write a test per RC; **run `npm test` from the worktree root** with
      `HOME=$(mktemp -d)`; triage known-flaky packages away.
- [ ] Delegate `docs/` updates to a subagent; `openspec validate --strict`; Biome on
      changed files only.
- [ ] Say `ship change`; let `ship-change` gate → sync → archive → PR → CI → merge →
      cleanup.
- [ ] Verify the merge on the remote if local branch-delete fails (squash + worktree
      collision is expected).

**Artifacts produced:**
- `packages/client/src/components/FirstLaunchDisplayModal.tsx` (RC2 local close)
- `packages/client/src/App.tsx` (RC3 seedless gate + DRY parity)
- `packages/server/src/browser-gateway.ts` (RC1 connect snapshot)
- `packages/client/src/__tests__/first-launch-gate.test.ts` (new)
- Updated tests: `FirstLaunchDisplayModal.test.tsx`, `browser-gateway-snapshot-on-connect.test.ts`
- `openspec/specs/chat-display-preferences/spec.md` (synced), change archived
- PR [#255](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/255) — squash-merged `e0cb868`

---

_Generated from session `019f3b7a` · `pi-agent-dashboard/.worktrees/os-fix-first-launch-display-modal-stuck-on-mobile` · 2026-07-07. Source extract: session facts sheet._
