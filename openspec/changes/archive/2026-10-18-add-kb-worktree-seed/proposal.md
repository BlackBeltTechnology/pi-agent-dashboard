## Why

A new git worktree's kb docs index is built from scratch: ~86–104 s for this repository (3 038 files / 40 k chunks), either inside the worktree-init hook's `kb index` or inside the first pi session's cold-start populate. Yet the main checkout already holds an index of nearly the same tree, and the index is location-independent — rows are keyed by source id plus a path relative to it. Measured on a real `git worktree add` with changed, added and deleted files: seeding from the main checkout's index and running the normal incremental walk took **4.0 s vs 104 s**, and the result was row-for-row identical to a first index (files, chunks, properties; the graph too, once `fix-kb-index-integrity` stops edge erosion).

Now, because `fix-kb-index-integrity` routes every creation of a docs database through one atomic first-index path — the single place a seed can be applied correctly, whichever writer (session, CLI, worktree-init, dashboard) builds first.

## What Changes

- **Seeded first index in linked worktrees.** When the atomic first-index path builds a docs database in a linked git worktree, it starts the temp build from a consistent snapshot of the main checkout's docs database (`VACUUM INTO` the build's `<dbPath>.tmp-<pid>`) instead of an empty database, then runs the normal walk and install. The walk re-chunks only files whose content differs, prunes files the worktree does not have, and adds new ones.
- **Per-source acceptance.** A seeded source's rows are kept only when the main checkout recorded the current schema version, index-options hash and kb engine fingerprint for that source; rows of mismatched sources and of sources the worktree does not configure are dropped before the walk, and rows of sources the worktree does not walk to completion (not passed, missing, untrusted, failing) are dropped after it, so the result equals an unseeded first index. Seeded files are compared by content, never by the main checkout's mtimes.
- **DOX acknowledgements travel along.** The main checkout's `dox-staleness.json` is copied when the worktree has none and its version is supported, so pending stale-row nudges are not silently lost.
- **Main checkout per `git-checkout-root-resolution`** (repo-local `core.worktree`, bare-repository check), implemented locally because kb has no dependencies.
- **Engine record in the gate.** Each source records the kb engine fingerprint (`engine-fingerprint.json` `srcHash`) that produced all of its rows; a missing or different fingerprint forces the source, like a schema bump, so the main checkout becomes seedable on its first pass after upgrade.
- **Opt-out and visibility.** Config key `seedFromMainWorktree` (default `true`) and `kb index --no-seed`. One stderr line per first index: `[kb] seed=<main checkout> sources=<kept>/<configured>` or `[kb] seed-skipped=<reason>`. A seed problem never fails the run: it reruns the first index once without a seed.
- No change to the worktree-init hook: its `kb index` either seeds or finds the database a session already seeded.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `kb-indexing-pipeline`: the atomic first index gains seeding from the main worktree's index, and every pass maintains a per-source engine record (added requirement).

Depends on `fix-kb-index-integrity` (its `reconcileChunkMap`, per-source `stampSource`, single creation path and install).
- `kb-config-and-init`: configuration validation accepts the boolean `seedFromMainWorktree`.

## Discipline Skills

- `performance-optimization` — the change exists for a measured speed-up; seeded vs first-index time is measured before/after.
- `observability-instrumentation` — the seed outcome (kept sources or skip reason) is logged per first index.
- `doubt-driven-review` — copies another checkout's derived data into a new database; correctness rests on the per-source acceptance rule.
- `review-code` — before commit.

## Impact

- **Code**: `packages/kb/src/index-run.ts` (seed step inside the first-index path from `fix-kb-index-integrity`), a new `packages/kb/src/seed.ts` (main-checkout discovery, snapshot, per-source acceptance, staleness copy), `sqlite-store.ts` (engine record), `config.ts` (key + validation), `cli.ts` (`--no-seed`).
- **Depends on**: `fix-kb-index-integrity` (single creation path, no-clobber install, per-source gate records, exact incremental graph). Without it a seed inherits an eroded graph and the install race.
- **Data**: no schema change. The main checkout's database is only read.
- **Compatibility**: a worktree whose main checkout has no index builds exactly as today; one whose main checkout runs older kb (no per-source or engine records) keeps no seeded source and pays the snapshot on top of a cold build until the main checkout runs the new kb once.
- **Rollback**: set `seedFromMainWorktree: false` or revert; behaviour returns to a cold first index.
