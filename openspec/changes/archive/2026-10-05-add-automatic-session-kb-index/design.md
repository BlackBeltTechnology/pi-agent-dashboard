# Design

> Addendum captured in explore mode (session `019f58ea`). This design records a
> **substrate fork** discovered after `proposal.md` + `tasks.md` were written:
> the change as specified builds **Architecture A** (distiller → in-code chunk →
> FTS5 upsert, no model, no file). Exploration surfaced **Architecture B**
> (distiller → `@fast` synthesis → structured **markdown files** → kb indexes them
> through its existing markdown pipeline). This document lays both side by side,
> records the grounded findings that separate them, and states a recommendation.
> The recommendation is **not yet ratified** — `tasks.md`/`spec.md` still describe A.

## Context

`packages/session-distiller` is built (46 tests). It extracts five verified signal
classes (fault, correction, decision, procedure, documentation) from cwd-scoped pi
session JSONL, clusters by signature, and routes to `skill_manage` / `memory` /
`docs`. Only `documentation` currently reaches a searchable index (`ctx_index`); the
other four never land in `packages/kb`. "kb is not learning from sessions" is
literally true today.

The parent proposal closes that gap by adding a `kb` sink. The open question this
design answers: **what substrate does that sink write — raw FTS5 rows, or markdown
files?**

## Grounded findings (verified against the live repo)

These facts, not preference, drive the recommendation:

1. **`.pi` is already a kb source root.** Project config
   `.pi/dashboard/knowledge_base.json` lists `sources: [docs, openspec, packages,
   .pi]` with `include: ["**/*.md"]`. Markdown dropped under a tracked `.pi/`
   subtree is indexed by the **existing** `kb index` pipeline — **no `packages/kb`
   core change required** for Architecture B.

2. **Retrieval is heading-dominated 10:1.** `ranking.fieldWeights =
   { headingPath: 10, heading: 3, body: 1 }`. "A structure that helps later agents
   select best chunks" is, concretely, **the markdown heading schema.** Architecture
   A has no rich heading hierarchy to exploit; B controls it directly.

3. **`respectGitignore: true`.** kb will **not** index anything git ignores. So a
   "gitignored personal file" is **not** searchable — the location choice is
   constrained (see Decision 3).

4. **The `@fast` "quarantine" pattern already exists in-repo.** The sibling change
   `add-kb-semantic-annotation-plane` runs a fast LLM at write-time whose only
   output is reviewable frontmatter, with the graph builder staying deterministic
   ("frontmatter is the contract; the LLM never runs inside the indexer"). B reuses
   this pattern verbatim.

## The two architectures

```
                distiller extracts + clusters verified signals (BUILT, no model)
                                        │
        ┌───────────────────────────────┴───────────────────────────────┐
        ▼                                                                ▼
  ARCHITECTURE A  (current tasks.md/spec.md)         ARCHITECTURE B  (this addendum)
  ─────────────────────────────────────────         ────────────────────────────────
  in-code chunk → packages/kb FTS5 upsert            @fast renders cluster → .md file
  metadata in DB columns                             kb indexes file via existing pipeline
  • pure code, zero model, always fresh              • human-readable, git-diffable, editable
  • a bad row = 1 DELETE                             • LLM synthesizes raw signals → prose
  • needs packages/kb change (accept                 • NO packages/kb core change (.pi already a root)
    externally-provided chunks, task 2.3)            • heading schema = high-weight retrieval anchors
  • structure limited to raw signal spans            • model cost + non-determinism (bounded, see risks)
```

| Axis | A: direct-to-FTS5 | B: markdown + `@fast` |
|---|---|---|
| `packages/kb` core change | Yes (task 2.3 ingestion API) | **No** (rides `.pi` source root) |
| Exploits 10:1 heading weight | No | **Yes** |
| Human-editable / attributable artifact | No | **Yes** (a file, in git or an external dir) |
| Model cost | None | `@fast`, off critical path, hash-gated |
| Determinism | Full | Bounded (format-only; diff before truth) |
| Delete a bad entry | 1 SQL row | delete/edit the file, reindex |

## Decisions (recommended, pending ratification)

**D1 — Substrate: build B, drop A.** B rides existing kb machinery, yields
editable/attributable artifacts, and exploits the heading weighting A structurally
cannot. A's sole advantage (no model) is cheap to forgo: the model runs off the live
path, over already-clustered signals, hash-gated.

**D2 — Granularity: one file per topic-cluster, not per session.** The distiller
already clusters by signature (tool-seq + error-class + topic). One cluster → one
file; recurrence updates `lastSeen` / `confidence` / `sessionIds[]` in place. This is
how re-runs stay idempotent (the `cross-session-distillation` spec already mandates
"zero duplicates on re-apply").

**D3 — Location: external root default, `docs/learned/` as promotion target.**
Because `respectGitignore: true`, "gitignored + searchable" is impossible. Two tiers,
mirroring what the distiller already does (personal signals → memory; recurring
how-tos → docs):

