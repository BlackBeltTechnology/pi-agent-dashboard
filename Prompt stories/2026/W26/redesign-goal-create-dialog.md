---
session: 019ef611
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (10 user prompts)"
upgrade_status: pending
openspec_changes: [redesign-goal-create-dialog, os-redesign-goal-create-dialog]
proposal_excerpt: "Goal creation is the **only** folder-plugin create flow that renders inline. After `add-goals-folder-page` (folder board) and `sophisticate-goal-authoring-and-control` (rich `GoalForm`), the `+ Goal` / `+ New Goal` af…"
---

# How we did it: Redesign the goal-create flow into a shared modal dialog — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff prompt was terse: *"Use mockup loop to check / improve mockups and be the
part of proposal."* The real objective, clarified across the steering turns, was a full
OpenSpec change in a worktree: run the `frontend-mockup-loop` against the goal-create
dialog mockup, fold the findings into the proposal, then **implement** the redesign — replace
the two inline goal-create panels (`+ Goal` in `FolderGoalsSection`, `+ New Goal` in
`GoalsBoardClaim`) with **one shared modal `CreateGoalDialog`** mirroring the sibling
`CreateAutomationDialog` — and **ship it** end-to-end (tests, docs, build, live browser
verify, PR, CI, CodeRabbit, squash-merge, worktree cleanup). It landed as PR #159, merged
green.

## 2. TL;DR playbook

1. **Ground the mockup loop first.** Read the shipped token sources (`GoalForm.tsx`,
   `CreateAutomationDialog.tsx`) → serve `mockups/goal/index.html` → screenshot Screen A in
   **both** themes → grade against the UX rubric + a11y floor.
2. **Fold the loop findings into the proposal artifacts** (surgical fixes to
   `mockups/goal/index.html`, `proposal.md`, `design.md`) — not a rewrite.
3. **Scaffold `ui-contract.md`** from the canonical mockup-loop template but populate it
   with the **real grounded tokens**, not placeholders. Verify zero raw hex.
4. **Clean the mockup dir** — delete dead `before.html`/`compare.html`, remove dangling refs
   from `design.md`, check off the task.
5. **Apply the OpenSpec change** with `/skill:openspec-apply-change redesign-goal-create-dialog`:
   build `CreateGoalDialog.tsx` (overlay/card classes verbatim from `CreateAutomationDialog`),
   swap both call sites, delete the inline panels + now-dead imports.
6. **Write/adjust tests, then run the goal-plugin project directly** — it isn't in the root
   vitest `projects` list, so `cd packages/goal-plugin && npx vitest run` with an ephemeral
   `HOME` + `--localstorage-file`.
7. **Verify live in the Docker test harness** (`docker/test-up.sh -d --build`, port 18000),
   not by restarting the live dashboard — the running server serves the **main** repo with
   active sessions.
8. **Ship with `/skill:ship-change`**: gate → triage red (env-only vs real) → fix the real one
   → archive + sync specs → commit → push → PR → resolve conflicts → watch CI → CodeRabbit →
   squash-merge → clean up worktree.

## 3. How the collaboration unfolded

