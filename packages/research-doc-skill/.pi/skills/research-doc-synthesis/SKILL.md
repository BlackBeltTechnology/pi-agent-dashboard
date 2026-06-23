---
name: research-doc-synthesis
description: >
  Produce a structured research/decision document in docs/research/ by fanning
  out parallel @fast web-search subagents, gathering codebase context, and
  synthesizing the results into a stable doc skeleton. Use when research backs
  an OpenSpec proposal and will outlive the change. Triggers: "research X and
  write it up", "do a research doc", "investigate options for Y and save the
  findings", "produce a decision doc". Do NOT use for single-change rationale
  (that goes in the change's design.md) or quick one-off lookups (use web_search
  or the librarian skill inline).
license: MIT
metadata:
  author: pi-dashboard
  version: "1.0"
---

# Research Doc Synthesis

Turn an open question into a consistent, reusable research document under
`docs/research/`, backed by parallel web search and codebase context.

This skill operationalizes the convention in `AGENTS.md` ▸ OpenSpec Conventions:
research that outlives its change lives in `docs/research/`, is indexed in
`docs/research/README.md`, and is referenced from the change's `proposal.md`.

## When to Use

Use when **all** of these hold:

- You need to make or justify a decision, and the inputs aren't already known.
- The findings are reusable across changes, or must survive past the change archive.
- The output should be a saved document, not just an inline answer.

Do **not** use when:

| Situation | Use instead |
|---|---|
| Rationale for one in-flight change | the change's `openspec/changes/<name>/design.md` |
| Quick lookup / single answer | `web_search` inline |
| Open-source library internals | the `librarian` skill |
| Pure codebase "where is X" | the `Explore` subagent |

## Procedure

### 1. Frame the question

Extract the real decision from context. Write it as one sentence the document
must answer (e.g. "Which diagram renderer should the client adopt?"). State what
"done" looks like — the decision or recommendation the doc must enable. If the
scope is ambiguous, ask the user before fanning out.

### 2. Decompose into search angles

Break the question into **3–6 distinct angles** — vary phrasing, scope, and
intent (capabilities, alternatives, benchmarks, pitfalls, prior art, pricing).
Distinct angles beat reworded duplicates; redundant queries waste the fan-out.

### 3. Fan out — parallel @fast subagents

True parallelism comes from **subagents**, not from one agent. In a single agent,
`web_search({queries:[...]})` runs its queries *sequentially*, and Pi executes
tool calls one at a time. To actually parallelize, spawn one `Agent` per angle
(or per small group) with `model: "@fast"`:

```
Agent(subagent_type: "Explore" | inline label,
      model: "@fast",
      prompt: "Web-search this angle: <angle>. Return ONLY: 5–8 bullet findings,
               each with a source URL. No raw page dumps, no preamble.")
```

Rules for the fan-out:

- One angle per subagent → genuine concurrency.
- Each subagent returns a **compact synthesis** (bullets + source URLs), never raw
  pages — keeps the main context clean.
- For library-internals angles, have the subagent use the `librarian` skill.
- Use `@fast` for breadth (cheap, many angles); reserve heavier models for synthesis.

### 4. Gather internal context (in parallel with step 3)

- `Explore` subagent for relevant codebase findings and integration points.
- Check existing `docs/research/` docs and archived `openspec/changes/` for prior art.

### 5. Synthesize into the stable skeleton

Collect the subagent syntheses and write the document. **Keep the skeleton fixed**
— consistency is what makes `docs/research/` indexable and scannable. Synthesize
the *content* per topic; do not reinvent the *structure* per doc. Optional sections
may be dropped when empty, but do not reorder or rename the core ones. Use the
`@research` role for the synthesis pass when available.

```
# <Title>

**Status:** Research | Exploration | Plan | Roadmap

## TL;DR
1–3 lines: the recommendation or headline finding, up top.

## Question / Goal
What decision this document must enable.

## Context
Why now — what triggered this research.

## Findings
Per angle. Each claim carries a source link.

## Options & Tradeoffs
Comparison table when there are competing approaches.

## Recommendation
The call, with rationale.

## Risks / Open Questions
What could go wrong; what remains unknown.

## Sources
All links used.
```

### 6. Save, index, reference

1. Save to `docs/research/<slug>.md` (kebab-case slug from the title).
2. Add a row to the **Index** table in `docs/research/README.md` (title, one-line
   summary, status).
3. If the doc backs an active OpenSpec change, link to it from that change's
   `proposal.md`.

Write `docs/research/` prose in **normal readable style** (not the caveman style
used for file-index rows).

## Pitfalls

- **In-agent multi-query is sequential.** `web_search({queries:[...]})` and stacked
  tool calls do not run in parallel. Real concurrency = multiple `@fast` subagents.
- **Subagents must return synthesis, not raw pages.** Dumping fetched content into
  the main context defeats the fan-out and burns the budget.
- **Don't put single-change rationale here.** That belongs in `design.md`, which is
  archived with the change. `docs/research/` is for research that outlives the change.
- **Web search is optional.** Some research is codebase-only — skip the fan-out and
  use `Explore` when no external input is needed.
- **Stable skeleton, synthesized content.** Per-doc structures break the index and
  reader expectations.
- **Redundant angles waste fan-out.** Vary scope and intent, not just wording.

## Verification

- Document exists at `docs/research/<slug>.md` and follows the skeleton.
- A matching row was added to `docs/research/README.md`.
- All in-doc links resolve.
- If change-bound, the change's `proposal.md` references the doc.
