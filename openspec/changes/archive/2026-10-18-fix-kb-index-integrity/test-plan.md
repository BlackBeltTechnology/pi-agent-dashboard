# Test Plan — fix-kb-index-integrity

Stage: design   Generated: 2026-10-17

Decisions applied (hard gate, answered by the user):
- **K1** forced-pass cost → L1 timed test on a generated 600-file fixture, forced pass ≤ 1.5× first index (median of 3 runs each); the full-repo ≤ 1.3× number is recorded once in the PR (manual row M1).
- **K2** dashboard job waiting on another process's first index → `/api/kb/stats` reports `jobStatus: "running"`, `indexing: true` for the whole wait.
- **K3** CLI non-index commands during a live first index → print the building line, exit **75** (`EX_TEMPFAIL`).
- **K4** install log line → `[kb] install=<link|rename|backup> retries=<n> ms=<n>`; failure `[kb] install-failed=<busy-timeout|backup-error:<errcode>> retries=<n> ms=<n>` (stderr).

Legend: L1 = vitest. "Holder" = a child `node` process that opens `dbPath` with raw `node:sqlite`, sets WAL, writes, and stays open — a writer that does not honour the live-build marker (stands in for kb ≤0.9.0). Building line = `(index is still being built — no results available yet; retry shortly)`.

