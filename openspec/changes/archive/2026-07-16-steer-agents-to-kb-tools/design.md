# Design — steer agents to kb tools

## The lever: mechanical if→then, not prose

The one control that already works in this repo's `AGENTS.md` is the
Discipline-Skills table (`signal → skill`). It is followed because it is
mechanical and observable. The kb gate must adopt the same shape.

### The substitution table (canonical form)

| You're about to… | Do this FIRST instead |
|---|---|
| `grep -rn "SymbolName" packages/ src/` (find where a fn/type/const lives) | `kb_search --doc-type agents "SymbolName"` — tree indexes key exports per file |
| `grep -rn "feature\|topic" src/` (how does X work / where's X handled) | `kb_search "feature topic"` |
| `cat` / `Read` a file just to learn its purpose before editing | `kb agents <path>` — one-line purpose + exports + `See change:` history |
| chase imports / callers across files | `kb_neighbors <path\|heading>` |
| read one doc section in full | `kb_get <path> <section>` |
| grep for a build / run / how-to answer | `grep -i <kw> docs/faq.md README.md` (unchanged — already correct) |

Fall-through rule (kept explicit): if the tree misses, `rg` / source read is
allowed — **then add the missing row** per the WRITE discipline. The table must
never read as "kb replaces grep."

## Why a table beats the current gate

```
 CURRENT                           PROPOSED
 ┌──────────────────────────┐      ┌──────────────────────────┐
 │ "STOP — Docs-First Gate"  │      │ substitution table        │
 │ prose, threats, how-to    │      │ if reflex → exact command │
 │ examples only             │      │ symbol case named         │
 │ → 24 kb_search / 234 grep │      │ → grep reflex redirected  │
 └──────────────────────────┘      │   at the point it fires   │
                                    └──────────────────────────┘
```

The table sits at the point the grep reflex fires and hands the agent the exact
command with zero composition cost. That is the entire mechanism.

## Placement

Three surfaces, one table:

1. **Root `AGENTS.md`** (this repo) — the live gate. Replace prose; keep the
   fall-through + WRITE-discipline loopback.
2. **`dox-doctrine.md` `dox:read:kb` block** — the seed for *new* projects via
   `project-init`. Same table (uses `kb agents` / `kb_search`, which every
   kb-wired project has).
3. **`dox-doctrine.md` `dox:read:manual` block** — grep-only projects. A
   degraded table (chain-walk `AGENTS.md` instead of `kb_search`), same shape.
4. **`coding/AGENTS.md.tmpl`** — flip the one anti-pattern line ("Read the file
   first") and add a pointer to the seeded READ discipline.

## Coherence with in-flight kb changes

`add-kb-code-symbol-index` will populate typed symbols reachable via plain
`kb_search`. Until it lands, symbols live only as prose in `AGENTS.md` rows, so
`--doc-type agents` is the correct route *today*. The table row is phrased
"`kb_search --doc-type agents "SymbolName"`" which stays valid after the symbol
index ships (a superset match), so no re-edit is forced. No contradiction with
`add-kb-semantic-annotation-plane` or `add-automatic-session-kb-index` (both are
machinery, not doctrine).

## Open question

Should the root `AGENTS.md` keep any of the "STOP" language for the
**how-to/build** path (`grep docs/faq.md` first)? That path is already followed
(6 protocol-ok greps, few violations) — recommendation: keep that one short
imperative, drop the rest of the scare framing. Confirm during implementation.
