---
session: 019e6b67
week: 2026/W22
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [fix-editor-settings-persistence, add-editor-keeper-sidecar, add-rpc-stdin-dispatch-with-keeper-sidecar]
proposal_excerpt: "Each code-server instance gets a deterministic per-cwd `--user-data-dir` (`~/.pi/dashboard/editors/<sha256(cwd):12>/`), so in principle VS Code's workspaceStorage already persists open tabs, layout, and scroll state a…"
---

# How we did it: Two parallel OpenSpec proposals for editor persistence — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore` skill) — a thinking stance,
not an implementation task. The first prompt loaded the explore skill verbatim; the
*real* question underneath it was: **"Why do my code-server editor tabs and dialog
state feel lost across dashboard restarts, and what would it take to fix it?"** The
objective, once the steering clarified it, was to turn that investigation into **two
separable OpenSpec change proposals** — a cheap persistence fix and a heavier keeper
sidecar — fully drafted, validated, and pushed to `develop` without dragging along the
dozens of unrelated working-copy changes already sitting in the repo.

## 2. TL;DR playbook

1. Enter explore mode: load `openspec-explore`, then read `editor-manager.ts` to
   establish what code-server *already* persists (deterministic per-cwd `--user-data-dir`).
2. Diagnose the real culprits (hard-kill before VS Code flushes; new editor id each
   spawn → fresh iframe URL) before proposing any fix.
3. Split the work into **two changes**: `fix-editor-settings-persistence` (low-risk
   settings seed + longer grace) and `add-editor-keeper-sidecar` (medium-risk sidecar
   mirroring the existing `rpc-keeper/`). Say "both" and draft in parallel.
4. Scaffold each: `openspec new change <name>`, then fill proposal → design → specs →
   tasks in that order. Expect `openspec validate` to fail until the `specs` delta lands.
5. Run `openspec validate <change>` after each artifact; treat clean validation as the
   done-signal per change.
6. Add the requested Settings switch (`stopOnDashboardExit`, **default false** = editors
   persist) into config.ts + `SettingsPanel.tsx` + tasks + spec, all at once.
7. Before pushing: this is a **jj-colocated repo** — check `jj st` / `jj log`, confirm
   `@` is not descended from `develop`, and isolate **only** the files you authored.
8. Land cleanly: `jj new develop`, `jj restore --from <prev> --into @ <only-your-paths>`,
   `jj bookmark move develop --to @`, `jj git push --bookmark develop` — fast-forward, no divergence.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read before proposing).** The AI resisted the reflex to design a
fix first. It read `editor-manager.ts`, established that each editor already gets a
stable `~/.pi/dashboard/editors/<sha256(cwd):12>/` data dir, and drew the actual failure
modes (2 s SIGTERM→SIGKILL before flush; a new random editor id per spawn changing the
iframe URL). *Why it worked:* grounding the fix in the real persistence model turned a
vague "state feels lost" into two concrete, addressable causes.

**Phase 2 — Split & draft (parallel proposals).** On the human's one-word steer —
**"both"** — the AI created two change dirs and drafted both proposals, explicitly
recommending a landing order (persistence fix first, keeper second) so the cheap win
ships standalone. *Decision point:* separability was the design win — a low-risk change
that can land alone, and a medium-risk one that builds on it.

**Phase 3 — Fill artifacts to validation-clean.** For each change the AI worked
proposal → design → specs → tasks, running `openspec validate` after each. It surfaced a
real bug while drafting: `writeVscodeThemeSettings` spread seeded keys *after*
`...existing`, so seeds silently **overwrote** user keys — captured as Decision 3 and a
task to flip the spread order. *Why it worked:* drafting the spec forced a read of the
real code, which exposed a latent bug for free.

**Phase 4 — Fold in the Settings switch.** Steering turn "Be a switch in Settings page
which false default" became a new `stopOnDashboardExit` config field (default false),
a `SettingsPanel.tsx` control, an `/api/config` round-trip task, and rewritten
spec/tasks — all threaded through in one pass.

**Phase 5 — Careful jj push.** Asked to "commit and push to develop," the AI stopped
because the working copy held dozens of unrelated changes and `@` was on a divergent
branch. It built a clean commit on top of `develop` containing **exactly the 11 files it
authored**, moved the bookmark, and fast-forward pushed. When later asked to "make files
unstaged," it explained that would require rewriting a pushed bookmark and correctly
declined to do harm.

## 4. Prompts that worked