Exemplar harness files (verified exist):
- `packages/kb/src/__tests__/kb.test.ts` — `indexSource` over tmp fixture trees; spawns the CLI via `execFileSync(process.execPath, ["--import","tsx", …cli.ts …])` (line 938)
- `packages/kb/src/__tests__/index-atomicity.test.ts` — `runIndexAtomic`, temp/orphan sweep, failed-run cleanup
- `packages/kb/src/__tests__/git-scope-store.test.ts` — `replaceItem` inbound/outbound edge assertions
- `packages/kb/src/__tests__/frontmatter-indexing.test.ts` — facet config, property rows, gate hash
- `packages/kb-extension/src/__tests__/reindex.test.ts` — `reindexNow` / `ensurePopulated` / `state.inflight`
- `packages/kb-extension/src/__tests__/kb-search-tool.test.ts` — tool `execute` → text output
- `packages/kb-extension/src/__tests__/git-scope-tool.test.ts` — `scope: "git"` paths
- `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts` — `POST /api/kb/reindex`, `GET /api/kb/stats`
- `packages/server/src/git-worktree/__tests__/worktree-init.test.ts` — `evaluateGate`
- `scripts/__tests__/check-kb-dist-fresh.test.mjs` — dist / fingerprint freshness

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | exemplar | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------|
| E1 | fts5 › Schema version gate (hash coverage) | EP | L1 | automated | frontmatter-indexing.test.ts | config A; A with only `exclude`, `include`, `extensions`, `respectGitignore`, `indexAgentsFiles` changed (one at a time) | `indexOptionsHash` | equal to A's hash in all 5 cases |
| E2 | fts5 › Schema version gate (includeSourceMarkdown) | EP | L1 | automated | frontmatter-indexing.test.ts | `includeSourceMarkdown` unset / `true` / `false` | `indexOptionsHash` | unset == true; false ≠ true |
| E3 | fts5 › Stale version forces reindex | decision table | L1 | automated | index-atomicity.test.ts | source record: absent / `2:<h>` / `3:<other>` / `3:<h>` | one pass | forced: yes / yes / yes / no (forced = every file re-chunked, counted via `changed`) |
| E4 | fts5 › Skipped source stays due | decision table | L1 | automated | index-atomicity.test.ts | source outcome: completed / `missing` / untrusted / throws | pass ends | `gate:<root>` written: yes / no / no / no |
| E5 | fts5 › back-compat stamps | equivalence | L1 | automated | frontmatter-indexing.test.ts | DB after a successful new-code pass | read `user_version`, `facetConfigHash` | `3`; equals `frontmatterConfigHash(cfg.frontmatter)`; the pre-change gate predicate (`cli.ts` `runIndex` logic) evaluates not-stale |
| E6 | fts5 › Writers produce identical rows | equivalence | L1 | automated | frontmatter-indexing.test.ts + reindex.test.ts | config with custom facet key `team`; file with `team: core` | index via CLI `runIndexAtomic`, kb-extension `reindexNow`, kb-plugin `reindexAll` (3 fresh DBs) | identical chunk bodies and identical property rows incl. `team=core` in all 3 |
| E7 | pipeline › Same heading text in two files | EP | L1 | automated | kb.test.ts | `a.md`, `b.md` each `# Why` | index | nodes `a.md#Why`, `b.md#Why`; each `child_of` → own file node |
| E8 | pipeline › Re-chunking one file leaves another's headings | state | L1 | automated | kb.test.ts | E7 indexed | edit `a.md` body, reindex | `b.md#Why` node id and its `child_of` edge unchanged |
| E9 | pipeline › Inbound edges survive re-chunking the target | state | L1 | automated | git-scope-store.test.ts + kb.test.ts | `a.md` links `./b.md`; both indexed | edit `b.md`, reindex | `references` a.md→b.md present; `backlinks("b.md")` contains `a.md` |
| E10 | pipeline › Outbound edges replaced | state | L1 | automated | kb.test.ts | `a.md` links `./b.md` | change link to `./c.md`, reindex | edge a→c present, a→b absent |
| E11 | pipeline › Links to a deleted file kept as placeholder | state | L1 | automated | kb.test.ts | `a.md`→`b.md`, both indexed | delete `b.md`, reindex | `b.md` node `path IS NULL`; edge a→b present |
| E12 | pipeline › Unreferenced placeholders / tag swept | state | L1 | automated | kb.test.ts | placeholder with no edges; `a.md` only file with tag `x` | remove tag, reindex | placeholder gone; no `tag:x` node |
| E13 | mkb › Incremental graph equals first-index graph | state (sequence) | L1 | automated | kb.test.ts | 20-file fixture, 4 sources-free paths | 6 steps, reindex after each: edit body, add file, delete file, retarget link, change tag, rename heading | final nodes `(type,name,path)` and edges `(src name,dst name,rel)` set-equal to a first index of the final tree |
| E14 | pipeline › Forced pass equals a first index | equivalence | L1 | automated | index-atomicity.test.ts | populated DB of a 50-file fixture | `--force` pass | files, chunks (body+heading_path), properties, nodes, edges set-equal to a first index |
| E15 | fts5 › Graph neighbors (resolution) | decision table | L1 | automated | kb.test.ts | `a.md`,`b.md` with `# Why`; `c.md` with `# 100%_x`; file `d#e.md` with `# Why` | `neighbors(arg)` for `a.md#Why` / `Why` / `100%_x` / `100%_y` / `zzz#Why` | a's subtree only / union of a,b,d subtrees with all 3 origins excluded / only c's / empty / empty (no bare fallback for `#` args) |
| E16 | pipeline › Per-file replacement deletes exactly the file's chunks | EP | L1 | automated | kb.test.ts | 3 files, one with frontmatter (`:meta` chunk) | re-chunk file 1 | file 1's prior chunks (incl. `:meta`) gone, new present; files 2,3 chunk rowids unchanged |
| E17 | pipeline › Pre-existing database is backfilled | state | L1 | automated | index-atomicity.test.ts | DB built, then `DELETE FROM item_rows` | open store, re-chunk one file | `count(chunks WHERE path=f)` equals its new chunk count (no duplicates) |
| E18 | pipeline › Chunks written without the record are re-recorded | state | L1 | automated | index-atomicity.test.ts | DB with map; via raw SQL: delete file X's chunks (top rowids), insert file Y's chunks with equal count, no map rows | new-store pass re-chunks X and Y | no duplicates for X or Y; X's deletion removed no Y chunk |
| E19 | pipeline › Legacy heading names are re-chunked | state | L1 | automated | kb.test.ts | indexed `a.md`; raw SQL rewrites its heading node names to bare `Why` | next pass, `a.md` unchanged on disk | `a.md` re-chunked (`changed ≥ 1`); its heading nodes named `a.md#…` |
| E20 | pipeline › record cleared on chunks-schema migration | state | L1 | automated | index-atomicity.test.ts | DB with pre-v3 `chunks` schema + populated `item_rows` | open store (`migrateChunksSchema`) | docs rows of `item_rows` = 0 before the first pass |
| E21 | pipeline › File vanishing mid-walk | fault-injection | L1 | automated | kb.test.ts | 3 files indexed; `fs.statSync` spy throws `ENOENT` for file 2 | pass | resolves; file 2 rows removed and counted deleted; files 1,3 intact |
| E22 | pipeline › live-build marker predicate | decision table | L1 | automated | index-atomicity.test.ts | no tmp / tmp+dead PID / tmp+live PID mtime −10 s / −121 s / +60 s / tmp stale −300 s but `-wal` −5 s | `isFirstIndexLive` | false / false / true / false / false / true |
| E23 | pipeline › Orphan temp sweep | decision table | L1 | automated | index-atomicity.test.ts | tmp+dead PID; tmp+live PID mtime −10 min; tmp+live PID mtime −61 min | `sweepOrphanTemps` | removed / kept / removed |
| E24 | pipeline › Slow live build stays live | state (fake clock) | L1 | automated | kb.test.ts | injected clock; one batch whose per-file work advances 150 s | evaluate marker at t=150 s mid-batch | `utimesSync` called ≥ 4× during the batch; marker live |
| E25 | pipeline › backup retry predicate | decision table | L1 | automated | index-atomicity.test.ts | injected `backup` rejecting with `errcode` 0 / 5 / 6 / 26 / 10 | install over existing `dbPath` | retried / retried / retried / no retry / no retry |
| E26 | pipeline › Backup install retries (schedule) | BVA (fake timers) | L1 | automated | index-atomicity.test.ts | `backup` always busy | install | delays 100, 200, 400, 800, 1600, 2000… ms; gives up when next delay would pass 30 000 ms; stderr `[kb] install-failed=busy-timeout retries=<n> ms=<≤30000+last>` |
| E27 | pipeline › install branch selection | decision table | L1 | automated | index-atomicity.test.ts | injected `linkSync`: ok / `EEXIST` / `EPERM` with `dbPath` absent / `EPERM` with `dbPath` present | install | branch `link` / `backup` / `rename` / `backup` (asserted from the K4 log line) |
| E28 | pipeline › install log line (K4) | EP | L1 | automated | index-atomicity.test.ts | successful first index, no other opener | `kb index` | stderr matches `/^\[kb\] install=link retries=0 ms=\d+$/m` |
| E29 | fts5 › Cached ranking statistics follow external commits | state | L1 | automated | kb.test.ts | store A (long-lived) searched term `zeta` once; second connection B inserts 5 chunks containing `zeta` and commits | A searches `zeta` without writing | A's result count includes B's chunks and A's df for `zeta` equals the new count |
| E30 | mkb › Condensed json status line | equivalence | L1 | automated | kb-search-tool.test.ts | no `dbPath`, live foreign marker | `kb_search` `format:"json"` | output is exactly 2 lines: building line, `[]` |
| E31 | ext › Pull tool backs off | decision table | L1 | automated | kb-search-tool.test.ts | no `dbPath`, live foreign marker | `kb_search` / `kb_get` / `kb_neighbors` (condensed) | each returns the building line only; no throw; no file at `dbPath`; walk spy 0 |
| E32 | ext › Git-scope calls skip the docs reindex | regression | L1 | automated | git-scope-tool.test.ts | no `dbPath`, live foreign marker | `kb_search` `scope:"git"` | git-scope result as today; no building line |
| E33 | ext › marker only when `dbPath` absent | decision table | L1 | automated | kb-search-tool.test.ts | populated `dbPath` + a live foreign tmp marker (holder case) | `kb_search` | normal results; no building line |
| E34 | ext › Dead build marker does not block | EP | L1 | automated | reindex.test.ts | no `dbPath`; tmp with dead PID | `kb_get` | cold-start populate runs through the first-index path; result served |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | pipeline › Forced pass equals a first index (cost, K1) | timed ratio | L1 | automated | generated fixture: 600 md files × 8 headings, 1 source | median forced-pass wall time ≤ 1.5 × median first-index wall time | 3 runs each, same process |
| P2 | pipeline › Index-addressed per-file row replacement | structural (spy) | L1 | automated | 600-file fixture, populated | re-chunk every file; count prepared `DELETE FROM chunks WHERE root=? AND path=?` statements | 0 such statements issued |
| M1 | proposal goal: forced pass ≈ first index (full repo) | measurement | — | manual-only | repo's own docs (`.pi`, `docs`, `openspec`, `packages`) | before/after: forced pass and first index wall time; target forced ≤ 1.3 × first index | once, same machine, recorded in PR description |

