---
name: kb-search
description: >
  Search the local markdown knowledge base for facts, prior decisions,
  definitions, people, error codes, config flags, and how-we-fixed-it notes.
  ALWAYS search here BEFORE answering a project-specific question from memory,
  guessing, or asking the user — the answer is usually already written down.
  Use whenever you hit an unknown term, an unfamiliar entity, an error string,
  or a "how do we do X / why did we choose Y" question.
---

# kb-search — retrieve before you answer

A fast, local, zero-token FTS5 knowledge base over this project's markdown
(`@blackbelt-technology/pi-dashboard-kb`). Retrieval is **pull**: you call it; nothing
is auto-injected. Sub-second, deterministic, costs no model tokens — so call it
freely on any uncertainty.

## When to Use

- Hit an unknown name / term / error string / config flag / function.
- Need a past decision, convention, or "how we did X".
- About to answer a factual question about this project from memory.
- About to ask the user something the docs may already answer.

## Procedure

1. Extract the key entities from the problem (names, error strings, slugs,
   config keys, function names).
2. Run: `kb search "<entities>" --limit 8 --json`
3. Read only the top 1–2 hits' full content when needed:
   `kb get <path> --section "<heading_path>"`
4. Still unresolved? Walk the graph from a hit:
   `kb neighbors "<heading_path>" --depth 2` and `kb backlinks "<path>"`.
5. Paraphrase miss? Lexical search is weak when your words differ from the
   docs' words. **Reformulate once** using the domain's actual terms (synonyms,
   the real flag/class names) and re-search. Then escalate to the user only if
   the KB returns nothing relevant.
6. Synthesize from the retrieved sections. Cite the `path` you used.

## Pitfalls

- Do NOT answer project-specific questions from memory without searching first.
- Do NOT read whole files — search returns ranked sections with snippets; open
  full content only for the top hits.
- Empty result is not a stop sign — reformulate with domain terms once, then ask.
- Filter when you only want rules: `kb search "<q>" --doc-type agents`.

## Verification

- `kb search` returns ranked `{path, headingPath, score, snippet}` (lower score
  = more relevant).
- Freshness is automatic: `kb search` runs an incremental reindex first unless
  `--no-reindex`.
- Requires `@blackbelt-technology/pi-dashboard-kb` installed (`kb` on PATH) and a
  configured source (`.pi/dashboard/knowledge_base.json` or `--source <dir>`).