**Phase 1 — Mockup loop (GROUND → TEST → FIX).** The AI read the shipped token sources,
served the mockup, screenshotted Screen A in dark + light, and produced a 4-finding table:
a non-spec `Goals ›` breadcrumb, mislabeled "source of truth" hints, missing `aria-label`s on
icon-only buttons, and stale proposal text. It applied four surgical fixes and re-verified.
*Why it worked:* grounding in the actual shipped components (not the mockup's own claims) is
what caught the "source of truth misleads" issue.

**Phase 2 — Contract + cleanup.** On `scaffold`, it built `mockups/goal/ui-contract.md` from
the canonical template but populated with harvested tokens (15 surface/text/border/brand vars +
a state-color table), wired it into `design.md`, and verified token-only (zero raw hex). On
`remove`, it deleted dead `before.html`/`compare.html` and cleared the dangling `design.md`
reference.

**Phase 3 — Implementation.** With `/skill:openspec-apply-change`, it read the spec delta,
call sites, and `goals-api.createGoal`, then created `CreateGoalDialog.tsx` (overlay classes
verbatim from `CreateAutomationDialog`, owns the POST, header `New goal · <folder>` + ✕, no
breadcrumb), swapped both call sites, removed both inline panels, updated tests. **56/56
goal-plugin tests pass.** Docs row delegated to a subagent in caveman style per AGENTS.md.

**Phase 4 — Live verify (the hard part).** The AI correctly refused to restart the live
dashboard (it serves the main repo, 15 active sessions). It stood up the Docker test harness
(`--build` bakes worktree source into the image), then fought a headless-Chromium WS-disconnect
loop that kept an onboarding overlay mounted and intercepting clicks. It ultimately fired the
button's `onClick` via `eval` to bypass hit-testing, confirmed `goal-create-dialog` mounted
with the correct title and full `GoalForm`, and screenshotted it.

**Phase 5 — Ship.** `/skill:ship-change` hit a red gate (19 failures). The AI triaged: 17
env-only (`Jimp is not a constructor`, worktree has no `node_modules`) + **1 real** — this
branch carried `packages/mockup-loop` but never added it to `publish.yml`'s PACKAGES allowlist.
It fixed that (allowlist test 4/4), archived + synced specs, opened PR #159, resolved two merge
conflicts (`publish.yml`, `docs/file-index-extension.md`) keeping both develop's kb packages
**and** mockup-loop, watched CI green, confirmed zero CodeRabbit threads, and squash-merged.

## 4. Prompts that worked

- **Goal prompt** *"Use mockup loop to check / improve mockups and be the part of proposal."*
  Effective because it named a concrete skill (`frontend-mockup-loop`) and a concrete outcome
  (fold into the proposal). Stronger version: *"Run frontend-mockup-loop on the goal-create
  dialog mockup, fold the findings into the proposal/design, scaffold ui-contract.md with the
  real tokens, then apply the OpenSpec change and ship it."*
- **High-leverage one-word steers.** `scaffold` (build the contract), `remove` (delete the dead
  compare files) — worked because the prior turn had already established the exact target, so a
  single verb unlocked the next action.
- **`/skill:openspec-apply-change redesign-goal-create-dialog`** — invoking the apply skill by
  name with the explicit change id skipped all ambiguity about which change to implement.
- **`Use the test docker`** — one short redirect that moved verification off the fragile
  standalone-server path onto the reproducible harness.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for `ship-change` before implementation was done | `wrong propmpt` then `/skill:openspec-apply-change` | State the order up front: mockup-loop → apply → **then** ship |
| Try to verify by restarting/standing up a local worktree server | `Use the test docker` | Say "verify in the Docker test harness (18000), never touch the live dashboard" |
| Treat a red gate as pass/fail without triage | (implicit — user let it proceed on "your call") | Pre-authorize: "env-only fails (jimp/node_modules) are non-blocking; fix only real branch-level fails" |
| Leave a new package out of the `publish.yml` allowlist | caught by the `publish-allowlist` test in the gate | When a branch adds a package, add it to `publish.yml` PACKAGES immediately |

The user twice fired `use ship-change skill` — once prematurely (retracted with `wrong
propmpt`), once correctly after implementation. The lesson: the two-word `wrong propmpt` is a
cheap, effective abort.

## 6. Skills, tools & memory created — and why they're effective

No new persistent skill or memory was created; the session **consumed** existing skills
(`frontend-mockup-loop`, `openspec-apply-change`, `ship-change`) and a `general-purpose`
subagent for the caveman-style docs row. The reusable asset it produced is
**`mockups/goal/ui-contract.md`** — a token-only design control plane that `CreateGoalDialog.tsx`
maps 1:1 to on promote, so the mockup and the shipped component can't drift.

*Recommended skill to create:* a **"verify worktree UI in the Docker test harness"** procedure —
the session spent ~15 min rediscovering that (a) the live dashboard serves the main repo, (b)
`docker/test-up.sh --build` bakes worktree source, (c) the headless WS-disconnect keeps an
onboarding overlay up, and (d) `eval`-firing the button's `onClick` bypasses overlay
hit-testing. (This repo already ships an `isolated-ui-verification` skill — point future runs at
it directly.)

## 7. Pitfalls & dead ends

- **Don't restart the live dashboard to verify a worktree change** — it serves the main repo in
  production with active sessions. Use the Docker test harness on 18000.
- **`packages/goal-plugin` isn't in the root vitest `projects` list.** Running `npm test` from
  root won't scope it; `cd packages/goal-plugin && HOME=$(mktemp -d) NODE_OPTIONS="--localstorage-file=$(mktemp)" npx vitest run`.
- **Headless-Chromium WS-disconnect loop** re-mounts the onboarding overlay and its backdrop
  intercepts clicks. If a modal won't open via `click`, fire the trigger's `onClick` via `eval`
  to bypass hit-testing.
- **Red gate on entry is mostly env noise here** — `Jimp is not a constructor` (jimp install)
  and the browse-endpoint `node_modules` assertion (worktree shares the parent's) are
  non-blocking. Only the `publish-allowlist` fail was real and branch-caused.
- **Adding a package without updating `publish.yml` PACKAGES** fails the `publish-allowlist`
  test — and will fail CI. Add the entry before the root metapackage.
- **`gh pr merge --delete-branch` collides with the worktree** (it tries to check out `develop`,
  owned by the parent). Delete the remote branch and remove the worktree manually.
- **The Bash tool dies after `git worktree remove`** if the shell cwd was the removed worktree —
  expected; the leftover Docker container is reaped next session or `docker rm -f`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the worktree checkout, the mockup at `mockups/goal/index.html`, the
OpenSpec change `redesign-goal-create-dialog`, Docker running, `gh` authed.

- [ ] Ground: read `GoalForm.tsx` + `CreateAutomationDialog.tsx`; serve mockup; screenshot both themes.
- [ ] Fold loop findings into `mockups/goal/index.html`, `proposal.md`, `design.md` (surgical).
- [ ] Scaffold `ui-contract.md` with real grounded tokens; verify zero raw hex.
- [ ] Delete dead `before.html`/`compare.html`; clear dangling refs.
- [ ] `/skill:openspec-apply-change redesign-goal-create-dialog`: build `CreateGoalDialog.tsx`, swap both call sites, delete inline panels.
- [ ] Tests: run goal-plugin project from its own dir with ephemeral HOME + localstorage-file.
- [ ] Live verify in Docker harness (`docker/test-up.sh -d --build`, 18000) — `eval`-fire the button if the overlay blocks the click.
- [ ] Add the new package to `publish.yml` PACKAGES if the branch introduced one.
- [ ] `/skill:ship-change`: gate → triage → archive+sync → commit → PR → resolve conflicts → CI → CodeRabbit → squash-merge → clean worktree.

**Artifacts produced:** `packages/goal-plugin/src/client/CreateGoalDialog.tsx`,
`packages/goal-plugin/src/__tests__/CreateGoalDialog.test.tsx`, `mockups/goal/ui-contract.md`,
updated call sites + tests, `publish.yml` allowlist entry — PR #159, merged `f57fd76` → `develop`.

---

_Generated from session `019ef611-75ec-7362-8590-de8f9e7405f4` · `pi-agent-dashboard/.worktrees/os-redesign-goal-create-dialog` · 2026-06-23. Source extract: deterministic facts sheet._
