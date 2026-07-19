# Design — Slim the `kb_search` result payload

## Consumer analysis (why condensed default is safe)

The `kb_search` **tool** returns text. Who reads it?

| Consumer | Reads | Verdict |
|---|---|---|
| The agent | prose, to pick next `kb_get` / open | never parses — condensed is strictly better |
| `client/src/lib/tool-summary.ts:40` | `args.query` (**input**) | untouched by output shape |
| `packages/kb/src/eval.ts:28` | array **index** of `store.search()` results (`first = i+1`) | not the tool text; not `.score` |

No consumer `JSON.parse`s the tool's text result (verified via exhaustive grep;
the extension's own `tool_result` hook acts only on `write/edit/bash`, never on
`kb_search`). Default-flip breaks nothing.

## One parameterized renderer (CLI + tool)

The CLI (`cli.ts:221`) and the proposed tool-condensed output share the **same
fields in the same order** — `path :: headingPath`, `(+N dup)`, parent heading,
snippet — differing only in three axes:

| axis | CLI | tool |
|---|---|---|
| leading token | `score.toFixed(2)` | `rank` (1-based ordinal) |
| parent glyph | `[parent: <h>]` | `⤷ <h>` |
| line structure | single line | multi-line |

So a single parameterized renderer serves both:

```ts
renderHits(hits, { leading: "score" | "rank", parentGlyph: string, multiline: boolean }): string
```

- CLI: `renderHits(hits, { leading: "score", parentGlyph: "[parent: ", multiline: false })`
  (keeps today's exact output — the raw score column is a deliberate human
  ranking-tuning affordance).
- Tool condensed: `renderHits(hits, { leading: "rank", parentGlyph: "⤷ ", multiline: true })`.

`rank` is assigned by the renderer as a 1-based ordinal over the hits it is given
(post-`limit` survivors, not a global corpus rank) — document this so a JSON
consumer does not over-read it.

## Output shapes

### Condensed (tool default)

```
1  specs/tool-registry/spec.md  ::  …Requirement: installHints…
   (+1 dup)
   ⤷ …Scenario: every user-installable binary…
   - WHEN the registry exposes the bash [definition] via list()…
```

- `(+N dup)` printed only when `akaPaths` is non-empty (a real, tested field —
  must not be silently dropped).
- `⤷ <parentHeading>` printed only when `parent` exists.
- Snippet: single line, whitespace-collapsed, ~160 chars.
- FTS `[ ]` match markers preserved; the tool `description` documents them.

### JSON (`format: "json"`)

Compact (`JSON.stringify(hits)` — no `null, 2`, intentionally), retains `score`,
adds `rank`, collapses `parent`:

```json
{"root":"openspec","path":"specs/tool-registry/spec.md","headingPath":"…Scenario: bash…","docType":"doc","score":-18.9,"rank":1,"snippet":"…","akaPaths":["…"],"parent":{"headingPath":"…"}}
```

`score` stays because JSON's audience is tooling/ranking-debug (the same value
the CLI shows); condensed drops it because the agent gets no signal from a
negative float. Format selects audience.

## `format` validation + empty query

- `format` is declared `Type.Optional(Type.String({ default: "condensed", … }))`
  and validated **in-body**: `const fmt = params.format === "json" ? "json" : "condensed"`.
  A strict `Type.Union([Literal("condensed"), Literal("json")])` would let the
  tool framework hard-reject an unknown value *before* `execute()` runs —
  contradicting the "never errors, fall back to condensed" contract. Free string +
  in-body allowlist is the pattern that actually satisfies it.
- The empty/whitespace-`query` guard (today `return "[]"` at `extension.ts:70`,
  **before** any format read) moves **after** the `format` parse so it can emit
  a format-appropriate marker: condensed `(no query)`, JSON `[]`. Not a bare
  empty string (ambiguous to the reading agent).

## Parent collapse — at the source

`sqlite-store.ts` `expandParent` currently builds a full `KbHit`:

