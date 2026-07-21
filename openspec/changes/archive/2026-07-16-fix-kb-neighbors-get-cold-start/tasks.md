# Tasks — self-populate a cold KB on kb_neighbors / kb_get

## 1. Helper
- [x] 1.1 Add `ensurePopulated(state, cwd)` to
      `packages/kb-extension/src/reindex.ts`: return early if `!existsSync(cwd)`;
      `const { store } = getKb(state, cwd)`; if `store.counts().chunks === 0`
      run `await reindexNow(state, cwd)`. No throw on failure — caller guards.

## 2. Wire the tools
- [x] 2.1 In `packages/kb-extension/src/extension.ts` `kb_neighbors` handler,
      `await ensurePopulated(state, cwd)` inside a `try/catch` (warn + continue),
      before `getKb` / `store.neighbors`.
- [x] 2.2 Same for the `kb_get` handler, before `store.getChunk`.
- [x] 2.3 Leave `kb_search` unchanged (already self-populates via its freshness
      `reindexNow`).

## 3. Tests (TDD)
- [x] 3.1 Cold `kb_neighbors`: build a cwd with sources but no index; assert the
      first call returns populated nodes (index built).
- [x] 3.2 Cold `kb_get`: same setup; assert the first call returns the section
      body, not "(not found)".
- [x] 3.3 Warm path: with a populated index, assert `kb_neighbors` / `kb_get`
      run no reindex walk (spy/counter on `reindexNow` or assert `counts()`
      unchanged and no extra index pass).
- [x] 3.4 Failure degrade: force `reindexNow` to throw on an empty index; assert
      the tool still returns a well-formed empty result, not an exception.

## 4. Docs
- [x] 4.1 Update per-file `AGENTS.md` rows for `reindex.ts` (new `ensurePopulated`
      export) and `extension.ts` (neighbors/get cold-start populate) with
      `See change: fix-kb-neighbors-get-cold-start`.

## 5. Validate
- [x] 5.1 `openspec validate fix-kb-neighbors-get-cold-start --strict`.
- [x] 5.2 `HOME=$(mktemp -d) npx vitest run packages/kb-extension` green.
