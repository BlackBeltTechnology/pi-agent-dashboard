---
session: 019eec14
week: 2026/W25
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (5 user prompts); large facts sheet (~10937 tok)"
upgrade_status: pending
openspec_changes: [add-goals-folder-page]
proposal_excerpt: "Goals shipped in `add-goal-continuation-plugin` (archived 2026-06-14) as a per-session-card attribute: the `goal` plugin claims `session-card-badge` (`GoalChip`) + `session-card-action-bar` (`GoalControl`), and th…"
---

# How we did it: Ship a 15-task OpenSpec change end-to-end (add-goals-folder-page) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single slash command:

> `/skill:openspec-apply-change add-goals-folder-page`

The *real* objective, once the later steering turns landed, was much bigger than
"apply a change": take a substantial 15-task OpenSpec change — a folder-scoped Goals
page spanning the **server core** (new store + REST routes + broadcast protocol), the
**shared protocol types**, and the **goal-plugin** (new UI slot claims + two new
overlay-route pages) — and drive it *all the way to merged*: implement with TDD,
verify, archive + sync the spec, open a PR against `develop`, get CI green, triage
**every** CodeRabbit comment, rebase through a conflict, merge, and tear down the
branch + worktree. One command in, a shipped feature out.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` from inside the change's worktree.
2. **Before writing any code**, have the AI read the proposal/design/spec/tasks **and** the named reference patterns it must mirror, then state a plan and confirm (repo rule: check in before a major change).
3. In a fresh `.worktrees/<name>` checkout, run `npm install` **first** — otherwise `@blackbelt-technology/*` imports resolve to the PARENT repo and your edits are invisible to `tsc`/runtime.
4. Build TDD, task by task: write the test, run it (ephemeral `HOME=$(mktemp -d)` for store/route tests), implement, mark the task `[x]`, checkpoint.
5. When an architecture fork appears (e.g. "embed the real ChatView vs. a lighter v1"), **stop and ask** via `ask_user` rather than guessing on a large UI surface.
6. Verify the whole thing: `tsc --noEmit` clean + `npm run build` (regenerates the plugin registry) + full `vitest` suite; treat 5s-timeout server-boot failures as load flakiness (prove it by re-running on the stashed base).
7. Hand the operator the explicit steps list ("mark complete, archive+sync, PR, CI, CodeRabbit, merge, delete branch, delete worktree") and let the AI execute it in order.
8. On the PR: force a **full** CodeRabbit review if the first pass was rate-limited, triage every actionable comment, fix the valid ones, re-push.
9. Rebase onto `develop`; when the only conflict is the **generated** `plugin-registry.tsx`, resolve the hash line and **regenerate via build** rather than hand-merging.
10. Merge (repo uses merge commits), delete the remote+local branch, remove the worktree — running those last two from the **main repo**, not the worktree you're deleting.

## 3. How the collaboration unfolded

**Discovery & plan (≈5 min).** The AI located the `openspec-apply-change` skill,
read the change's proposal/design/spec/tasks, then read the reference patterns the
design said to mirror — the `openspec-group-store.ts`/`-routes.ts`, `FolderOpenSpecSection.tsx`,
the flows-plugin's `content-view` + `shell-overlay-route` precedent. It then wrote out
a full plan and paused. *Why it worked:* mirroring an existing, blessed precedent (the
openspec-group store/routes and the `gitWorktreeBase` spawn-correlation registry) meant
the new code slotted into established shapes instead of inventing them.

**Server foundation, TDD (tasks 1.1–1.4).** Store → routes → broadcast protocol →
`goalId` meta-stamping + a `pending-goal-link-registry` that mirrors
`pending-worktree-base-registry`. Each landed test-first (25 unit tests). *Decision
point:* the AI hit the worktree resolution trap (below) and correctly diagnosed that
`npm install` in the worktree was required before `tsc` saw its edits.

**Client architecture mapping + one honest fork (tasks 2–4).** The AI discovered the
shell's `ChatView` is **not** cleanly importable by a separate plugin (needs the shell's
event-reducer state, and task 4.1 forbids `App.tsx` edits). Rather than generate a large
UI on a guess, it surfaced the fork — full embed vs. a lighter v1 — and asked. The human
chose the lighter v1, which unblocked the whole client phase. *Why it worked:* the
`MinimalChatView` precedent (subagents plugin) was the right model, and asking before
generating saved a throwaway pass.

**Verify.** `tsc` clean, `npm run build` green (registry regenerated with all 3 new
claims), full suite **7965 passed, 1 failed** — the one failure a load-based server-boot
timeout, proven pre-existing by stashing the change and re-running on base.

**Ship (the 8-step list).** Mark 5.2 → `openspec archive` (sync spec + move + validate)
→ commit → PR #147 → CI green → CodeRabbit full review (19 comments, 17 fixed) → rebase
through the generated-registry conflict → merge (`2071a824`) → delete branch + worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-goals-folder-page`. Effective
  because it names the change and hands the AI a structured tasks.md to work through;
  the skill supplies the TDD discipline. *Stronger version:* add "read the design's named
  reference patterns and confirm a plan before writing code" if your repo doesn't already
  enforce the check-in rule.
- **High-leverage follow-up** — the explicit 8-item ship list: *"1. mark complete 2.
  archive and sync 3. create a PR 4. monitor CI 5. fix coderabbit issues 6. merge PR 7.
  delete branch 8. delete worktree."* One short prompt drove the entire release. *Why:* it
  converts a vague "ship it" into an ordered, verifiable checklist the AI can execute and
  report against.
- **`go on`** — a one-word unlock that let the AI continue a long autonomous stretch after
  a checkpoint. Effective *because* the AI had already stated exactly what it would do next.
- **`there are conflicts with develop. rebase`** — a precise, minimal correction that named
  the operation, not the mechanics.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Look for the opsx skill only in the worktree's own `.pi/skills/` | "opsx skills presented in worktree's parent dir" | Resolve OpenSpec skills from the main repo root, not the checkout (already a repo convention — state it up front). |
| Treat implementation as the finish line | Handing over the explicit 8-step ship list | Give the ship checklist at kickoff so implement→archive→PR→merge→cleanup is one continuous run. |
| Pause at natural checkpoints | "go on" | For a headless run, tell it to proceed through checkpoints unless a genuine fork appears. |
| Assume CI/CodeRabbit "pass" checks meant a review happened | (self-caught) noticed the rate-limit ack, forced a full review | Verify CodeRabbit actually reviewed (a rate-limited pass produces zero comments but a green check). |

Scope/quality bars the human imposed implicitly: everything must reach **merged**, CI
must be **green after every push** (initial, post-fix, post-rebase), and **every**
CodeRabbit comment must be triaged (17/19 fixed, 2 declined with reason).

## 6. Skills, tools & memory created — and why they're effective

**Memory saved (project · tool-quirk):** *worktree node_modules resolution.*

- **What it captures:** In a git worktree under `.worktrees/`, the worktree's
  `node_modules` is empty and `@blackbelt-technology/*` imports resolve **up** to the
  PARENT repo's packages. Edits to the worktree's `packages/*` are **not** seen by
  `tsc --noEmit` or runtime until you run `npm install` inside the worktree (which creates
  local workspace symlinks). vitest may still pass via its own resolution, masking the issue.
- **Why it's effective:** this trap cost real time mid-session (edits "not taking effect",
  a green vitest hiding a broken `tsc`). The memory turns a confusing 10-minute
  investigation into a one-line rule: **always `npm install` in a fresh worktree before
  typecheck/build.**
- **When to invoke it:** the moment you start work in any fresh `.worktrees/<name>` checkout.

*No skill was created,* but this end-to-end flow is highly repeatable — the repo already
encodes it as the `ship-change` / `ship-it` skills. Reach for those to get the PR→CI→
CodeRabbit→merge→cleanup loop for free instead of driving it by hand.

## 7. Pitfalls & dead ends

- **Worktree resolution (biggest one):** edits invisible to `tsc` until `npm install` runs
  in the worktree. *If your changes "aren't seen", `npm install` in the worktree first.*
- **Ephemeral HOME for store/route tests:** store tests write under `~/.pi/...`; run them
  with `HOME=$(mktemp -d) npx vitest run …` so they don't touch your real dashboard data.
- **Flaky server-boot timeout:** a full-server-boot test times out at 5s under load. *Don't
  chase it* — prove it's pre-existing by `git stash push -u` and re-running on the base;
  it fails identically. The doctor-route test showed the same load-flakiness.
- **CodeRabbit rate-limit:** the first review was rate-limited and produced **zero**
  comments while the check went green. Wait, then force a **full** review (not incremental)
  to get the real 19 comments.
- **Generated-file rebase conflict:** `plugin-registry.tsx` conflicts on its hash constant
  when develop adds other plugins. *Resolve the hash line and regenerate via `npm run build`
  — never hand-merge generated output.*
- **zsh glob mangled `--include`:** a `grep --include` invocation got eaten by zsh globbing;
  the AI fell back to reading files directly.
- **Don't restart the live dashboard from a worktree:** the `:8000` instance predates the
  worktree's `npm install`, so it serves the parent repo's code — restarting it disrupts
  running sessions and wouldn't serve your changes. Hand over a QA command instead.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name + its worktree, the design's named
reference patterns, `gh` auth for the PR, a repo where CI + CodeRabbit run on PRs.

- [ ] `cd` into the change's worktree; `npm install` **before** any typecheck/build.
- [ ] `/skill:openspec-apply-change <name>`; have the AI read proposal/design/spec/tasks + reference patterns and confirm a plan.
- [ ] Implement TDD per task; store/route tests with `HOME=$(mktemp -d)`; mark each `[x]`, checkpoint.
- [ ] Ask on genuine architecture forks (embed vs. lighter v1) instead of guessing.
- [ ] Verify: `tsc --noEmit` clean · `npm run build` (regenerates registry) · full `vitest` (dismiss proven load-flaky boot timeouts).
- [ ] Give the AI the ship list: mark complete → `openspec archive` → commit → PR vs `develop` → CI green → CodeRabbit (force full review) → merge → delete branch → delete worktree.
- [ ] Run branch/worktree deletion from the **main repo**, not the worktree.

**Artifacts produced:** goal-plugin server store/routes/registry + client pages
(`packages/server/src/goal-store.ts`, `routes/goal-routes.ts`,
`pending-goal-link-registry.ts`; `packages/goal-plugin/src/client/*`), synced spec
`openspec/specs/goals-folder-page/spec.md`, archived change
`archive/2026-06-21-add-goals-folder-page/`, merged PR
[#147](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/147) (commit `2071a824`).

---

_Generated from session `019eec14` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-21. Source extract: deterministic facts sheet from the session JSONL._