```
  ~/.pi/dashboard/kb-sessions/<project>/<signal>-<sig>.md   ← auto, personal, high-churn,
        │                                                     no repo/PR noise, external
        │  (cluster crosses a high confidence + recurrence bar)
        ▼
  docs/learned/<topic>.md                                   ← promoted, committed, team-shared,
                                                              caveman doc-protocol applies
```

The external root sidesteps both the `respectGitignore` trap (no `.gitignore` inside
it → always indexed) and the "every distill spams git" problem. Adopting it requires
adding one `sources[]` entry to the kb config (external filesystem ref), not a code
change. Trade-off: external = per-machine, not shared until promoted.

**D4 — Trigger: manual first, lifecycle-auto later.** Reuse today's
`distill-session-knowledge` invocation (dry-run → review → apply) to prove the
heading schema retrieves well, before wiring the automatic `agent_end`/`isIdle`
trigger (tasks 5.x). A `@fast` call on every session-end is real spend; earn it.

**D5 — Model role: format only, never judge.** Deterministic clustering + the `N≥3`
gate already decide *what* survives. The `@fast` model's sole job: render a cluster's
raw samples into the fixed heading schema, scrubbed, caveman style. LLM quarantined
downstream of keep/drop, upstream of the frontmatter contract; output is a reviewable
diff. Low drift, no silent-auto-write judgment footgun.

## The document schema (the retrieval contract)

One file per cluster. Headings are the query targets (weight 10); frontmatter `tags`
become `has_tag` graph edges; provenance stays attributable.

```markdown
---
kb:
  signal: fault              # fault | correction | decision | procedure | doc
  sessionIds: [019f…, 018a…] # provenance — attributable back to source sessions
  cwd: /Users/robson/Project/pi-agent-dashboard   # ← PROJECT scope (distiller already scopes to cwd)
  model: claude-sonnet-4
  confidence: 0.82           # decays w/o recurrence (cross-session-distillation spec)
  verified: true
  firstSeen: 2026-06-30
  lastSeen:  2026-07-12
  tags: [vitest, jiti, server-restart]   # → has_tag edges (Tier-1 graph)
---
# Vitest suite hangs after jiti server restart      ← THE retrieval anchor (weight 10)

## Symptom            ← what a future agent greps ("tests hang")
…one line, concrete tokens…

## Root cause
…

## Fix
…the procedure, present tense, caveman style…

## Verification
…the check that proves it…

## Provenance
sessions 019f…, 018a…; seen 4×; model claude-sonnet-4
```

A future `kb_search --doc-type session "vitest hangs"` ranks the `# …hangs…` title
and `## Symptom` heading at weight 10 — the right chunk surfaces, attributable to its
source sessions.

## Impact on the existing tasks.md / spec.md if B is ratified

The parent artifacts describe A. Adopting B rewrites, does not extend:

- **Task 2.3 (kb ingestion API) → dropped.** B writes `.md` files; the existing
  `kb index` markdown pipeline ingests them. No `packages/kb` core change.
- **Tasks 2.1–2.2, 2.4 → replaced** by "emit markdown file with the schema above +
  frontmatter" and "add an external `sources[]` root (or write under tracked `.pi/`)".
- **New task cluster** — the `@fast` synthesis pass (render cluster → schema),
  reusing the `add-kb-semantic-annotation-plane` invocation shape.
- **Add `doc_type: session`** (or reuse `doc` + a `signal` frontmatter filter) so
  `kb_search --doc-type session` works. Task 2.4's "namespace/filter by signal"
  goal survives, via frontmatter rather than DB columns.
- **Tasks 3.x (scrub), 4.x (decoupled gate), 5.x (lifecycle), 6.x (idempotency via
  watermark + content hash), 7.x (subagent exclusion), 8.x (tests) → carry over
  largely intact.** The scrub gate still fires *before* the file is written; the
  watermark + kb content-hash still give idempotency.
- **D3's external root** needs a kb config `sources[]` addition (documented, not code).

## Risks / trade-offs

- **Non-determinism (B).** Mitigated by D5 (format-only), hash-gating (re-render only
  changed clusters), and "diff before truth" (files are reviewable git artifacts, not
  opaque rows).
- **Model cost (B).** Mitigated by D4 (manual first), `@fast` tier, cluster-level (not
  message-level) granularity, and hash-gating.
- **External-root files are per-machine, not shared (D3).** Intentional: raw session
  knowledge is personal + high-churn; the `docs/learned/` promotion tier is the shared
  channel. Teams that want everything shared choose tracked `.pi/kb/sessions/` instead
  (accepting per-distill diffs).
- **`respectGitignore` foot-gun.** Anyone choosing a gitignored in-repo path gets
  silent non-indexing. D3's external root or a tracked path avoids it; call it out in
  docs (task 9.1).

## Open questions

1. Ratify B, or keep A as specified? (This addendum recommends B.)
2. External root (`~/.pi/dashboard/kb-sessions/<project>/`) vs tracked
   `.pi/kb/sessions/` as the default auto tier — personal/per-machine vs shared/noisy.
3. `doc_type: session` (new enum value + migration) vs reuse `doc` + `signal`
   frontmatter filter (zero schema change).
4. Promotion bar (auto → `docs/learned/`): what confidence + recurrence threshold,
   and is promotion agent-gated (like the current docs sink) or automatic?
