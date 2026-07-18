## 1. Lint fixes: inline-row count + severity split (prerequisite)

- [x] 1.1 In `packages/kb/src/dox.ts`, add a **sibling** `countInlineRows(af): number` (do NOT change `parseRowPaths` — it is a public export consumed by `packages/kb-extension/src/reindex.ts` as a `string[]`; changing its shape breaks kb-extension and the missing/orphan/staleness checks). `countInlineRows` counts rows under the `# DOX` heading whose purpose does NOT match `/→ see `[^`]+\.AGENTS\.md`/` (the sidecar-pointer marker `scripts/split-large-agents.mjs` writes on promotion).
- [x] 1.2 Change the over-threshold row check from `parseRowPaths(af).length > ROW_CAP` to the **inline** count > `ROW_CAP`. Keep the byte check on total file bytes unchanged. `ROW_CAP`/`AGENTS_BYTE_CAP` numeric values unchanged.
- [x] 1.3 Split the `over-threshold` emission into two arms: a byte arm (`bytes > AGENTS_BYTE_CAP`) tagged actionable and a row arm (inline count > `ROW_CAP`) tagged informational. Add a discriminator field (e.g. `arm: "bytes" | "rows"`) to the `DoxIssue` for `over-threshold`. Update the `detail` strings so row-only reads "informational (advisory; no per-turn injection cost)" and reports the inline count.
  (Lint-behavior tests are folded as scenarios E1–E10, X1–X2 in §8.)
- [x] 1.4 `cd packages/kb && npm run build` to refresh `dist/cli.js`; run `packages/kb-extension` tests to confirm `parseRowPaths` consumers (`acknowledgeRows`/`decideNudge`) are unaffected. Run `node_modules/.bin/kb dox lint --json` and confirm each current row-over flag is re-evaluated on the inline count and carries the informational arm, and 0 carry the byte arm.
- [x] 1.5 Update `packages/kb/src/AGENTS.md` `dox.ts` row purpose to record the inline-count fix + severity split (caveman style, add `See change: fold-oversized-agents-directories`).

## 2. Rollup directory decomposition — `qa/` (doc-only)

- [x] 2.1 Create `qa/packer/AGENTS.md`, `qa/tests/AGENTS.md`, `qa/fixtures/AGENTS.md`, `qa/scripts/AGENTS.md` with a `# DOX — qa/<sub>` heading each.
- [x] 2.2 Move every `qa/AGENTS.md` row whose path is under a subdir into the owning subdir `AGENTS.md`, path rewritten relative to that file, purpose + `See change:` preserved verbatim. Leave only the 3 root-level `qa/` files in `qa/AGENTS.md`.
- [x] 2.3 Run `node_modules/.bin/kb dox lint` and confirm `qa/AGENTS.md` no longer over-threshold and no new `missing`/`orphan` for the moved rows.

## 3. Rollup directory decomposition — `docker/` (doc-only)

- [x] 3.1 Create `docker/fixtures/AGENTS.md` (+ `docker/scripts/AGENTS.md` if its single row is not already owned) with proper `# DOX —` headings.
- [x] 3.2 Move the 30 `fixtures/*` rows (and the `scripts/*` row) out of `docker/AGENTS.md` into the owning subdir files, paths rewritten relative, purposes preserved.
- [x] 3.3 `kb dox lint` confirms `docker/AGENTS.md` cleared; no new `missing`/`orphan`.

## 4. Fold `packages/client/src/components/` (source move)

- [x] 4.1 Finalize the file→subfolder assignment from design D4: read each file's role; **absorb root-level files into the 11 existing subfolders** (`preview/`, `chat/`, `split/`, `tool-renderers/`, `Gateway/`, `DirectorySettings/`, `editor-pane/`, `extension-ui/`, `interactive-renderers/`, `tags/`) where one fits; create a new subfolder only for an un-homed domain and NEVER a name that collides with an existing subfolder. Nest a further level for any domain > `ROW_CAP`.
- [x] 4.2 Move files with `git mv` into the chosen subfolders; run the ts-morph codemod (D3) to rewrite every ESM import specifier (preserving the `.js`-on-`.tsx` convention). Then `git grep -nE '"packages/client/src/components/[A-Za-z0-9_-]+\.tsx?"'` and update every **string-literal path reference** (esp. `packages/shared/src/__tests__/no-*.test.ts` allowlists) in the same commit. No new barrels.
- [x] 4.3 `npx tsc --noEmit` (client package) green; `npm test` green (catches string-literal ref breakage `tsc` misses); `npm run build` green; `doxLint` on `components/` subtree shows `components/AGENTS.md` + each subfolder inline ≤ 40. (test-plan #X4: components fold complete · tsc+test+build+doxLint · all green + inline ≤ 40 / >40 nested-or-accepted)
- [x] 4.4 `kb dox init` scaffolds each new subfolder `AGENTS.md`; author/migrate one row per moved file (purpose + `See change:` preserved for existing rows; source-derived caveman purpose for any uncovered file). Moved-file rows are DELETED from `components/AGENTS.md` (each file is now owned by its subfolder `AGENTS.md`; the tree is walked, no per-subfolder pointer rows); `components/AGENTS.md` inline count drops as its rows leave.
- [x] 4.5 `kb dox lint`: `components/AGENTS.md` row count ≤ 40; each new subfolder `AGENTS.md` ≤ 40; no `missing`/`orphan`/`stale`.

## 5. Fold `packages/server/src/` (source move)

- [x] 5.1 Finalize file→subfolder assignment from design D4: absorb root files into the 7 existing subfolders (`model-proxy/`, `routes/`, `tunnel-providers/`, `browser-handlers/`, `lib/`, `rpc-keeper/`, `test-support/`) where they fit; new subfolders for un-homed domains; no name collisions; nest for any domain > `ROW_CAP`.
- [x] 5.2 `git mv` into subfolders + ts-morph import-specifier rewrite (server package + any cross-package importers of `packages/server/src/*`). Then `git grep -nE '"packages/server/src/[A-Za-z0-9_-]+\.ts"'` and update every string-literal path reference (the `no-*.test.ts` allowlists carry many `packages/server/src/*` strings) in the same commit.
- [x] 5.3 `npx tsc --noEmit` green; `npm test` green; server boots (`pi-dashboard start` health `/api/health` 200); `doxLint` shows `server/src/AGENTS.md` + subfolders inline ≤ 40. (test-plan #X5: server/src fold complete · tsc+test + start dashboard · green + /api/health 200 + inline ≤ 40; see qa/tests/02-server-start.sh)
- [x] 5.4 Scaffold + author subfolder `AGENTS.md` (migrate/author one row per file, no empty-purpose rows); DELETE moved-file rows from `server/src/AGENTS.md` (files owned by their subfolder `AGENTS.md`; no per-subfolder pointer rows).
- [x] 5.5 `kb dox lint`: `server/src/AGENTS.md` ≤ 40; subfolders ≤ 40; clean.

## 6. Fold `packages/client/src/lib/` (source move)

- [x] 6.1 Finalize file→subfolder assignment from design D4 (`lib/` has only `__tests__/` — all new subfolders; no collisions; nest for any domain > `ROW_CAP`).
- [x] 6.2 `git mv` + ts-morph import-specifier rewrite (repo-wide importers of `lib/*`, preserving `.js` specifiers). Then `git grep -nE '"packages/client/src/lib/[A-Za-z0-9_-]+\.tsx?"'` and update every string-literal path reference in the same commit.
- [x] 6.3 `npx tsc --noEmit` green; `npm test` green; `npm run build` green; `doxLint` shows `lib/AGENTS.md` + subfolders inline ≤ 40; every repo-wide importer of `lib/*` resolves. (test-plan #X6: lib fold complete · tsc+test+build+doxLint · all green + inline ≤ 40)
- [x] 6.4 Scaffold + author subfolder `AGENTS.md` (migrate/author one row per file, no empty-purpose rows); DELETE moved-file rows from `lib/AGENTS.md` (files owned by their subfolder `AGENTS.md`; no per-subfolder pointer rows).
- [x] 6.5 `kb dox lint`: `lib/AGENTS.md` ≤ 40; subfolders ≤ 40; clean.

## 7. Accept marginal residue + final verification

- [x] 7.1 Confirm the marginal dirs (`hooks/`, `extension/src/`, `shared/src/`, `tests/e2e/`) report the informational row-over arm only (no byte-over); leave them un-foldered per design non-goals. Resolve OQ1/OQ2 explicitly (fold-if-free vs defer).
- [x] 7.2 Full `npm test` + `npm run build` green on the final tree.
- [x] 7.3 `node_modules/.bin/kb dox lint --json`: 0 byte-over, 0 `stale`/`missing`/`orphan`/`missing-companion`; only accepted informational row-over remains.
- [x] 7.4 `openspec validate fold-oversized-agents-directories` passes.

## 8. Automated test scenarios (folded from test-plan.md)

All L1 rows extend `packages/kb/src/__tests__/kb.test.ts` (existing `kb dox lint` cases) unless noted. Each carries its Triple (input · trigger · observable) and a `(test-plan #id)` back-reference.

- [x] 8.1 E1 — L1: fixture `AGENTS.md`, exactly 40 inline rows, <30000 bytes · run `doxLint` · NO `over-threshold` (40 == cap, not `>`). (test-plan #E1; see packages/kb/src/__tests__/kb.test.ts)
- [x] 8.2 E2 — L1: fixture 41 inline rows, <30000 bytes · `doxLint` · one `over-threshold` `arm:"rows"`, count 41. (test-plan #E2)
- [x] 8.3 E3 — L1: fixture 45 rows, 6 carry `→ see \`X.AGENTS.md\`` (39 inline), <30000 bytes · `doxLint` · NO row-arm `over-threshold` (pointers excluded). (test-plan #E3)
- [x] 8.4 E4 — L1: fixture row A `… → see \`Foo.AGENTS.md\`` + row B prose `documents the Foo.AGENTS.md sidecar` · `countInlineRows` · A excluded, B counted (regex `/→ see \`[^\`]+\.AGENTS\.md\`/` only, no prose false-positive). (test-plan #E4)
- [x] 8.5 E5 — L1: fixture inline ≤40 AND bytes <30000 · `doxLint` · no `over-threshold` at all. (test-plan #E5)
- [x] 8.6 E6 — L1: fixture bytes >30000 AND inline ≤40 · `doxLint` · one `over-threshold` `arm:"bytes"` (actionable, sidecar-split remedy). (test-plan #E6)
- [x] 8.7 E7 — L1: fixture inline >40 AND bytes <30000 · `doxLint` · one `over-threshold` `arm:"rows"` (informational). (test-plan #E7)
- [x] 8.8 E8 — L1: fixture inline >40 AND bytes >30000 · `doxLint` · two issues for the file: `arm:"bytes"` + `arm:"rows"`. (test-plan #E8)
- [x] 8.9 E9 — L1: fixture where `Foo.tsx`'s ONLY row is a sidecar-pointer row and `Foo.tsx` exists · `doxLint` + `parseRowPaths` · NO `missing` for `Foo.tsx`; `parseRowPaths` still returns its path (exclusion is count-only). (test-plan #E9)
- [x] 8.10 E10 — L1: real `hooks/`,`extension/src/`,`shared/src/`,`tests/e2e/` `AGENTS.md` post-fold, each <30000 bytes · `doxLint` on repo · each `arm:"rows"` informational OR no `over-threshold`; NONE `arm:"bytes"`; no source moved. (test-plan #E10)
- [x] 8.11 X1 — L1: fixture rollup tree (parent rows for `sub/*`, `sub/` has no `AGENTS.md`) · scaffold `sub/AGENTS.md` + move rows down + re-`doxLint` · no `missing`/`orphan`/`broken-pointer`; parent inline == root-only count; moved rows keep purpose + `See change:`. (test-plan #X1; see migrate-file-index.test.ts)
- [x] 8.12 X2 — L1: post-fold tree (`SessionCard.tsx` moved to `session/`, documented there, removed from parent) · run `kb dox init` · ZERO new rows for `SessionCard.tsx` (no re-home to parent; `ensure()` keys on path). (test-plan #X2)
- [x] 8.13 X3 — L1: move a source file named as a string in a `no-*.test.ts` allowlist WITHOUT updating the string · `npm test` (shared) · the allowlist test FAILS on the missing path (proves string refs load-bearing). (test-plan #X3; see packages/shared/src/__tests__/no-managed-dir-reference.test.ts)
- [x] 8.14 M1 — manual: reviewer confirms each new subfolder is a cohesive domain, not an arbitrary ≤40 bucket. (test-plan: manual-only)
