# Slim the `kb_search` result payload

## Why

`kb_search` disappoints on the **result side**, not the call side. The tool
returns `JSON.stringify(hits, null, 2)` — a shape the reading LLM never parses,
yet pays for in full:

- **Raw BM25 `score`** (e.g. `-18.90`). Negative, unbounded, incomparable
  across queries → zero actionable signal to a reading agent.
- **Nested 7-field `parent` object** (`sqlite-store.ts`) that is 5 dups +
  1 constant + 1 mostly-useless field. The parent is (by construction of the
  indexer's per-file heading stack) in the **same file** as the child, so
  `root` / `path` / `docType` repeat the child, `score` is a hard-coded `0`, and
  `snippet` literally repeats the parent's own `headingPath`. Only `headingPath`
  carries display value.
- **Pretty-print + repeated keys.** `null, 2` inflates every hit; the field
  names repeat on all N hits for zero new information after hit #1.

The CLI (`cli.ts:221`) already renders a hit compactly — same fields and order
the tool wants, differing only by a leading token and the parent glyph. The tool
throws that away and dumps the full object. Net effect: a ~14-line blob per hit
where a 2-line entry carries the same decision-relevant facts (which path/section
to open next).

Diligence confirmed **nothing parses the tool's text output**: `tool-summary.ts`
reads only the `query` input; `eval.ts` ranks by array **index** (not `.score`).
Flipping the default output format breaks no consumer.

## What Changes

- **One parameterized renderer** serves both the tool and the CLI:
  `renderHits(hits, { leading: "score" | "rank", parentGlyph, multiline })`. The
  tool calls it with `leading:"rank"`, multi-line; the CLI keeps `leading:"score"`,
  single-line. Same fields/order — DRY, no duplicated line logic.
- **Default tool output → condensed** (`leading:"rank"`, multi-line). Per hit:
  `<rank>  <path>  ::  <headingPath>`, a `(+N dup)` marker when `akaPaths` is
  present, a `⤷ <parentHeading>` continuation when parent context exists, and the
  one-line snippet. Positional, keys dropped, pretty-print gone.
- **`rank` in condensed output** = a 1-based ordinal the renderer assigns over
  the (already-sorted, post-limit) hit list. The raw BM25 `score` is not shown in
  condensed mode; it stays on `KbHit.score` and in JSON mode.
- **New `format` parameter**: `"condensed"` (default) | `"json"`. Declared as a
  free `Type.String()` and validated **in-body** against the allowlist — an
  unknown / malformed / omitted value falls back to `"condensed"` and never
  raises (a strict Typebox `Literal` union would hard-reject before `execute()`,
  contradicting "never errors").
- **JSON mode** returns compact (non-pretty) JSON, **retains** `score`, adds
  `rank`. Rationale: JSON's reader is tooling/ranking-debug (wants the raw score
  the CLI also shows); the condensed reader is the agent (wants rank). Compact
  (dropping `null, 2`) is intentional and stated, not incidental.
- **Collapse `parent`** (both formats): `KbHit.parent` tightens from a full
  `KbHit` to `{ headingPath }` — drop `root`/`path`/`docType` (same-file dups),
  `score` (hard-coded `0`), `snippet` (repeats `headingPath`), and `chunkId`
  (the `kb_get` tool keys on `(path, section)`, not `chunkId`, so it is not
  tool-consumable, and it is no more reliable than `headingPath` under the
  deferred sibling bug). Applied at the source (`sqlite-store.ts` `expandParent`).
  `parent.headingPath` is **display/context only** — NOT a refetch key.
- **Empty/whitespace query** returns a consistent explicit marker per format
  (condensed `(no query)`, JSON `[]`); the current empty guard is moved after the
  `format` parse so it can honor the selected format.
- **Tool description rewritten** to describe the condensed default shape, document
  the `[ ]` FTS match markers, teach `format:"json"` (discoverability), and drop
  the stale `Returns {…}` JSON-object claim.

Non-goals / deferred (separate changes):
- `parentChunkId` appears to point at a **sibling** section, not the enclosing
  Requirement — a correctness bug tracked separately. This change does not fix it
  and does not rely on `chunkId` (dropped).
- Rebalancing the 22-line AGENTS.md "Docs-First Gate" against the 2-line
  `promptGuidelines` — token cleanup, separate change.

## Impact

- Affected specs: `markdown-knowledge-base` (parent-expansion shape + a new
  output-format requirement).
- Affected code: `packages/kb-extension/src/extension.ts` (kb_search `format`
  param, in-body validation, description rewrite, condensed render call,
  empty-query marker), `packages/kb/src/sqlite-store.ts` (parent collapse),
  `packages/kb/src/types.ts` (`KbHit.parent` type), `packages/kb/src/cli.ts`
  (call the shared renderer with `leading:"score"`), plus the shared renderer's
  home.
- **Public-API / semver**: `KbHit` is exported from the published
  `@blackbelt-technology/pi-dashboard-kb`. Narrowing `KbHit.parent` from
  `KbHit | null` to `{ headingPath } | null` is a **breaking type change**: it
  binds every `KbStore` backend + the in-memory test double and makes `parent`
  **non-recursive** (`hit.parent.parent` was type-valid, now a type error;
  verified no source reads it). Flag it in the CHANGELOG as breaking.
- **Accepted trade-off**: dropping `parent.path`/`root` removes the only signal
  that would surface a (astronomically rare, 32-bit `fileSha8`) chunk-id
  collision resolving a parent cross-file. The KB is deterministic and
  rebuildable; the risk is pre-existing and not worsened in practice.
- Behavior: default tool output changes from pretty JSON to condensed text. No
  parser consumes the old shape (verified). `store.search()` changes only in the
  `parent` sub-shape; `score` stays on every hit.

## Discipline Skills

- `review-code` — non-trivial change to a shared, published return contract, before commit.
- `code-simplification` — the change *is* a simplification; keep the renderer lean.
