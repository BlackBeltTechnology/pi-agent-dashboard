# Gate-trim treatment — phase 7.4 (task 7.4)

The trimmed replacement for the root `AGENTS.md` `Docs-First Gate` section:
PRESSURE lines dropped, `Investigation Protocol` folded into the table, all
ROUTING elements intact (tool-substitution rows, retrieval-lane rule, corpus
boundaries, fall-through).

**NOT LANDED.** Do not apply while `guard-coverage.md` stands (subagent
surfaces unobserved) or before M1/M2 pass. This file is the A/B treatment for
`scripts/ab-context` (task 7.5, manual-only post-merge).

---

## Docs-First Gate — kb before grep (per-turn doctrine)

| You're about to… | Do this FIRST instead |
|---|---|
| `grep -rn "SymbolName"` — find where a fn/type/const lives | `kb_search --doc-type agents "SymbolName"` |
| `grep -rn "topic" src/` — how does X work / where's X handled | `kb_search "feature topic"` |
| `cat`/`Read` a file to learn its purpose before editing | `kb agents <path>` — purpose + exports + `See change:` |
| chase imports / callers across files | `rg "<symbol>"` — the Tier-1 graph is markdown-structure only and CANNOT resolve code refs |
| read one doc section in full | `kb_get <path> <section>` |
| a kb hit shows `STALE` / `GONE` / `MOVED` (trust verdict) | verify the row against source before acting — `FRESH` may be acted on without re-reading |
| build / run / install / setup / release / "how do I X" | `grep -i <kw> docs/faq.md README.md docs/` — then quote |
| derive a fact from a large file / big command output | `ctx_execute_file` / `ctx_execute` **when present** (context-mode is optional); else `Read` w/ `offset`+`limit`, or `rg`/`awk` via Bash |
| kb call returned nothing relevant | `rg`/source read allowed — then add the missing directory-`AGENTS.md` row (Documentation Update Protocol) |

`kb_search` indexes repo markdown (`docs/ openspec/ packages/ .pi/`) — NOT
`tests/ qa/ scripts/ docker/`. `ctx_search`/`memory_search` index session
memory, NOT repo docs — different corpus.

**Pick the lane.** FILE/SYMBOL lookups → `doc_type:"agents"` (measured P@1
0.041 → 0.227, MRR 0.198 → 0.345 on 97 file-lookup queries). Conceptual /
how-does-X-work queries → leave `doc_type` unset (the `agents` filter hurts
prose queries, P@1 0.150 → 0.067).

## Dropped (PRESSURE — the guard now delivers at violation time)

- "This gate fires on the ACTION, not the intent — … even mid-task when you
  already know the file."
- "`kb_*` tools return a one-line purpose + key exports…" (tool descriptions
  carry it).
- "kb does NOT replace grep; it goes first." (fall-through row carries it)
- The entire `Investigation Protocol` section (duplicated routing above).

Token delta: removes the framing prose and the protocol restatement
(~694–820 tokens/turn of the ~3,478-token `AGENTS.md`), keeps every routing
row. Landing requires the 7.5 A/B non-inferiority result + the 7.1 subagent
coverage gap closed.
