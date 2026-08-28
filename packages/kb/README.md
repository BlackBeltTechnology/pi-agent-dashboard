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

The `kb` bin runs `bin/kb.mjs`, a committed shim: it checks
`engine-fingerprint.json` (committed by `npm run build`) against the working
tree and rebuilds stale source automatically in a dev checkout — the bin and
the extension always run the same engine. In an installed package a mismatch
prints a loud warning; a missing `dist` hard-errors. CI enforces the same via
`scripts/check-kb-dist-fresh.mjs`.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
