# Design — distill-hermes-memory-into-skills

## Context (verified against source)

- Hermes store: `~/.pi/agent/pi-hermes-memory/sessions.db`. `memories` table columns:
  `id, project, target(memory|user|failure), category(failure|correction|insight|
  preference|convention|tool-quirk|NULL), content, failure_reason, tool_state,
  corrected_to, created, last_referenced` (both DATE; `last_referenced` NOT NULL).
- `memories.project == basename(cwd)` (verified: `pi-agent-dashboard` ←
  `/Users/robson/Project/pi-agent-dashboard`). Project matching needs no new column.
- Live counts (verified SQL): `memory|NULL` 258, `failure` 14 (12 categorized — 4
  correction / 3 insight / 5 tool-quirk — + 2 `failure|NULL`), `user|NULL` 7 = 279 rows.
  **Zero `convention`-category rows exist**; category is nullable even on `failure` rows.
- `last_referenced` is bumped ONLY on the `add`/`replace` upsert paths
  (`pi-hermes-memory/src/store/sqlite-memory-store.ts`); the standalone `touchMemory`
  date-bump has **zero callers**. So the column records **last WRITE, not last use** —
  there is no read/inject bump, and no reference count anywhere in the store.
- Skills auto-load by NL trigger and already load sidecar detail files
  (`references/*.md`). `.pi` is a `kb` source ONLY where `knowledge_base.json` lists it
  — `.pi` is in kb's `DEFAULT_EXCLUDE` (`packages/kb/src/dox.ts`); this repo opts in.
- The `memory` tool layer write-through-syncs SQLite on every op
  (`memory-retrieval-injection` design D4) and matches removals by **substring + target +
  project, not row id** (`memory-tool.ts`). Move-out MUST route through it AND guard the
  match granularity.
- Private/public tier boundary: `~/.pi/agent/` (Hermes) is NOT git-committed;
  `.pi/skills/` IS. Distillation crosses that boundary → privacy gate mandatory.

## Goals

- Cut the always-injected memory cost by promoting phase-scoped lessons out of the
  topic-blind consolidated block and into skills that load only at their phase.
- Keep every promoted lesson recoverable off-phase (sidecar is a kb source).
- Never leak personal/secret content into a git-committed file.

## Non-Goals

- A new kb sink — defer to `add-automatic-session-kb-index`.
- Changing the retrieval ranker / injection path — defer to `memory-retrieval-injection`.
- Auto-promotion without human approval of the routing table.
- Moving `target=user` (personal, pinned) entries anywhere.

## Decisions

### D1 — Classifier: subagent fan-out, human-confirmed (fork #1)
One subagent per topic bucket proposes `{entryId → hostSkill, confidence, rationale}`
(the `faq-mine` pattern). Output is a routing table a human approves before any move-out.
Ambiguous/multi-skill/low-confidence entries default to **no move** (stay in Hermes).

### D2 — Gate (forks #4 + privacy): two HARD structural gates + one ADVISORY signal
Distill ⟺ BOTH hard gates pass; the advisory signal only informs the human approval.
- **HARD — Shareability**: `target ≠ user` (schema CHECK) AND passes a secret/PII/
  absolute-path scrub (reuse the `add-automatic-session-kb-index` scrub discipline; a
  scrub failure is a hard no-move, never best-effort). These two are the ONLY automated
  privacy gates.
- **HARD — Maturity = *settled*, not *used*.** Since `last_referenced` bumps on write and
  never on read (Context above), "mature" means **not recently edited**: `now -
  last_referenced ≥ T_age` with **`T_age` = 14 days (v1)**. This selects entries that have
  stopped churning — a defensible stability proxy — while explicitly NOT claiming to
  measure usage. **Reference-count is dropped from v1**: no store path produces a count, and MRI D2 *refuses* to bump on
  inject, so the earlier "depends on retrieval-injection LRU work" note was false and is
  removed. If a true use-count is ever wanted it is separate future work (this pass would
  have to maintain its own counter).
- **ADVISORY — project-technical**: a D1 classifier judgment, NOT structurally checkable.
  It shapes the routing table the human approves; it is never an automated hard gate. The
  leak guard for a personal preference mis-stored as `target=memory` is the human confirm
  + the scrub, not this signal.

