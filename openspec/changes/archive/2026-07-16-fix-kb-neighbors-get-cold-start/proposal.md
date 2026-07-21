# Self-populate a cold KB on kb_neighbors / kb_get

## Why

When the KB toolset is **active** (the `kb-extension` is loaded and registers
`kb_search` / `kb_neighbors` / `kb_get`) but the index has **never been built**
for the cwd, the three tools behave inconsistently:

```
 kb_search    → await reindexNow() → search       ✅ self-populates on cold start
 kb_neighbors → getKb() (opens an EMPTY store) → neighbors()   ❌ returns nothing
 kb_get       → getKb() (opens an EMPTY store) → getChunk()    ❌ returns "(not found)"
```

`kb_search`'s handler runs a freshness `reindexNow()` before searching, so a
cold cwd self-initializes on the first search. `kb_neighbors` and `kb_get` call
`getKb()` only — which *creates* the SQLite store (`mkdirSync` + `init`) but
never populates it — so on a never-indexed cwd they return empty results even
though the KB is active and the source files exist.

This is a correctness gap, not just polish: an agent that (per the READ
discipline) reaches for `kb_neighbors` to chase callers, or `kb_get` to read a
section, gets a false "nothing here" on a fresh worktree before any `kb_search`
/ md-edit debounce / explicit `kb index` has run.

## What Changes

- Add a shared `ensurePopulated(state, cwd)` helper in `kb-extension`'s
  `reindex.ts`: open the store via `getKb`, and **only when it is empty**
  (`store.counts().chunks === 0`) run `await reindexNow(state, cwd)`. On a warm
  index it is a single `COUNT(*)` and a no-op.
- Call `ensurePopulated` at the top of the `kb_neighbors` and `kb_get` handlers,
  guarded by the same `try/catch` fallback `kb_search` already uses (a failed
  walk must not break the tool — degrade to the existing/empty store).
- `kb_search` is unchanged: it keeps its per-call freshness reindex (picks up
  edits since last index), which already covers cold start.

Explicitly NOT changing: the blocking nature of the first call (a genuinely
empty index means the first `neighbors`/`get` waits for the one-time build —
returning empty would be a worse contract), and the warm-path cost (the
empty-guard adds only a COUNT on a populated index).

## Impact

- `packages/kb-extension/src/reindex.ts` — add `ensurePopulated`.
- `packages/kb-extension/src/extension.ts` — call it in `kb_neighbors` + `kb_get`.
- Tests: `packages/kb-extension/src/__tests__/` — cold neighbors/get populate;
  warm neighbors/get run no walk (counts unchanged, no extra index pass).
- Docs: per-file `AGENTS.md` rows for `reindex.ts` + `extension.ts` gain the
  cold-start note + `See change: fix-kb-neighbors-get-cold-start`.

## Discipline Skills

- `systematic-debugging` — the fix targets an observed cold-start behavior gap;
  reproduce the empty-result path first, then make the minimal change.
