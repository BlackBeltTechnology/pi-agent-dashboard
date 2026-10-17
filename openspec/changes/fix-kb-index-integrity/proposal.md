## Why

The kb docs index can be silently emptied or degraded today, with every health signal green. Reproduced on develop with production code:

- **A finished index is silently replaced.** `kb index` builds a first index into `<dbPath>.tmp-<pid>` and `renameSync`s it onto `dbPath`. If another process opened `dbPath` meanwhile — a pi session's `kb_search`/`kb_get`/`kb_neighbors` call `getKb` → `ensurePopulated`, which *creates* the DB — that process's path-keyed `-wal`/`-shm` are replayed onto the renamed file. Repro: init log `indexed 3031 files … 40192 chunks`, gate satisfied, yet the DB reads **0 files / 0 chunks / `user_version 0`**, `quick_check` ok. With worktree auto-init-on-spawn the race window is the whole init run. The archived `harden-kb-index-failure-atomicity` design deemed concurrent indexers "benign; last successful `rename` wins" (Out of scope) — false for WAL databases.
- **The graph erodes and conflates.** `deleteByPath` deletes `edges WHERE src=? OR dst=?` for the re-chunked file's nodes, so edges owned by *unchanged* files are lost; the main checkout kept 80 of 175 `references` edges (46%) ~40 min after a full rebuild. Heading nodes are keyed by the bare heading path, so one `Why` node is shared by 83 files and `Purpose` by 99 — re-chunking one file rewrites other files' heading graph.
- **Writers disagree.** Only `runIndexAtomic` and the CLI's `runIndex` apply the schema-version / facet-hash gate and stamp it; the kb-extension reindex and the kb-plugin reindex route call `indexSource` directly, and also omit `frontmatter` options (custom facet keys dropped). The main checkout sat on schema v2 under a v3 build for ~6 weeks.
- **Per-file deletes are table scans.** `chunks` is FTS5 with `UNINDEXED` path, so every per-file delete scans the table: forced passes took 145–168 s vs 86 s for a first index of the same tree.

