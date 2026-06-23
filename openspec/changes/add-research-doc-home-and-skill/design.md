# Design

## Context

The change started as a question — "is it worth updating `AGENTS.md` when a
proposal saves research, so a new session can read it?" — and resolved into a
layering decision plus a reusable procedure. The decisions below record why each
piece landed where it did.

## Decisions

### D1. Discovery layer: not AGENTS.md

`AGENTS.md` is loaded into every agent on every turn (~20 KB). A per-research
pointer there is paid thousands of times to serve a rare lookup — the exact
antipattern its Documentation Update Protocol was written to prevent (the file
once ballooned to 107 KB by accreting per-change pointers).

Research discovery is an **on-demand** need, so it belongs in the on-demand
layer: `docs/file-index.md` (the Investigation Protocol entry point) plus the
in-dir `README.md`. Only a single, stable **process rule** goes in `AGENTS.md`,
in its existing OpenSpec-Conventions block — and a rule that tells agents *where*
research goes actively prevents future bloat.

### D2. One home, not four

`docs/plan/` + `docs/plans/` + `docs/research/` + `docs/architecture-notes/` were
accidental, overlapping buckets. Writing a "save to docs/" rule without picking
one home would codify the sprawl. Chose `docs/research/` (a flat home) and folded
the other three in.

### D3. design.md vs docs/research/

`design.md` already is the OpenSpec-native home for a change's rationale, and it
is archived with the change. So the rule splits by lifetime: change-bound
rationale stays in `design.md`; research that outlives the change is promoted to
`docs/research/` and linked from `proposal.md`. The rule states only the
non-redundant half (the promotion), not "put rationale in design.md" (already true).

### D4. Skill as a monorepo skill-plugin

The skill ships as `packages/research-doc-skill/`, modeled on the pure-skill
precedent `dashboard-plugin-skill`: a workspace package declaring `pi.skills` and
listing `.pi/skills/` in `files`, with no TS code. Pinned to the lockstep version
`0.5.4` so `scripts/sync-versions.js` stays satisfied.

Rejected alternative: editing the `openspec-new-change` skill. Those skills live
under `.pi/skills/openspec-*`, which is **gitignored** — a rule placed there is
not version-controlled, not shared, and can be overwritten on skill sync.

### D5. Real parallelism comes from subagents

In a single agent, `web_search({queries:[...]})` runs its queries sequentially,
and Pi executes tool calls one at a time. Genuine concurrency only comes from
spawning multiple `@fast` subagents (one angle each), which also keeps raw pages
out of the main context — each subagent returns a compact synthesis. This is the
non-obvious mechanic the skill exists to remember.

### D6. Stable skeleton, synthesized content

The document structure is fixed (TL;DR · Question · Context · Findings · Options
& Tradeoffs · Recommendation · Risks · Sources); only the content is synthesized
per topic. Per-doc structures would undermine the consistency the README index
and future readers depend on.

## Risks / Open Questions

- The skill is **v1, codified before a full end-to-end run**. It will likely be
  refined (`skill_manage patch`) after first real use.
- `@fast` / `@research` role routing assumes those roles are configured in the
  session; the skill degrades to default-model subagents if not.