### Frontend-quirk (async convergence)

| id | requirement | technique | level | disposition | exemplar | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------------------|
| F2 | plugin › Reindex job waits for a live first index (K2) | state-transition | L1 | automated | kb-routes.test.ts | no `dbPath`; live foreign tmp marker with fresh mtime | `POST /api/kb/reindex` → poll stats → builder installs (test writes the DB + removes tmp) | `202 {status:"running"}`; during wait `jobStatus:"running"`, `indexing:true`, no file created by the job; after install job walks; final `indexing:false`, `chunks>0`, `jobStatus:"idle"` |
| F3 | plugin › Awaited first index dies | state-transition | L1 | automated | kb-routes.test.ts | as F2; marker's PID killed / mtime aged past 120 s, no DB produced | wait loop observes non-live | job builds through the first-index path; `chunks>0`; no file at `dbPath` before its own install |
| F5 | ext › own first index joins in-flight | state | L1 | automated | reindex.test.ts | no `dbPath`, no marker | `kb_search` and `kb_get` concurrently in one process | exactly one first-index build (walk spy 1); neither returns the building line |
| F6 | pipeline › two simultaneous first indexes | state-convergence | L1 | automated | kb.test.ts (CLI spawn) | no `dbPath`; 300-file fixture | two `kb index` child processes started together | both exit 0; final DB file/chunk counts equal a single first index; one log line `install=link`, the other `install=backup` |

