# Test Plan — add-kb-worktree-seed

Stage: design   Generated: 2026-10-17

Decisions applied (hard gate, answered by the user):
- **K1** speed-up → both: L1 timed test on a generated 600-file fixture in a real `git worktree add` with 5 % of files changed, seeded first index ≤ 0.35 × unseeded (median of 3 each), **and** an L1 structural assertion that the seeded run re-chunks exactly the changed/added files; the full-repo number is recorded once in the PR (manual row M1).

Legend: L1 = vitest. "Repo fixture" = a temp git repository created in the test (`git init`, commit N markdown files under `docs/` and `packages/`, `git worktree add <tmp>/wt`), the main checkout indexed by the current kb first. "Unseeded reference" = a first index of the worktree's tree with `--no-seed`. Graph/row equality is names-based as defined in `fix-kb-index-integrity` (nodes `(type,name,path)`, edges `(src name,dst name,rel)`).

Exemplar harness files (verified exist):
- `packages/kb/src/__tests__/kb.test.ts` — tmp fixture trees, `indexSource`, CLI spawn via `execFileSync(process.execPath, ["--import","tsx", …cli.ts …])` (line 938)
- `packages/kb/src/__tests__/index-atomicity.test.ts` — `runIndexAtomic`, temp handling
- `packages/kb/src/__tests__/git-scope-commits.test.ts` — temp git repositories via `child_process`
- `packages/kb/src/__tests__/frontmatter-indexing.test.ts` — config validation and gate records
- `packages/kb-extension/src/__tests__/reindex.test.ts` — cold populate path
- `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts` — dashboard reindex job
- `packages/shared/src/platform/__tests__/git-checkout-roots.test.ts` — the shared resolver's scenarios, mirrored for D1

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | exemplar | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------|
| E1 | seed › Seeded first index equals a first index | equivalence | L1 | automated | git-scope-commits.test.ts + kb.test.ts | repo fixture 60 files; worktree edits 3, adds 2, deletes 2 | worktree `kb index` (seeded) vs unseeded reference | files, chunks (body+heading_path), properties, nodes, edges set-equal; stderr `[kb] seed=<main> sources=2/2` |
| E2 | seed › only differing files re-chunked (K1 structural) | equivalence | L1 | automated | kb.test.ts | as E1 | seeded run's `IndexStats` | `changed` = 5 (3 edited + 2 added); `deleted` ≥ 2 |
| E3 | seed › Files only in the main checkout do not reach the worktree | EP | L1 | automated | kb.test.ts | main has untracked `docs/notes/private.md` indexed | worktree seeded first index | 0 rows in files/chunks/properties for that path; no node with that path or name |
| E4 | seed › Same mtime, different content | BVA | L1 | automated | kb.test.ts | worktree file `docs/a.md` with content changed and `utimes` set to main's recorded mtime | seeded first index | `docs/a.md` chunks match worktree content (new token searchable, old token not) |
| E5 | seed › Source with a mismatched record | decision table | L1 | automated | frontmatter-indexing.test.ts | main `gate:docs` stale hash, `gate:packages` current | seeded first index | `packages` re-chunk count = its changed files only; every `docs` file re-chunked; log `sources=1/2` |
| E6 | seed › Rows from another kb engine are not kept | decision table | L1 | automated | frontmatter-indexing.test.ts | main `engine:docs` = `X`, running engine `Y` | seeded first index | every `docs` file re-chunked; equality with unseeded reference holds |
| E7 | seed › Engine change forces a source once | state | L1 | automated | index-atomicity.test.ts | DB with `engine:docs` = `A`, files unchanged | pass with running engine `B` | `changed` = all `docs` files; `engine:docs` = `B`; a following pass with `B` has `changed` = 0 |
| E8 | seed › Interrupted forced pass leaves no engine record | fault-injection (kill) | L1 | automated | kb.test.ts (CLI spawn) | DB with `engine:docs` = `A`; running `B`; 300-file source | `kb index` child `SIGKILL`ed after its first committed batch | `engine:docs` absent; worktree seeding from it keeps no `docs` rows; next pass forces `docs` |
| E9 | seed › Unconfigured source rows are dropped | EP | L1 | automated | kb.test.ts | main config has extra source `extra`, worktree config does not | seeded first index | 0 rows with root `extra`; no `gate:extra` / `engine:extra` |
| E10 | seed › Source not walked is dropped (missing) | EP | L1 | automated | kb.test.ts | configured source dir present in main, deleted in worktree | seeded first index | 0 seeded rows for that root; no nodes for its files |
| E11 | seed › Source not walked is dropped (not passed) | EP | L1 | automated | kb-routes.test.ts | trusted remote source in main's DB; untrusted in the worktree, so the dashboard job does not pass it | dashboard job's first index | 0 rows with that root |
| E12 | seed › No main checkout (decision table) | decision table | L1 | automated | git-scope-commits.test.ts | main checkout itself; non-git dir; worktree of a bare repository | first index | log `not-a-worktree` / `not-a-worktree` / `no-main-checkout`; no snapshot file created |
| E13 | seed › Worktree of a submodule | EP | L1 | automated | git-scope-commits.test.ts | superproject with submodule `sub` indexed; `git -C sub worktree add` | first index in that worktree | log `seed=<sub checkout>`; equality with unseeded reference |
| E14 | D1 › `core.worktree` override and failing probe | decision table | L1 | automated | git-scope-commits.test.ts | repo-local `core.worktree` → alt checkout; `core.worktree` read made to fail (git shim exit 128) | `findMainCheckout` | alt checkout path; none (no fall-through to the `.git` parent) |
| E15 | D1 › `core.bare` boolean forms | decision table | L1 | automated | git-scope-commits.test.ts | common dir `.git` with `core.bare` unset / `false` / `yes` / unanswerable (shim timeout) | `findMainCheckout` | parent / parent / none / none |
| E16 | seed › Seeding disabled | decision table | L1 | automated | kb.test.ts | `seedFromMainWorktree:false`; `--no-seed`; `--source docs` | first index | no snapshot; no staleness copy; log `seed-skipped=disabled` each |
| E17 | seed › Custom database path | decision table | L1 | automated | kb.test.ts | `dbPath` absolute outside worktree; `--db /tmp/x.db` | first index | log `seed-skipped=custom-dbpath` each |
| E18 | seed › Main has no index / building / empty | decision table | L1 | automated | index-atomicity.test.ts | main `dbPath` absent; absent + live fresh tmp marker; 0-byte file | first index | `no-main-index` / `main-building` / `no-main-index`; unseeded result |
| E19 | seed › reason precedence | decision table | L1 | automated | kb.test.ts | `--no-seed` in a non-git dir; custom `--db` in a worktree whose main has no index | first index | `disabled`; `custom-dbpath` |
| E20 | config › Non-boolean seedFromMainWorktree | EP | L1 | automated | frontmatter-indexing.test.ts | `seedFromMainWorktree: "yes"` | `loadConfig` | throws, message names `seedFromMainWorktree` |
| E21 | seed › DOX acknowledgements copied (decision table) | decision table | L1 | automated | kb.test.ts | main file `{version:2,…}`; legacy map (no version); `{version:1,…}`; corrupt JSON; absent; worktree file already present | seeded first index | copied / copied / not copied / not copied / not copied / worktree file unchanged; run succeeds each |
| E22 | seed › staleness copy never fails the run | fault-injection | L1 | automated | kb.test.ts | target dir made read-only | seeded first index | exit 0; stderr `[kb] seed-staleness-skipped=EACCES` |
| E23 | seed › every writer seeds | decision table | L1 | automated | reindex.test.ts + kb-routes.test.ts | repo fixture worktree without `dbPath` | first index via `kb index` / CLI `kb search` auto-index / kb-extension cold populate / dashboard job | each logs `seed=<main>`; each result equals the unseeded reference |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | proposal goal (K1 timed) | timed ratio | L1 | automated | repo fixture with 600 md files × 8 headings, worktree with 30 files (5 %) changed | median seeded first index ≤ 0.35 × median unseeded first index | 3 runs each, same process |
| M1 | proposal goal (full repo) | measurement | — | manual-only | `git worktree add` of this repository | seeded vs unseeded first index wall time | once, same machine, recorded in PR description |

