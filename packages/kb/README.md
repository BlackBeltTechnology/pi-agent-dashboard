# Pi Dashboard KB

Directory-based SQLite/FTS5 knowledge base over markdown, queryable by LLM agents.

Structural heading chunking, a Tier-1 heading graph, content-hash incremental
indexing, near-duplicate dedup, and BM25F ranking. Zero runtime dependencies —
built on `node:sqlite`.

## Install

```bash
npm install -g @blackbelt-technology/pi-dashboard-kb
kb search "how does pairing work"
kb agents packages/server/src/index.ts
kb dox lint
```

Pair it with `@blackbelt-technology/pi-dashboard-kb-extension` to expose `kb_search`,
`kb_get` and `kb_neighbors` as pi tools.

## Sources

`.pi/dashboard/knowledge_base.json` lists `sources[]`. The kind comes from an
explicit `kind` or is inferred from `ref`:

```json
{ "sources": [
  { "ref": "docs" },
  { "ref": "https://github.com/owner/repo" },
  { "ref": "https://github.com/owner/repo/tree/dev", "subdir": "docs" },
  { "ref": "ssh://git@github.com/owner/private" },
  { "ref": "https://raw.githubusercontent.com/owner/repo/main/README.md" }
] }
```

A GitHub repository URL (optionally `.git`, `@<ref>` or `/tree/<ref>`) and an
`ssh://` URL are cloned as `git` sources. Raw file and archive URLs are fetched
as `https`; an https fetch that yields an HTML page or a file without an
indexable extension fails with a hint instead of indexing nothing. Remote
sources are indexed by `kb index` (they prompt for trust once); the live
extension auto-reindexes filesystem sources only.

`kb get <path>` / `kb_get` look in every indexed source. A path indexed in more
than one source returns a candidate list (`<source-id>:<path>`) instead of a
body; pass a candidate back, or qualify the path by its source directory.
`--section` / `section` accepts a full heading path or a unique last heading.

## Evaluate retrieval (kb eval)

```bash
kb eval --golden golden.json [--limit N] [--doc-type doc|agents|source-md]
        [--allow-zero] [--verbose] [--json]
```

`--golden` accepts two fixture shapes:

- a **bare array** of `{"q": "...", "expect": "path-substring"}` items;
- an **object with an `items` array** (the bundled `eval/golden.*-intent.json`
  shape — its `intent`/`minedAt` provenance prints a stderr run header).

Anything else — including `eval/golden.provenance.json`, which is mining
metadata, not a fixture — is rejected with a diagnostic naming both accepted
shapes. Items must carry string `q` and `expect`; a bad item names the file and
array index instead of silently scoring zero.

Scoring normalizes repo-relative `expect` values against the configured roots:
an `expect` of `packages/foo/AGENTS.md` matches the indexed path
`foo/AGENTS.md` (longest prefix wins, separator-checked, so `packages` never
strips against `packages-x/`). Items whose `expect` lies under a directory no
root can reach are counted in the `unreachable` metric — reported, never
searched, excluded from every other metric (`n + unreachable` always sums to
the fixture size). Pass `--verbose` to list the unreachable paths on stderr.

A **vacuous run fails loudly**: zero scored items or zero recall exits non-zero
with a stderr diagnostic (an all-zero score is far more often a harness fault
than a retrieval fault), while still printing the metrics JSON on stdout.
Pass `--allow-zero` to measure a deliberately broken setup anyway.

`kb eval` scores the same `SearchOpts` the `kb_search` tool passes — both are
built by one shared `searchOptsFromConfig` helper.

## Engine freshness

The `kb` bin runs `bin/kb.mjs`, a committed shim. In a **development checkout**
it checks `engine-fingerprint.json` (committed by `npm run build`) against the
working tree and rebuilds stale source automatically, so the bin and the
extension always run the same engine. In an **installed package** a fingerprint
mismatch cannot self-heal: it is detected and printed as a loud warning while
the shipped `dist` runs unchanged, a malformed fingerprint hard-errors, and a
missing `dist` hard-errors. CI enforces commit discipline via
`scripts/check-kb-dist-fresh.mjs`, so the engines can only diverge if someone
edits `src` without rebuilding AND ignores CI.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
