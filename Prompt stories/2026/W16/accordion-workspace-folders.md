---
session: 24c6d9f7
week: 2026/W16
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [session-card-attached-change-link, replace-tsx-with-jiti, worktree-awareness, new-spec-spawn, workspace-actions, accordion-workspace-folders]
proposal_excerpt: "When a session has an attached OpenSpec change, the session card shows the change badge but the session name doesn't reflect the attachment clearly. The card should display the attached change name as a visible, click…"
---

# How we did it: OpenSpec coherence sweep — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user pasted a full procedure prompt: *"Analyze active OpenSpec proposals against
the current codebase state, detect staleness / conflicts / obsolescence, and
orchestrate updates."* No `--proposal` argument meant **full sweep of all active
proposals**. The real objective, once the machinery ran, was concrete: date every
active proposal, cross-check each proposal's file references against the *current*
repo layout, flag anything stale/broken/obsolete, then **auto-repair what's safely
fixable** (path rewrites), defer what needs human judgment, and write a machine-readable
`.pi/proposal-queue.json` so the backlog is prioritized. A single root cause dominated
the whole sweep: the repo had been restructured from `src/` → `packages/` on
2026-04-10, so every proposal written before that date pointed at dead paths.

## 2. TL;DR playbook

1. **Gather the corpus**: `openspec list --json` (active) + `ls openspec/changes/archive/`
   (history). This session had 12 active, 113 archived.
2. **Date each proposal** with the fallback chain: git first-commit date →
   filesystem birthtime → oldest referencing archive. Sort oldest-first (oldest = most
   likely stale).
3. **Find the pivot event**: scan archives for a structural change (here:
   `2026-04-10-monorepo-split`). Every proposal older than the pivot is a staleness
   suspect.
4. **Verify, don't assume**: for each proposal, `rg`/`find` the exact files it
   references *in the current tree*. Missing `src/...` + present `packages/.../src/...`
   = stale path, not obsolete feature.
5. **Classify** each proposal: ✅ OK / ⚠️ STALE / 🔴 BROKEN / 💀 OBSOLETE / 📭 EMPTY,
   with issue count, complexity, and a priority score.
6. **Auto-fix the mechanical class**: rewrite `src/X` → `packages/X/src/` in the
   proposal Impact sections via `edit`. Add strikethrough notes where work is already
   partially done (e.g. server-launcher already on jiti).
7. **Defer the judgment class**: things needing a new file (LICENSE) or a cross-proposal
   dependency (docker Remote mode waiting on the wizard change) — note them, don't touch.
8. **Validate**: `openspec validate` each edited proposal. **Write** `.pi/proposal-queue.json`
   with statuses + conflicts.
9. **Commit surgically**: stage only the sweep fixes; leave unrelated working-tree
   changes (a half-done feature) unstaged as a separate concern.

## 3. How the collaboration unfolded

**Phase 1 — Gather & date (00:48).** The AI ran `openspec list --json` and listed the
archive, then batched reads of all proposals. Effective because it front-loaded the
whole corpus before reasoning — no per-proposal round trips.

**Phase 2 — Discover the pivot (00:49–00:50).** File-existence checks came back with
"many `src/` files missing." Instead of marking proposals broken, the AI asked *why*
the files were gone, found the `packages/` layout, and traced it to the
`2026-04-10-monorepo-split` archive. **This is the key move**: one structural event
explained 8 of 12 staleness flags. Diagnosing the shared root cause beat fixing 8
symptoms independently.

**Phase 3 — Verify assumptions (00:52–00:55).** The AI didn't trust its own greps. When
an initial `rg` missed `KnownServersSection`, it re-checked and found a lazy import —
correcting a false "unused" conclusion. It confirmed `changeName` exists in
`DashboardSession` but isn't rendered (so session-card-attached-change-link is still
needed), and that `onSpawnSession` already exists in `FolderActionBar` (so part of
workspace-actions is already done). Decision point: each proposal got a *reality-checked*
status, not a paper one.

**Phase 4 — Report & queue (00:55–00:57).** Compiled a summary table (status/issues/
complexity/priority/created per proposal) + a cross-proposal conflict matrix, then wrote
`.pi/proposal-queue.json` (12 proposals, 4 conflicts).

**Phase 5 — Auto-repair (00:58–01:00).** Processed in priority order, rewriting `src/`
→ `packages/` paths in 7 proposals, adding "already done" strikethrough notes, and
**explicitly skipping** the two that needed judgment. Re-validated all edits, updated the
queue.

**Phase 6 — Steering: LICENSE + commit (01:06–01:10).** The user redirected twice: "Add
MIT License for npm-trusted-publishing" (created `LICENSE`, wired `license` + `files` in
`package.json`) and "commit changes." The AI noticed unrelated known-servers changes in
the tree and **committed only the sweep + license**, leaving the feature work unstaged.