### Error-handling

| id | requirement | technique | level | disposition | exemplar | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|----------|-------|---------|---------------------|
| X1 | pipeline › Target created by another process during the build; mkb › Concurrent opener does not erase | fault-injection (concurrent opener) | L1 | automated | kb.test.ts (CLI spawn) | Holder creates `dbPath` 500 ms into `kb index` of a 300-file fixture, inserts 10 rows, stays open | CLI exits | exit 0; stderr `install=backup`; a fresh reader sees the CLI-reported file/chunk counts and `user_version 3`; Holder's next query sees them; still true after Holder exits |
| X2 | pipeline › Backup install retries while write-locked | fault-injection (delay) | L1 | automated | kb.test.ts (CLI spawn) | Holder holds `BEGIN IMMEDIATE` for 2 s spanning the install | CLI install | exit 0; log `install=backup retries=<≥1>`; counts as X1 |
| X3 | pipeline › bound elapses; mkb › exception; wt-init › Install-exception database counts as present | fault-injection (abort) | L1 | automated | kb.test.ts + worktree-init.test.ts | Holder holds a write txn for the whole run; retry bound injected as 1 s | CLI install | exit ≠ 0; log `install-failed=busy-timeout`; no `<dbPath>.tmp-*`; `dbPath` is the Holder's DB (its 10 rows); `evaluateGate` with `test ! -f <dbPath>` → `needsInit:false` |
| X4 | pipeline › Non-busy backup error is not retried | fault-injection (abort) | L1 | automated | kb.test.ts (CLI spawn) | Holder writes 4 KiB of garbage to `dbPath` mid-build and exits | CLI install | exit ≠ 0 at once (`retries=0`); log `install-failed=backup-error:26`; `dbPath` bytes unchanged; tmp removed |
| X5 | pipeline › single-step backup leaves destination consistent | fault-injection (kill) | L1 | automated | kb.test.ts (CLI spawn) | Holder-created populated `dbPath` (old contents, 50 files); CLI on 600-file fixture `SIGKILL`ed as it logs entering backup | reopen `dbPath` | `quick_check` ok; file count is exactly 50 or exactly 600 |
| X6 | pipeline › Session cold populate builds through the first-index path | fault-injection (kill) | L1 | automated | reindex.test.ts | child process runs kb-extension `ensurePopulated` on a 600-file fixture; `SIGKILL` after the first 100-file commit | inspect cwd; then run `kb index` | no `dbPath` after the kill; a `<dbPath>.tmp-<pid>` orphan exists; the next run sweeps it (dead PID) and installs |
| X7 | pipeline › CLI other commands during live build (K3) | fault-injection (concurrent build) | L1 | automated | kb.test.ts (CLI spawn) | `kb index` child building a 600-file fixture | `kb search foo` | stdout is the building line; exit 75; no file at `dbPath` created by `kb search` |
| X8 | mkb › Failed index leaves no artifact | regression | L1 | automated | index-atomicity.test.ts | all configured sources missing | `kb index` | exit ≠ 0; no file at `dbPath` (existing §1.1 test stays green) |
| X9 | pipeline › Forced pass failing part-way leaves no file without rows | fault-injection (abort) | L1 | automated | index-atomicity.test.ts | populated 300-file DB; `readFileSync` spy throws a non-ENOENT error at file 250 under `--force` | pass | rejects; every file has ≥ 1 chunk; files 1–200 (committed batches) re-chunked, 201–300 prior |
| X10 | ext › One failing source does not stop the others | fault-injection (abort) | L1 | automated | reindex.test.ts | 2 filesystem sources, records absent; source A's walk throws | `reindexNow` | source B indexed and `gate:B` written; `gate:A` absent; next pass forces A |
| X12 | pipeline › Concurrent writer during the record rebuild | fault-injection (concurrent writer) | L1 | automated | index-atomicity.test.ts | second connection inserts mapped chunks in a tight loop | new connection's first pass (rebuild) | pass completes or aborts before any per-file delete; afterwards no path has duplicate chunks |
| X13 | plugin › Errored or untrusted source stays due / keeps chunks | fault-injection (abort) | L1 | automated | kb-routes.test.ts | 2 sources, records absent, one untrusted | reindex job settles | untrusted source's chunks unchanged and `gate:<it>` absent; trusted source re-chunked and recorded |
| X14 | mkb › rollback compatibility | equivalence | L1 | automated | frontmatter-indexing.test.ts | DB after new-code passes | evaluate the pre-change gate predicate (`user_version < 3 \|\| facetConfigHash ≠ frontmatterConfigHash`) | false (old code would not force) |
| X15 | pipeline › rollback then re-upgrade | state | L1 | automated | index-atomicity.test.ts | new-code DB; raw SQL emulating old code: scan-delete + reinsert one file's chunks without map rows, bare heading names | new-code pass | no duplicate chunks; that file re-chunked with qualified heading names |

---

## Coverage summary

- Requirements covered: 16/16 modified/added requirements (pipeline 5, mkb 4, fts5 3 incl. the added cache requirement, ext 2, plugin 1, wt-init 1); every added/modified scenario maps to ≥ 1 row. Re-baselined on the archived `bound-kb-search-freshness`: F1, F4, X11 dropped (their behaviour is the existing freshness budget / in-flight join / late-rejection handling, already covered by its tests); E30 asserts the existing `BUILDING_LINE` + `[]` json shape under a live-marker trigger.
- Scenarios by class: edge 34 · perf 3 · frontend 4 · error 14
- Scenarios by level: L1 55 · L2 0 · L3 0 · manual 1
- Scenarios by disposition: automated 55 · manual-only 1

## New infra needed

- A small reusable "Holder" child-process script for kb tests (`packages/kb/src/__tests__/helpers/`), spawned with `node`; the CLI spawn pattern already exists in `kb.test.ts:938`.