- **The goal prompt (explore skill load).** Effective because it set a *stance* — "think,
  don't implement" — which kept the AI reading and diagnosing instead of jumping to code.
  A stronger explicit kickoff: *"Explore why code-server editor state is lost on restart;
  draft OpenSpec proposals but do not implement."*
- **"both"** — a one-word high-leverage steer that unlocked the parallel two-proposal
  structure. Short because the AI had already laid out the two options clearly.
- **"1. ok  2. Be a switch in Settings page which false default"** — numbered, terse,
  decisive; approved one thing and added a concrete requirement (default-off switch) in
  a single line.
- **"commit and push to develop"** — worked *because the AI treated it as a checkpoint*,
  not a literal order, and verified repo state first.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Offer options and wait | "both" | State up front "draft both changes in parallel" |
| Leave the persist behavior implicit | "Be a switch in Settings page which false default" | Name the config field + default in the proposal from the start |
| Interpret "push" literally | (implicit) verify jj state before pushing | Always `jj st` + confirm `@` vs `develop` lineage before any push in a jj-colocated repo |
| Consider un-committing a pushed bookmark | "Make files in git unstaged" → AI declined | Don't rewrite pushed bookmarks; use a follow-up commit — say so preemptively |

The quality bar the human imposed implicitly: **do not contaminate `develop` with
unrelated working-copy churn.** The AI honored it by isolating the exact 11 authored files.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session, but the workflow is clearly repeatable
and two skills *should* be codified:

- **"parallel-openspec-proposals"** — split one investigation into a low-risk + a
  higher-risk change, draft proposal→design→specs→tasks for each, validate per change,
  recommend a landing order. Removes the ad-hoc back-and-forth of deciding scope.
- **"clean-jj-push-of-authored-files-only"** — in a jj-colocated repo with a dirty
  working copy, build a commit on `develop` containing only files you authored via
  `jj new develop` + `jj restore --from <prev> --into @ <paths>`, then fast-forward push.
  Removes the risk of dragging unrelated changes onto a shared branch. *(A project skill
  for this pattern would pay for itself immediately.)*

## 7. Pitfalls & dead ends

- **`openspec validate` fails right after the proposal — that's expected.** Deltas live
  in the `specs` artifact; validation only goes clean once specs land. Don't chase it.
- **Seed-after-spread bug.** `{ ...existing, ...seeds }` makes seeds win over user keys.
  If you're seeding VS Code settings, put `...existing` *last* (or merge explicitly).
- **Pushing from a divergent `@`.** In this repo `@` was **not** a descendant of
  `develop`. A naive `push` would either include unrelated work or move `develop`
  sideways. Always inspect `jj log -r 'trunk()|@|develop@origin'` first.
- **"Make it unstaged" on already-pushed work is a trap.** It means rewriting a pushed
  bookmark and creating divergence with `origin/develop`. The right move is a follow-up
  commit — the AI correctly refused.

## 8. Reproduce it faster — checklist

- [ ] Load `openspec-explore`; read `editor-manager.ts` to confirm the current
      persistence model before proposing anything.
- [ ] Decide the split: one low-risk change + one medium-risk change; state "both".
- [ ] `openspec new change <each>`; fill proposal → design → specs → tasks.
- [ ] `openspec validate <change>` after each artifact; clean = done for that change.
- [ ] Add `stopOnDashboardExit` (default false) across config.ts + `SettingsPanel.tsx` +
      `/api/config` round-trip task + spec.
- [ ] `jj st` + `jj log`; confirm `@` lineage vs `develop`; isolate only authored files.
- [ ] `jj new develop` → `jj restore --from <prev> --into @ <paths>` →
      `jj bookmark move develop --to @` → `jj git push --bookmark develop`.

**Key inputs to have ready:** a jj-colocated checkout, the `openspec` CLI, and knowledge
of which exact files you authored this session.

**Final artifacts produced:** 11 OpenSpec files pushed to `develop` (commit `34688753`)
across `openspec/changes/fix-editor-settings-persistence/` (proposal, design, tasks,
specs/editor-manager) and `openspec/changes/add-editor-keeper-sidecar/` (proposal,
design, tasks, specs/editor-keeper-sidecar, specs/editor-manager).

---

_Generated from session `019e6b67-1058-7846-8330-2a3f302b22da` · `pi-agent-dashboard` · 2026-05-28. Source extract: deterministic facts sheet (session-to-guideline)._