### D3 — Author into `references/lessons.md`, dedup, tune triggers (fork #3, finding H)
Surviving entry appended to the host skill's `references/lessons.md` (create sidecar +
`SKILL.md` pointer if absent). **Cross-dedup first**: content-hash / near-match the entry
against the sidecar's **existing** lines — regardless of whether this pass or
`distill-session-knowledge` authored them — and skip a duplicate rather than double-author.
Then adjust the host skill's `description` frontmatter so its NL triggers cover the
lesson's situation — else the lesson never loads. `kb_search` over `.pi` is the off-phase
backstop **only when `.pi` is a configured kb source** (finding D); the pass verifies this
and warns otherwise.

### D4 — Move-out via the `memory` tool API, id-safe, never raw DELETE (fork #2, finding C)
Removal goes through `memory(action:remove)` to preserve the single-owner SQLite/MD sync
(retrieval-injection D4). But that tool matches by **substring + target + project, not row
id** — a naive call can over-delete sibling rows sharing a substring, or silently miss
after the text is reworded for the sidecar. Guards:
- Pass the entry's **exact stored bytes** as `old_text` (never the reworded sidecar copy)
  — the `consolidate-pi-memory-store` skill's verbatim-bytes rule.
- Confirm **exactly one** row left the store via a **count check** (pre/post row diff, or
  the sync's `matched`/`removed`), NOT `result.success` alone: `removeUnlocked`'s
  `areDistinctScopedFailureCopies` branch permits a multi-row `failure`-target removal that
  still returns `success:true`, and `failure` rows are the prime candidates. A 0-match
  (miss) or >1-match **aborts** the move-out for that entry and flags it for manual review.
- Ordering: **author + verify sidecar write FIRST, then remove** — a crash between leaves
  a recoverable duplicate, never a loss.

### D5 — Scope == the session's own `projectName`; `user` + global excluded (findings G + N1)
Candidates are `memory`/`failure` entries whose `project` equals the **current session's
registered `projectName`** — the same value the `memory` remove tool scopes to
(`memory-tool.ts` / `memory-store.ts`). Scoping selection to that value **by construction**
guarantees the D4 remove can target the row; a cross-project candidate could never be
removed (the remove would miss), so no union is attempted. This dissolves the earlier
"worktree ∪ parent" idea (finding G), which was the source of the C×G remove-scope gap
(N1): distillation *moves memories out*; the cross-worktree benefit is that the resulting
skill sidecars are shared in the repo, not that one pass reaches another project's rows. A
normal repo session distills the repo's memories; a worktree session distills its own
`os-*` memories — each self-consistent, neither reaching across. Exclusions, both
structural:
- `target = user` — personal, never a candidate (this is the ONLY MRI-alignment rule; D3
  pinning is about injection, not storage — see proposal).
- `project IS NULL` (deliberately global `memory` rows) — excluded, since promoting a
  cross-project memory into one project's committed skill mis-scopes it. MRI still injects
  these globally; distillation simply leaves them in Hermes.

### D6 — Future-write reroute is upstream + deferred
v1 delivers the retroactive pass in-repo. The "new phase-lesson writes route to a skill
sidecar instead of Hermes" behavior is a design spec for `pi-hermes-memory`; without it,
Hermes slowly re-accretes phase lessons and the pass is re-run periodically (acceptable).

## Open items for implementation

- `T_age` threshold — start conservative (only clearly-settled entries; e.g. no edit in
  ≥ N days). No `N_ref`: reference-count is out of v1 (no store path produces one).
- Where the pass lives: a `.pi/skills/` skill vs a `packages/` CLI. Leaning skill (it is
  itself a phase-triggered, human-in-loop procedure).
- Idempotency: cross-dedup (D3) against the existing sidecar covers re-runs; confirm the
  hash normalization matches session-distiller's authored format so equivalents collide.
- Worktree parent resolution (D5) must tolerate a non-worktree `cwd` (git-common-dir ==
  git-dir) — then parent == current, union is a no-op.