## 4. Prompts that worked

- **The goal prompt** — a fully-specified procedure (inputs, phases, exact bash for the
  date-fallback chain, output schema). This is why the session ran 22 minutes mostly
  autonomously: the prompt *was* the spec. Lesson: for a repeatable audit, hand the AI
  the algorithm, not just the intent.
- **"Add MIT License for npm-trusted-publishing"** — high-leverage: one line closed the
  last open item on a proposal the sweep had flagged as "mostly done, LICENSE missing."
  It named *which* proposal, so the AI knew the surrounding context (publish.yml already
  had OIDC + provenance) and did the full job (file + package.json fields).
- **"commit changes"** — short, but the AI added the value: separating concerns. A
  stronger version to bake in: *"commit only the sweep fixes; keep unrelated changes
  unstaged."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after the analysis/report | "Add MIT License…" (finish the open item) | Say up front: "close every safely-closable item, not just report it" |
| Treat all working-tree changes as one commit | "commit changes" (AI self-corrected to split) | State the commit-scope rule in the goal prompt |
| Trust a first grep result (missed lazy import) | (self-caught) re-verify | Always re-check a "missing/unused" verdict with a second query before acting |
| Flag files as missing = proposal broken | (self-caught) find the layout pivot | When many files vanish at once, look for ONE structural event, not N broken proposals |

## 6. Skills, tools & memory created — and why they're effective

No skill was created, but this workflow is **highly repeatable** and should become one.
Recommended skill: **`openspec-coherence-sweep`** —

- **What it captures**: the date-fallback chain, pivot-event detection, the
  verify-before-classify discipline, the auto-fix vs defer split, and the
  `.pi/proposal-queue.json` schema.
- **Why it's effective**: it turns a 22-minute, 64-command manual sweep into a single
  invocation, and it encodes the two hard-won guardrails (find the shared root cause;
  re-verify negative greps).
- **When to invoke**: whenever a batch of OpenSpec proposals may have drifted after a
  refactor/restructure, or on a periodic backlog-grooming cadence.

Artifact produced this session that *is* the reusable output: `.pi/proposal-queue.json`
— a prioritized, conflict-annotated backlog other sessions can consume.

## 7. Pitfalls & dead ends

- **10 of 64 commands failed** — mostly `rg`/`grep` with escaped `\|` alternation inside
  double quotes (shell ate the escaping) and `find` on paths that no longer existed. If a
  multi-pattern `rg "\|"` returns nothing, drop the backslashes (`rg 'a|b'`) or split into
  separate greps before concluding "not found."
- **False "unused" from a first grep** — `KnownServersSection` looked unused until a
  second look found a lazy import. Re-verify negatives.
- **"2 src/ references" in docker-packaging were false positives** — they were legit
  `packages/electron/src/` paths, not stale `src/`. Match the *full* stale prefix, not the
  substring `src/`.
- **Don't over-fix**: npm-trusted-publishing (needs a new LICENSE file) and
  docker-packaging (Remote mode depends on an unarchived wizard change) were correctly
  *deferred* — auto-editing them would have produced wrong or premature changes.

## 8. Reproduce it faster — checklist

- [ ] `openspec list --json` + `ls openspec/changes/archive/` — capture active + history.
- [ ] Date each proposal (git first-commit → birthtime → oldest referencing archive).
- [ ] Scan archives for the structural pivot event (e.g. a monorepo/layout split).
- [ ] For each proposal, `rg`/`find` its referenced files **in the current tree**; treat
      "missing `src/` but present `packages/.../src/`" as a path rewrite, not obsolescence.
- [ ] Re-verify every negative grep before acting on it.
- [ ] Classify (✅/⚠️/🔴/💀/📭) + priority; build a cross-proposal conflict matrix.
- [ ] Auto-fix mechanical path rewrites via `edit`; add "already done" notes where partial.
- [ ] Defer items needing new files or cross-proposal dependencies — annotate, don't touch.
- [ ] `openspec validate` each edit; write `.pi/proposal-queue.json`.
- [ ] Commit **only** the sweep fixes; keep unrelated working-tree changes unstaged.

**Inputs to have ready**: an OpenSpec repo with active proposals, `openspec` CLI, `rg`,
git history. **Artifacts produced**: `.pi/proposal-queue.json`, `LICENSE`, edited
proposal Impact sections, commit `46a4aa7`.

---

_Generated from session `24c6d9f7-995d-4460-a923-2761f6a89189` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-15. Source extract: session facts sheet (Consolidate specs)._
