---
session: 019f5920
week: 2026/W29
type: other
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [add-bundle-manual-launch-scripts, add-wizard-launch-progress-log, fix-windows-portable-exe, fix-flows-anthropic-bridge-resolution, SUPERSEDED-bridge-owned-followup-queue, OBSOLETE-add-wizard-launch-progress-log]
proposal_excerpt: "Testers downloading a CI artefact (post `fix-ci-electron-runnable-bundles`) or unzipping a release ZIP have a complete, runnable bundle but no obvious entrypoint when the Electron wrapper hangs (Defender scan, unrelat…"
---

# How we did it: Consolidate drifted OpenSpec proposals — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator wanted a **drift audit** of the OpenSpec proposal backlog. First prompt:
*"Recheck all proposal - except in Current group - because code drifts from proposal.
Maybe some have to be archived, some have to change. Collect them."* The real objective,
once the steering clarified it: audit every **active** proposal that is **not** in the
dashboard's "Current" group, classify each as ARCHIVE / UPDATE / KEEP against the code
that actually shipped, then execute the archives and the spec edits and land the result
as one reviewable commit. 43 active proposals → audit 38 → archive 4, reconcile 6, keep
28, board ends at 39.

## 2. TL;DR playbook

1. **Locate the "Current" group definition first.** It's a dashboard UI concept, not an
   OpenSpec primitive — it lives in `openspec/groups/groups.json` (here `id: "ui"`, 5
   proposals). Compute the exact NOT-in-Current target set before touching anything.
2. **Fan out the audit with parallel `@fast` `Explore` subagents, batched by theme** —
   related proposals share code context, so group them (Future, Electron-execution,
   Next-phase, UI-Extensions, plugin-extraction/misc). Each returns a structured
   ARCHIVE/UPDATE/KEEP verdict with file-line evidence.
3. **Consolidate the verdicts into one table** (count per verdict + per-proposal evidence).
4. **Archive the ARCHIVE set by convention:** dated dirs `archive/YYYY-MM-DD-<name>`,
   marker-prefixed for non-completion (`OBSOLETE-`, `SUPERSEDED-`), each with a marker
   file (`ARCHIVED.md`/`OBSOLETE.md`/`SUPERSEDED.md`) citing the drift evidence. Use
   `git mv` so history shows as renames.
5. **Clean `groups.json`** — drop archived ids from `assignments` AND `changeOrder`.
6. **Apply the UPDATE set with parallel `@fast` `spec-editor` subagents**, one per proposal,
   each carrying its specific drift ACTION.
7. **Validate:** `openspec list --json` still parses, board count is right, `openspec
   validate` passes each edited proposal (subagent markdown markers can break the task parser).
8. **Stage surgically** — exclude unrelated untracked work — and commit with a drift-audit message.

## 3. How the collaboration unfolded

**Phase 1 · Discover the grouping model.** The AI didn't know what "Current group" meant, so it
searched the `spec-coherence-check` skill and the client, then found the truth:
`openspec/groups/groups.json`, where "Current" = `id: "ui"`. *Why it worked:* it treated an
ambiguous domain term as something to resolve from source, not assume — and computed the exact
38-proposal target set before spending any audit budget.

**Phase 2 · Parallel drift audit.** Seven `@fast` `Explore` subagents ran concurrently, batched by
theme so each carried coherent code context. They returned per-proposal ARCHIVE/UPDATE/KEEP verdicts
with concrete evidence (shipped script paths, superseding archived changes, stale file:line refs).
*Why it worked:* read-only auditing is embarrassingly parallel; batching by theme kept each
subagent's context relevant and its verdict grounded. Result: 4 ARCHIVE, 6 UPDATE, 28 KEEP.

**Phase 3 · Execute archives (decision point: prompt `1`).** Before moving anything the AI inspected
the archive naming convention and an existing `SUPERSEDED.md` example, then created reason markers,
`git mv`'d the four dirs to dated `archive/` names, and stripped their ids from `groups.json`.
Verified active count dropped 43→39 and no residual group refs.

**Phase 4 · Apply updates (decision point: prompt `update`).** Six parallel `@fast` `spec-editor`
subagents reconciled the UPDATE proposals — fixing stale paths/lines, marking shipped subsets, adding
drift notes. Then it validated: some subagents had used `[?]`/`~~strikethrough~~`/`✅` markers that
could break the OpenSpec task parser, so `openspec validate` on each was a required gate.

**Phase 5 · Commit (decision point: prompt `commit changes`).** It noticed unrelated untracked
`add-automatic-session-kb-index/` files had been caught by an earlier `git add -A openspec`, unstaged
them, and committed only the intended 36 files (4 markers, 15 archive renames, 17 modified) as
`f3bea63f9`. Left push to the operator.

## 4. Prompts that worked

