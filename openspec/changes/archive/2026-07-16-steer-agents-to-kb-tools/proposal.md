# Steer agents to kb tools via a mechanical substitution table

## Why

Agents underuse the `kb_*` tools despite an explicit "Docs-First Gate" in
`AGENTS.md`. Measured over the last 20 main-repo sessions (1,079 tool calls):

| Tool surface | Calls |
|---|---|
| `bash` (of which grep/rg **234**, cat/sed **108**, find/ls **177**) | 485 |
| `kb_search` | 24 |
| `kb_get` | 3 |
| `kb_neighbors` | 0 |

Of the grep/rg calls, **137 target source** (`.ts` / `src/` / `packages/`)
versus **6** targeting `docs/README/AGENTS`. In **6 of 20** sessions a
source-grep ran *before* any `kb_search` (direct gate violation); in **7 of 20**
grep/rg was used with **zero** `kb_search`. Nearly every bypassing grep is a
**symbol lookup** — `grep -rn "openFileDiff" packages/client/src`,
`grep -rn "buildTurnSummaries" …` — exactly what `kb_search --doc-type agents`
answers (the tree indexes key exported symbols per file).

Root cause is framing, not missing guidance:

- The gate is a **prose wall** with **compliance framing** ("STOP", "you
  violated the protocol"). The Discipline-Skills **table** in the same file *is*
  followed — because it is a mechanical `signal → skill` mapping. The kb gate is
  not a table, so it is not internalized.
- Every gate example is a **how-to / `grep docs/faq.md`** case. The dominant real
  query — **symbol lookup in source** (137×) — is never named with a concrete
  command.
- `kb_neighbors` / `kb_get` are never presented as the **follow-through** after
  `kb_search`, so agents search once then fall back to grep instead of chaining
  kb.
- The `project-init` `coding/AGENTS.md.tmpl` shipped to **new** projects has
  **zero** kb mention and actively says *"Read the file first,"* steering toward
  source reads. The kb READ block is seeded separately (dox-doctrine) only when
  DOX is enabled, and reuses the same prose framing.

## What Changes

- **`AGENTS.md` Docs-First Gate** → replace the prose gate with a mechanical
  **tool-substitution table** (`about to do X → do Y first`, with the exact kb
  invocation), that names the **symbol-lookup** case and adds `kb_neighbors` /
  `kb_get` as the chain-through. Lead with "faster + cheaper," drop the
  "STOP / violation" scare framing.
- **`project-init` seeded READ discipline** (`dox-doctrine.md`
  `<!-- dox:read:kb -->` block) → carry the same substitution table so new
  projects inherit it; add a grep-only variant to the `dox:read:manual` block.
- **`project-init` `coding/AGENTS.md.tmpl`** → change *"Read the file first"* to
  *"consult the doc tree (`kb agents <path>` / `kb_search`) first, then read the
  specific file,"* and add a one-line kb pointer.

Non-goals: no change to kb indexing machinery, the graph, or tool signatures.
This is doctrine/prose only. It is strictly complementary to
`add-kb-code-symbol-index` (which makes plain `kb_search` also find symbols); the
substitution table is phrased to hold both before and after that change lands.

## Discipline Skills

- `doubt-driven-review` — the wording changes are the whole deliverable; verify
  the substitution table cannot be read as "kb replaces all grep" (fall-through
  to grep on a tree miss must stay explicit) before it stands.