Now, because the follow-up `add-kb-worktree-seed` (copy the main checkout's index into a new worktree) is only correct on top of a no-clobber install, an exact incremental graph and converged writers.

## What Changes

- **No-clobber index install.** A built temp DB is installed with an atomic no-clobber hard link onto `dbPath`; if `dbPath` already exists the temp DB's contents are copied into it through SQLite's online backup API (`node:sqlite` `backup()`), with a bounded busy-retry. Handles other processes hold on `dbPath` see the new contents on their next read. One stated exception: if a pre-upgrade kb writer holds a write lock on a `dbPath` it created for longer than the 30 s bound, the run fails and that writer's database stays.
- **One creation path.** Every writer that finds the docs database absent (session cold-start populate, debounced reindex, CLI commands, dashboard reindex) builds it through the atomic first-index path instead of opening `dbPath` in place, so a file at `dbPath` always means a first index completed.
- **Creating openers back off during a live first index.** While `dbPath` is absent and a fresh `<dbPath>.tmp-<pid>` owned by a live process exists, the kb-extension (pull tools, debounced reindex) and the CLI's non-index commands do not create or populate `dbPath` (pull tools answer "index is still being built"), and a dashboard reindex job waits for the first index to finish before walking.
- **File-qualified heading nodes.** Heading node identity becomes `<file>#<heading path>`; neighbor/backlink lookup by a bare heading path keeps returning the union over files.
- **Exact incremental graph.** Re-chunking a file replaces only its own chunks, heading nodes and outbound edges; its file node persists, so inbound edges from other files survive. A deleted file's node becomes a placeholder; unreferenced placeholders are swept. After any sequence of incremental passes the graph equals a first index of the same tree.
- **Index-addressed per-file deletes.** Docs chunks record their row ids per file (the `item_rows` map git-scope already uses), so per-file replacement is a keyed delete instead of a table scan. A forced pass stays per-file and in place (measured: all 3063 files' chunks deleted in 0.44 s vs 17.3 s); existing DBs backfill the map on open (25 ms).
- **One option derivation, per-source gate.** A shared kb helper derives index options from resolved config; the gate hash covers the frontmatter facet config **and** `includeSourceMarkdown`. Every docs writer applies the gate per source and stamps a source only after walking it successfully, so skipped, untrusted or failed sources stay due for a forced pass. Pull tools do not wait for a gate-forced pass over an already-populated index: it runs in the background and they answer from the existing index, so upgrading does not stall `kb_search`.
- **Cached ranking statistics follow external commits** (`PRAGMA data_version`).
- **Vanished files.** A file that disappears between the walk and its read is treated as deleted, not as a pass-aborting error.
- **Node floor.** `@blackbelt-technology/pi-dashboard-kb` `engines.node` → `>=22.19.0` (`backup()` availability; matches the repo root floor). **BREAKING** for standalone consumers on Node 22.13–22.18; the version bump itself happens at release.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `kb-indexing-pipeline`: layered change detection replaces owned rows only; graph extraction with file-qualified headings and owned-row replacement; orphan removal demotes to placeholders and sweeps them; atomic first index installs no-clobber with a live-build marker; index-addressed per-file replacement.
- `markdown-knowledge-base`: Tier-1 graph (exact incremental graph, heading identity), "kb index is atomic on failure" (install rule + stated exception), "LLM-facing pull retrieval" (back-off during another process's first index), and "Condensed default `kb_search` output with opt-in JSON" (single status line before the hits; json array stays the final line).
- `kb-fts5-search-store`: schema version gate is per source, applies to every docs writer, hash covers `includeSourceMarkdown`; neighbors/backlinks addressing by qualified or bare heading path; cached statistics follow external commits.
- `kb-extension-auto-reindex`: reindex uses the shared options + gate with per-source isolation; pull tools and debounced reindex back off during a live first index; pull tools do not await a gate-forced pass.
- `kb-plugin-index-jobs`: dashboard reindex uses the shared options + gate and waits for a live first index before walking.
- `worktree-init-hook`: the kb index sentinel states the install exception (a failed run may leave another kb writer's database at `dbPath`; the failed run is still reported failed).

## Discipline Skills

- `systematic-debugging` — repro-first: the install race and graph erosion regressions are written failing before the fix.
- `doubt-driven-review` — irreversible on users' DBs: install path, heading identity and gate stamps change how existing indexes are rewritten.
- `performance-optimization` — forced pass and per-file deletes measured before/after.
- `observability-instrumentation` — install path taken (link / backup / retries), back-off and deferral are logged.
- `review-code` — non-trivial multi-package change before commit.

## Impact

- **Code**: `packages/kb/src/index-run.ts`, `sqlite-store.ts` (install helper, `deleteByPath`, `item_rows` use, `neighbors`/`backlinks`, `dfCache`), `indexer.ts`, `config.ts`, `cli.ts`, `node-sqlite.d.ts`, `index.ts`; `packages/kb-extension/src/reindex.ts`, `extension.ts`; `packages/kb-plugin/src/server/kb-routes.ts`; `packages/kb/package.json` (`engines`), `packages/kb/engine-fingerprint.json` (dist freshness gate).
- **Data/migration**: no `SCHEMA_VERSION` bump. Per-source gate keys are new → each source is force-rebuilt once by the first upgraded writer that walks it; that rebuild rewrites heading nodes to qualified names and removes erosion.
- **Compatibility**: bare heading-path addressing in `kb neighbors`/`kb_neighbors`/backlinks keeps working (union); heading node names in their output become `file#heading`. Writers ≤0.9.0 (e.g. a stale npm-installed kb-extension) do not honour the marker or the per-source gate; they can still erode a DB until the next forced pass.
- **Rollback**: revert restores rename-install and scan deletes. Old code reads the same schema; it ignores per-source keys and `item_rows` rows, sees a matching `facetConfigHash`, and does not force — qualified heading names stay until its next re-chunk of each file.
- **Sequencing**: lands before `bound-kb-search-freshness` (0/87 tasks; same requirement "Cold-start populate and freshness reindex on pull tools" — its delta is rebased onto this one) and before `add-kb-semantic-annotation-plane` adds typed edges. `add-kb-worktree-seed` depends on this change.