### Frontend-quirk (async convergence)

| id | requirement | technique | level | disposition | exemplar | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------------------|
| F1 | seed › Main checkout keeps working during the snapshot | state-convergence | L1 | automated | kb.test.ts (child process) | main DB 600 files; child writer commits 20 transactions of ≤ 50 ms each into main | worktree seeded first index concurrently | all 20 writer commits succeed (no `SQLITE_BUSY`); the worktree run succeeds; main row counts after = before + writer's rows |
| F2 | seed › snapshot includes WAL-only commits | state | L1 | automated | kb.test.ts (child process) | main writer commits 5 chunks for a new file and keeps its connection open (no checkpoint) | worktree seeded first index, then compare | the new file's seeded rows exist in the snapshot (asserted via a test hook before the walk) |
| F3 | seed › main database contents not modified | invariant | L1 | automated | kb.test.ts | main DB with known `SELECT count(*)`/`sha256` of every table's sorted rows | worktree seeded first index | identical counts and row hashes in main afterwards |

### Error-handling

| id | requirement | technique | level | disposition | exemplar | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------|
| X1 | seed › Seed failure reruns unseeded (snapshot) | fault-injection (abort) | L1 | automated | index-atomicity.test.ts | main `dbPath` contains 4 KiB of garbage | worktree first index | exit 0; log `seed-skipped=snapshot-error`; result equals unseeded reference; no `<dbPath>.tmp-*` left |
| X2 | seed › Seed failure reruns unseeded (seeded walk) | fault-injection (abort) | L1 | automated | index-atomicity.test.ts | injected throw on the first file of the seeded walk only | worktree first index | exit 0; exactly one rerun; log `snapshot-error`; result equals unseeded reference |
| X3 | seed › rerun failure fails the run | fault-injection (abort) | L1 | automated | index-atomicity.test.ts | injected throw on every walk (seeded and unseeded) | worktree first index | exit ≠ 0; no `dbPath`; no tmp left |
| X4 | D2 › leftover tmp and sidecars | fault-injection (stale files) | L1 | automated | index-atomicity.test.ts | pre-existing `<dbPath>.tmp-<pid>`, `-wal`, `-shm` with foreign rows, same PID | worktree first index | seeded result has no foreign rows; log `seed=…` |
| X5 | D3 › old-writer map (no `item_rows`) | fault-injection (legacy data) | L1 | automated | index-atomicity.test.ts | main DB with all docs `item_rows` deleted and an unconfigured source `extra` | worktree seeded first index | 0 rows under `extra` (drops used the reconciled map); equality with unseeded reference |
| X6 | D3 › post-walk drop sweeps placeholders | state | L1 | automated | kb.test.ts | configured source missing in the worktree; its files linked by no kept file | seeded first index | no path-less node named after its files; node set equals unseeded reference |

---

## Coverage summary

- Requirements covered: 2/2 (pipeline seed requirement — all 17 scenarios; config validation — new scenario).
- Scenarios by class: edge 23 · perf 2 · frontend 3 · error 6
- Scenarios by level: L1 33 · manual 1
- Scenarios by disposition: automated 33 · manual-only 1

## New infra needed

- A repo-fixture helper (temp git repo + `git worktree add`, optional submodule and bare variants) in `packages/kb/src/__tests__/helpers/`; `git-scope-commits.test.ts` already creates temp repositories via `child_process`.
- A git shim (PATH-prefixed script) for the unanswerable-probe rows E14/E15.