```js
// before
h.parent = { root, path, headingPath, chunkId, docType, score: 0, snippet: parent.headingPath };
// after
h.parent = { headingPath: parent.headingPath };
```

`types.ts`: `KbHit.parent?: KbHit | null` → `parent?: { headingPath: string } | null`.

### Why every dropped field is safe to drop

The indexer derives `parentChunkId` from a **per-file** heading stack, and each
`chunkId` is `sha(input.path).slice(0,8):<n>` (a **path**-hash prefix, not a
content hash). So the parent chunk is, by construction, in the **same file** as
the child — `root`/`path`/`docType` equal the child's, `score` is the hard-coded
`0` (the parent is fetched via `getChunkById` *outside* FTS ranking, so it was
never scored — an implementation artifact, not a meaningful value), and `snippet`
is set to `parent.headingPath`. All redundant or constant.

### Why `chunkId` is also dropped (reversing the earlier keep)

`chunkId` was previously kept "as a stable, bug-independent handle." That
rationale was **wrong**: under the deferred sibling bug, `parentChunkId` points
at a sibling, so `parent.chunkId` is the *sibling's* id today and the *true
parent's* id after the fix — it changes across the fix exactly like
`headingPath`, giving zero extra stability. And the `kb_get` **tool** keys on
`(path, section)`, not `chunkId` (and only searches `resolvedSources[0]`), so
`chunkId` is not tool-consumable for a refetch anyway. It carries no value the
child + `headingPath` don't; drop it. **`parent.headingPath` is display/context
only — explicitly NOT a refetch key.**

### Accepted observability trade-off

Dropping `parent.path`/`root` removes the only fields that would reveal a
`fileSha8` collision (two paths sharing the 8-hex prefix, `chunkId` has no UNIQUE
constraint, `getChunkById` filters `root+chunk_id` not path) resolving a parent
cross-file. Probability is ~32-bit birthday within a single root; the KB is
deterministic and fully rebuildable. Accepted; noted here so a future maintainer
who hits it knows where to look.

## Rank vs normalized score

Considered normalizing BM25 to 0–1. Rejected: the list is already sorted, so a
1-based ordinal is the minimal actionable signal and needs no cross-query
calibration. The raw score stays on `KbHit.score` for the callers that actually
read it — the internal dedup/sort (`sqlite-store.ts:183/188`), the graph-relevance
calc (`:334`), and the CLI. (`eval.ts` ranks by array index, not score, so it is
unaffected either way.)

## Public-type / KbStore-interface impact

`KbHit` is exported from the published `@blackbelt-technology/pi-dashboard-kb`
package and is the return element of `KbStore.search()`. Narrowing
`KbHit.parent`:

- binds **every** `KbStore` backend and the in-memory test double — both
  construct/return the slim parent;
- makes `parent` **non-recursive** — `hit.parent.parent` was type-valid, now a
  type error (verified no source reads a grandparent);
- is a **breaking** type change to a public package — call it out in the
  CHANGELOG. In-repo readers surveyed (only `cli.ts` reads `parent.headingPath`,
  which survives); external/downstream readers cannot be surveyed from here, which
  is exactly why the CHANGELOG note matters.

## Alternatives weighed

- **Keep `chunkId` in the parent** — no stability advantage (sibling bug affects
  it identically), not tool-consumable. Rejected → `{ headingPath }` only.
- **Two separate renderers** — the shapes are near-identical (same fields/order);
  a parameterized renderer is DRY without cost. Rejected in favor of one.
- **Normalized 0–1 score** instead of rank — extra calibration, no added value.
  Rejected.
- **`format` as a strict `Literal` union** — hard-rejects unknown values before
  `execute()`, breaking "never errors." Rejected → free string + in-body allowlist.
- **Slim only in `execute()`, leave store returning full `KbHit`** — forks two
  shapes, leaves the dup in every `store.search()` caller. Rejected → fix at source.
- **Drop `parent` entirely** — loses genuine small-to-big context. Rejected;
  collapse to `{ headingPath }`.
