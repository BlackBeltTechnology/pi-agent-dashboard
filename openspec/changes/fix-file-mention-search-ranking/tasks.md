## 1. Rewrite searchFiles (bridge)

- [x] 1.1 In `packages/extension/src/command-handler.ts`, add `const MAX_VISITS = 4000;` (entries scanned budget) and raise `MAX_RESULTS` from 20 to 50.
- [x] 1.2 Refactor `walk()` to count *entries scanned* against `MAX_VISITS` (not matches against `MAX_RESULTS`), preserving the `depth > 6` guard and `IGNORE_DIRS` skip. Collect every substring match into a `candidates[]` array — do NOT stop at any match count.
- [x] 1.3 Add a pure `splitQuery(lowerQuery)` helper: if the query contains `/`, return `{ prefix: query up to and including last "/", leaf: remainder }`; else `{ prefix: "", leaf: query }`.
- [x] 1.4 Add a pure `scoreMatch(relPath, leaf)` helper scoring `leaf` against the candidate basename: 4 exact basename, 3 basename prefix, 2 basename substring, 1 path substring (fallback); empty leaf → 0. Candidates pre-filtered to those whose path contains `prefix` (when prefix non-empty); a non-empty leaf that scores 0 (not in basename or path) is dropped.
- [x] 1.5 After collecting + filtering candidates, sort by `score desc, depth asc, pathLen asc, path alpha asc`, then `slice(0, MAX_RESULTS)`. Return the sliced, ranked list.
- [x] 1.6 Keep `searchFiles` signature `(cwd, query) => FileEntry[]` and the `list_files` handler call site unchanged.

## 2. Tests

- [x] 2.1 Unit tests for `searchFiles` (export it or test via the `list_files` handler) in `packages/extension/src/__tests__/`:
  - Exact basename match ranks above prefix, prefix above substring, substring above path-only hit.
  - Among equal scores, shallower depth wins; among equal depth, shorter path wins; final order is alphabetical and deterministic.
  - Bare `@` (empty query) returns top-level entries first, alphabetically — not deep files.
  - Slash-aware split: `@x/db/co` filters to candidates under `x/db/` and ranks `co` as a basename (e.g. `x/db/conn.ts` before `x/db/proto.co`); a candidate outside `x/db/` is excluded.
  - Bare directory query `@x/db` surfaces the directory `x/db/` and its contents; trailing-slash `@x/db/` lists contents ordered by depth/alpha.
  - A deep first-subtree no longer starves sibling top-level matches (regression test for the DFS-budget bug): construct a tree where >20 files live under `a/deep/...` and a target file sits at root; assert the root file appears.
  - Cap is applied AFTER ranking: with >50 matches, the 50 returned are the highest-ranked, and length === 50.
  - `IGNORE_DIRS` and `depth > 6` still pruned.
- [x] 2.2 `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|✗' /tmp/pi-test.log` — confirm green.

## 3. Spec + docs

- [x] 3.1 Apply the `file-autocomplete` delta in this change (`specs/file-autocomplete/spec.md`): replace "up to 20 entries" requirement, add ranking + bare-`@` ordering requirements.
- [x] 3.2 `openspec validate fix-file-mention-search-ranking --strict` passes.
- [x] 3.3 Update the matching `docs/file-index-extension.md` row for `command-handler.ts` with a `See change: fix-file-mention-search-ranking` annotation describing ranked-then-capped `searchFiles` (delegate the docs write per AGENTS.md caveman rule).

## 4. Ship

- [x] 4.1 `npm run reload:check` (reload sent to all sessions; global type-check gate blocked only by pre-existing unrelated jimp errors in `image-fit-extension`; `command-handler.ts` type-checks clean in isolation) (type-check + reload connected pi sessions so the new bridge `searchFiles` is live).
- [x] 4.2 Manual smoke (expect top-level entries), `@<common-basename>` (expect name matches first), and a query with >50 hits (expect 50 best).