- **Goal prompt** — *"Recheck all proposal - except in Current group - because code drifts from
  proposal. Maybe some have to be archived, some have to change. Collect them."* Effective because it
  named the exclusion set ("Current group"), the reason (code drift), and the allowed outcomes
  (archive / change). Stronger version: *"Audit every active OpenSpec proposal NOT in the 'Current'
  (groups.json id:ui) group for drift vs shipped code; classify ARCHIVE/UPDATE/KEEP with file-line
  evidence; then execute archives and edits and commit."*
- **High-leverage follow-up** — *"For that use parallel @fast subagents."* One line that turned a
  serial slog into a themed parallel fan-out. This is the move worth internalizing for any read-only
  backlog audit.
- **Terse unlocks** — `1`, `update`, `commit changes`: single-token approvals that advanced each
  phase once the AI had laid out the plan. They work *because* the AI proposed a concrete, verified
  plan first; the operator only had to greenlight.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Start auditing before knowing what "Current group" was | Implicitly, by naming the exclusion — AI resolved it to `groups.json id:ui` | State the group source (`openspec/groups/groups.json`) up front |
| Consider a serial audit | "For that use parallel @fast subagents" | Default read-only backlog audits to themed parallel subagents |
| Risk breaking the OpenSpec parser with fancy markdown markers from subagents | (AI self-caught) validated each edited proposal | Always `openspec validate` after subagent spec edits |
| Sweep unrelated untracked files into the commit via `git add -A openspec` | (AI self-caught) unstaged `add-automatic-session-kb-index/` | Stage explicit paths, never `-A`, when a backlog has unrelated in-flight work |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session — but the pattern is highly repeatable and worth a
skill: **"parallel-drift-audit"**. It would capture: resolve the exclusion group from `groups.json`,
compute the target set, fan out themed `@fast` `Explore` subagents for verdicts, consolidate, then
archive-by-convention + `spec-editor` fan-out for edits, gated by `openspec validate`. The reusable
value: it turns a 40+ proposal reconciliation from a long serial read into a ~40-minute parallel pass.

Subagents used (13 total, all `@fast`):
- **7× `Explore`** — read-only drift verdicts, batched by theme. Effective because auditing is
  parallelizable and needs no write coherence.
- **6× `spec-editor`** — one per UPDATE proposal, each with edit capability + its specific ACTION.
  Effective because each edit is independent, so isolation avoids cross-contamination.

## 7. Pitfalls & dead ends

- **Don't assume "Current group" is an OpenSpec concept.** It's a dashboard UI grouping persisted in
  `openspec/groups/groups.json`. Resolve it before computing the target set.
- **Subagent markdown can break the task parser.** `[?]`, `~~strikethrough~~`, `✅` in a proposal's
  task list can make `openspec validate` fail — always validate after `spec-editor` edits.
- **`git add -A openspec` is dangerous mid-backlog.** It swept unrelated untracked
  `add-automatic-session-kb-index/` files; had to `git reset HEAD` them. Stage explicit paths instead.
- **Archive with markers, not bare moves.** The convention is dated dirs + a reason marker file
  (`ARCHIVED.md` / `OBSOLETE.md` / `SUPERSEDED.md`) citing evidence; use `git mv` to preserve history.
- **Board progress can lie.** Three reconciled proposals showed `0` progress because shipped subsets
  were annotated in prose (`✅ COMPLETE`) instead of `[x]` — flagged, not fixed, and left on request.

## 8. Reproduce it faster — checklist

- [ ] Read `openspec/groups/groups.json`; identify the excluded group id (here `ui` = "Current").
- [ ] Compute the active-NOT-in-excluded target set (`openspec list --json` ∖ excluded ids).
- [ ] Fan out `@fast` `Explore` subagents, batched by theme; collect ARCHIVE/UPDATE/KEEP verdicts.
- [ ] Consolidate into one verdict table with file-line evidence.
- [ ] Archive: `git mv` to `archive/YYYY-MM-DD-[OBSOLETE-|SUPERSEDED-]<name>` + reason marker file.
- [ ] Drop archived ids from `groups.json` (`assignments` + `changeOrder`).
- [ ] Fan out `@fast` `spec-editor` subagents (one per UPDATE) with each proposal's ACTION.
- [ ] `openspec validate` each edited proposal; confirm board count.
- [ ] Stage explicit paths only; commit; leave push to the operator.

**Inputs needed:** an OpenSpec repo with `openspec/groups/groups.json` and the `openspec` CLI.
**Artifacts produced:** 4 archived changes with markers, 6 reconciled proposals, cleaned
`groups.json`, commit `f3bea63f9` (36 files, +442/−266), board 43 → 39 active.

---

_Generated from session `019f5920` · `pi-agent-dashboard` · 2026-07-13. Source extract: `/var/folders/qb/m1_q3v6d5bnfzbpmc0dkkqx40000gn/T/facts.JByfMNjG5e.md`._
