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

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
