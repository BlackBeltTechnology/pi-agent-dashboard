---
session: 019ef265
week: 2026/W26
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [redesign-automation-editor-and-board]
proposal_excerpt: "The automation **Create dialog** and **board/content view** shipped in `add-automation-plugin` are functional but not user-friendly, and the trigger model has no UI seam for the event triggers the architecture was bui…"
---

# How we did it: Redesign the automation editor & board — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change redesign-automation-editor-and-board
```

The real objective: take the already-scaffolded OpenSpec change
`redesign-automation-editor-and-board` (22 tasks, spec-driven) and **implement it end to
end** — a two-level trigger taxonomy shared between server and client, a redesigned
`CreateAutomationDialog` (grouped sections, category→event picker, cron helper,
`ModelSelector` + `@role`, sandbox/worktree gating), a redesigned `AutomationBoard`
(enable/disable, run-now, view-result, delete), plus the server seams (schema, writer,
routes, spawn options) and docs to support them. Once the code was green, the second ask
was an explicit **8-step ship pipeline** (archive → PR → CI → CodeRabbit → merge → clean
up). The whole thing ran ~4h and cost ~$16.8 on Opus.

## 2. TL;DR playbook

1. **Kick off with the apply skill and the exact change name** —
   `/skill:openspec-apply-change redesign-automation-editor-and-board`. Let the skill load
   the proposal, design, and `tasks.md` first.
2. **Read all context before touching code.** The AI opened the proposal + every source
   file it would modify, then declared a **dependency-ordered plan**: shared types →
   registry/schema → engine spawn → writer/routes → client redesign → docs/build.
3. **Implement in that order with TDD where it fits** — write the `*.test.ts(x)` alongside
   each server/client unit, run it in isolation with `HOME=$(mktemp -d) npx vitest run <file>`
   (vitest needs a writable HOME in this repo).
4. **Thread fields you can't yet enforce, and document the limitation.** pi has no sandbox
   flag → wire `mode`/`sandbox` through `SpawnLike`/`PluginSpawnOptions` so they're ready,
   and record the host-side limitation instead of faking enforcement.
5. **DRY the pure logic across the client/server seam** — `cron.ts` was pure, so it moved to
   `shared/` and the server file re-exported it, letting the dialog compute a next-run preview.
6. **Run the whole plugin suite + typecheck the plugin in isolation** before trusting the
   worktree — `npx tsc -p packages/automation-plugin/tsconfig.json --noEmit` and
   `npx vitest run packages/automation-plugin/`.
7. **Separate pre-existing failures from yours.** 17 image-fit/Jimp failures were pre-existing
   in the worktree; the diff never touched image-fit — prove it with `git diff --name-only`.
8. **Delegate every `docs/` write to a subagent** with the caveman-style rule verbatim (repo
   convention) — here, updating `docs/file-index-plugins.md`.
9. **Then run the ship pipeline as one numbered list** — commit → `openspec archive <name> -y
   --skip-specs` → push → `gh pr create` against `develop` → watch CI → merge `--delete-branch`
   → remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Load the change & plan (Discovery).** The AI resolved the OpenSpec skill from the
main repo root (not the worktree — repo convention), pulled `openspec status`, read the
proposal/design/`tasks.md`, then read every core source file it would edit. It closed the
phase by stating an explicit **dependency-ordered implementation plan**. *Why it worked:* a
22-task change is unmanageable without ordering; declaring the seam order up front kept every
later edit local and testable.

**Phase 2 — Server foundation (types → registry → schema → routes).** Shared types
(`TriggerCategoryDescriptor`, `on.events?`, `disabled?`), a static `TRIGGER_TAXONOMY` with a
`deriveTriggerTaxonomy()` (enabled iff the kind is registered), a `scheduled↔schedule`
back-compat mapping, a schema that accepts taxonomy kinds + `events[]` while keeping existing
`kind: schedule` files valid, and a `GET /trigger-kinds` route. Each unit shipped with its
test; the AI ran them in isolation with `HOME=$(mktemp -d)`.

**Phase 3 — Spawn seam with a documented limitation (decision point).** Investigating Task 4,
the AI discovered **pi has no sandbox flag** and no host-side ephemeral-worktree lifecycle. The
spec allowed a "documented limitation," so it **threaded `mode`/`sandbox` through the spawn
contract** (ready for the day the host supports it) and documented the gap — rather than
pretending to enforce a sandbox.

**Phase 4 — Client redesign (editor + board).** It first read the roles-plugin test to learn how
the `ModelSelector` UI primitive is provided, then rewrote `CreateAutomationDialog.tsx` (grouped
Identity/Trigger/Action/Advanced, category tabs → event checklist, cron helper + next-run
preview, `ModelSelector` + `@role`, git-gated worktree) and `AutomationBoard.tsx` (enable/disable
via a new backward-compatible `disabled?`, run-now, view-result, delete). To DRY the next-run
math it moved the pure `cron.ts` into `shared/`. 119 plugin tests green.

**Phase 5 — Verify & separate noise.** Full-suite run surfaced 17 image-fit/Jimp failures
(pre-existing) + 1 real failure: it had used `node:child_process` directly, tripping a repo lint;
it swapped to the `platform/exec` wrapper. It proved the image-fit failures weren't its fault with
`git diff --name-only`, and confirmed the only typecheck noise was a worktree symlink artifact
(`@blackbelt-technology/*` resolving to the main repo's un-edited `PluginSpawnOptions`). Docs
(`file-index-plugins.md`) went through a subagent per convention.

**Phase 6 — Ship pipeline (the human's second ask).** The user handed an explicit 8-step list.
The AI committed, archived (`openspec archive <name> -y --skip-specs`), pushed, opened PR #152
against `develop`, watched CI to green, noted CodeRabbit errored on its side with no actionable
comments, squash-merged with `--delete-branch`, and removed the worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change redesign-automation-editor-and-board`.
  Effective because it named the exact change, letting the skill load proposal + design +
  `tasks.md` and giving the AI a bounded, ordered task list instead of an open-ended "redesign
  the UI."
- **The pipeline prompt** — *"1. I will tests manual later 2. archive / sync 3. create PR
  4. monitor CI 5. fix coderabbit issues 6. merge PR 7. delete branch 8. delete worktree."*
  A single numbered directive that turned the entire post-implementation flow into a checklist
  the AI could execute without further questions. **Reuse this verbatim** as your ship-it prompt.

*Rewrite tip:* the pipeline prompt was sent 5 times in a row (likely resends). One clear numbered
message is enough — if the AI is mid-task, wait for the turn to complete rather than resending.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implementation, unsure what to do next | Hand an explicit 8-step ship pipeline | State the ship pipeline up front, or trigger the `ship-change`/`ship-it` skill |
| Treat every failing test as its own | (self-corrected) isolate pre-existing image-fit/Jimp failures via `git diff --name-only` | Note known pre-existing failures in the prompt so they aren't chased |
| Reach for `node:child_process` directly | (self-corrected) repo lint forced the `platform/exec` wrapper | Remember: this repo bans direct `child_process` — use `platform/exec` |
| Rely on bash output for exact identifiers | (self-corrected) bash "mangles some identifiers (display quirk)" → used `Read` for exact tokens | Read files for exact symbol names, don't trust grep echo |

The pipeline prompt was **repeated 5×** in ~2 minutes. Not a correction — a resend. The guardrail
is operator-side: give the numbered pipeline once and let the turn run.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was pure execution of an existing change
plus the ship pipeline. But the workflow is highly repeatable and already covered by skills worth
invoking next time:

- **`openspec-apply-change`** — drove the whole implementation. Invoke with the exact change name
  so it loads proposal/design/tasks and enforces the task checklist.
- **`ship-change` / `ship-it`** — the exact 8-step pipeline the human typed by hand is what these
  skills automate (archive → PR → CI → CodeRabbit → merge → clean up). Next time, trigger the skill
  instead of hand-listing the steps.
- **Subagent (`general-purpose`) for the docs write** — the repo requires all `docs/` writes to go
  through a subagent with the caveman-style rule verbatim. Keep doing this; the main agent should
  never edit `docs/` prose directly.

## 7. Pitfalls & dead ends

- **vitest needs a writable HOME here.** A bare `npx vitest run <file>` failed; prefix with
  `HOME=$(mktemp -d)` to run a single test file in the worktree.
- **`openspec archive --change <name>` is wrong syntax.** The first archive attempt errored; the
  working form is `openspec archive <name> -y --skip-specs` (positional name).
- **Worktree typecheck noise is expected.** `@blackbelt-technology/*` imports in a worktree resolve
  to the **main** repo's `node_modules`, so `server.ts` sees the main repo's *un-edited* types. The
  worktree's own packages (`automation-plugin`, `dashboard-plugin-runtime`) typecheck clean in
  isolation; the boundary error resolves on merge + install. Don't chase it.
- **17 image-fit/Jimp test failures are pre-existing** in the worktree's resolved deps — verify with
  `git diff --name-only` that your change never touched image-fit, then ignore them.
- **`gh pr create` first failed** (base branch) — the repo's default branch is `develop`, not `main`.
  Target `--base develop`.
- **CodeRabbit may error on its side** with no review comments. That's not an actionable failure —
  check `gh pr view <n> --json reviews,reviewRequests` and proceed if there are no real threads.
- **Don't enforce a capability that doesn't exist.** pi has no sandbox flag; thread the field and
  document the limitation rather than faking enforcement.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change scaffolded (`openspec/changes/<name>/` with
proposal + design + `tasks.md`); a worktree checked out; `gh` authed; the repo's `develop` as PR base.

**Checklist:**

- [ ] `/skill:openspec-apply-change <change-name>` — load proposal/design/tasks.
- [ ] Read the proposal + every file you'll touch; state a **dependency-ordered plan**.
- [ ] Implement seam by seam (types → registry/schema → spawn → writer/routes → client → docs),
      TDD each unit; run isolated tests with `HOME=$(mktemp -d) npx vitest run <file>`.
- [ ] Thread fields you can't enforce yet + document the limitation (no sandbox flag).
- [ ] DRY pure logic across the client/server seam (`cron.ts` → `shared/`).
- [ ] Use `platform/exec`, never direct `node:child_process`.
- [ ] Full suite + isolated plugin typecheck; separate pre-existing failures via `git diff --name-only`.
- [ ] Delegate all `docs/` writes to a subagent (caveman-style rule verbatim).
- [ ] Ship: commit → `openspec archive <name> -y --skip-specs` → push →
      `gh pr create --base develop` → watch CI → squash-merge `--delete-branch` → remove worktree.

**Artifacts produced:** the automation-plugin redesign (`CreateAutomationDialog.tsx`,
`AutomationBoard.tsx`, `trigger-registry.ts`, `automation-schema.ts`, `automation-types.ts`,
`cron.ts` in `shared/`, plus tests), threaded spawn options in `dashboard-plugin-runtime` /
`server`, updated `docs/file-index-plugins.md`, and merged **PR #152** into `develop`.

---

_Generated from session `019ef265` · `pi-agent-dashboard` · 2026-06-23. Source extract: deterministic facts sheet._
