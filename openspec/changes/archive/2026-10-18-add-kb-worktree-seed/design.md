# Design — add-kb-worktree-seed

## Context

- **Location independence.** Docs rows are keyed `(root, path)` with `root` = source id and
  `path` relative to the source dir (`packages/kb/src/sqlite-store.ts:25-28`; `indexer.ts:154`
  `relative(src.dir, abs)`). Filesystem source ids are the configured `ref` (`config.ts:376-381`),
  identical in a worktree and its main checkout (same committed config). Remote sources resolve
  into the shared `sourceCacheDir` (`~/.pi/dashboard/kb/sources`, `config.ts:159`, `:384`).
- **Incremental walk reuses rows by content.** When a file's stored mtime differs, the indexer
  hashes it and keeps its rows on a sha256 match (`indexer.ts:157-164`). Spike (`git worktree add`,
  5 edited/added + 2 deleted files, all mtimes reset): snapshot 326 ms + walk 3 687 ms = **4.0 s** vs
  cold **104 s**; `changed 5`, `deleted 14`. Files, chunks, properties set-equal to a cold build; the
  graph differed by 762 edges — main's erosion, fixed by `fix-kb-index-integrity` D4.
- **Consistent snapshot.** `VACUUM INTO` from a `readOnly` connection is a read transaction that
  includes WAL-only commits and excludes open transactions (spike). It refuses an existing non-empty
  target (`output file already exists`), and `SqliteFtsStore`'s constructor already opens the target
  and sets WAL (`sqlite-store.ts:117-119`, `index-run.ts:96-97`) — so the snapshot must run before
  the store is constructed.
- **Where to hook.** `fix-kb-index-integrity` makes the atomic first-index path the only creator of a
  docs database (its D2), records `gate:<root>` per source (its D6), rebuilds `item_rows` on a
  connection's first pass (its D5) and defines file-owned graph rows (its D4). Every first index —
  worktree-init `kb index`, a session's cold populate, CLI commands, the dashboard job — passes
  through that path; with auto-init-on-spawn the session usually builds first.
- **Engine identity.** Rows depend on kb's extraction code, which can change without a
  `SCHEMA_VERSION` bump. `packages/kb/engine-fingerprint.json` (`srcHash` over kb's sources) ships in
  the package (`packages/kb/package.json` `files`) and is kept fresh by
  `scripts/check-kb-dist-fresh.mjs` in CI.
- **Checkout resolution.** `git-checkout-root-resolution` defines linked-worktree detection
  (git-dir ≠ common-dir; never "common dir named `.git`") and main-checkout resolution (repo-local
  `core.worktree`; else the common dir's parent when it is named `.git` and repo-local `core.bare`
  read `--type=bool` answers not-bare; else none), leaving plausibility checks to each consumer.
  `packages/shared/src/platform/git.ts:602` implements it, but kb is dependency-free by convention
  (`index-run.ts:35-39`).

## Goals / Non-Goals

**Goals:** a linked worktree's first index costs about an incremental pass; its result equals an
unseeded first index (for trees in which no two sources contain the same relative path, as in
`fix-kb-index-integrity`); the main checkout's database contents are never modified; a seed problem
never fails the run.

**Non-Goals:** seeding from a sibling worktree or the spawning cwd (decided: main checkout only);
seeding the git-scope database (already shared per repository, `git-scope/repo.ts:107`); copying
`node_modules` or other init assets; changing the worktree-init hook.

## Decisions

### D1 — Main checkout discovery (conforming local copy)

`packages/kb/src/seed.ts` `findMainCheckout(cwd)` implements `git-checkout-root-resolution` with
argv-form `execFileSync` calls, 2 s timeout each; git < 2.31 (no `--path-format`) ⇒ no result.

- Probes run separately: `rev-parse --path-format=absolute --git-dir`, `… --git-common-dir`
  (required), `… --show-toplevel` (optional; its failure means `thisCheckout = null` ⇒ no seed).
- Linked ⇔ git-dir ≠ common-dir, compared after `realpath`, trailing-separator removal and the
  platform case fold on macOS/Windows.
- Main checkout, in order, with `git config --file <common>/config --get …` (repo-local only):
  1. `core.worktree` → resolved against the common dir. Exit 1 = unset; any other failure =
     unanswerable ⇒ **no main checkout** (no fall-through, per the spec's failed-probe rule);
  2. else, when the common dir is named `.git`: `--type=bool --get core.bare` answering `false` or
     unset (exit 1) ⇒ the common dir's parent; answering `true` or unanswerable ⇒ none;
  3. else none.
- A worktree of a submodule resolves through rule 1 to the submodule checkout and seeds normally; a
  submodule checkout itself is not linked; a worktree of a bare repository has no main checkout.
- Consumer checks (this consumer's obligation): the main path exists, is a directory, differs from
  the worktree's toplevel, and running `rev-parse --git-common-dir` in it yields the same common dir.
  Failure ⇒ `no-main-checkout`. The spec's other repository-binding rules are not applied: a wrong
  main checkout can only cost speed, because acceptance requires matching records and the walk
  re-hashes every kept file.
- Duplication with `packages/shared/src/platform/git.ts:602` is deliberate (kb has no dependencies,
  `index-run.ts:35-39`); kb's tests mirror the shared resolver's scenarios.

### D2 — Inputs, seed path and snapshot

- The first-index path receives the resolved config (`cfg`) from every caller — `cli.ts` `kb index`
  and auto-index, kb-extension cold populate/reindex (`reindex.ts`), dashboard job (`kb-routes.ts`) —
  via a `seed` field on `RunIndexAtomicOpts` built by one helper
  `seedOptionsFromConfig(cfg, { noSeed, explicitSources, customDb })` →
  `{ enabled, cwd, dbAbsPath, configuredRoots }`.
- Disabled when `cfg.seedFromMainWorktree === false`, `--no-seed`, or an explicit `--source` run
  (`disabled`); `--db` or a `dbPath` outside the toplevel ⇒ `custom-dbpath`.
- Seed DB = `<main>/<relative(toplevel, dbAbsPath)>`. Absent or 0 bytes ⇒ `main-building` if
  `isFirstIndexLive(seedDb)`, else `no-main-index`.
- Order inside the first-index path, before the store is constructed: unlink a leftover
  `<dbPath>.tmp-<pid>` and its `-wal`/`-shm` → open the seed DB **read-write without changing its journal mode**, issuing
  reads only (a `readOnly` handle cannot create `-shm` after a checkpoint removed it,
  `sqlite-store.ts:124-133`), `busy_timeout 2000` → `VACUUM INTO '<tmp>'` → close → construct the
  store on `<tmp>`. No row of the main database is written; its `-wal`/`-shm` may be created.

### D3 — Acceptance, walk, post-walk drop

1. `reconcileChunkMap(store)` (exported by `fix-kb-index-integrity` D5) — so drops use a complete map.
2. Accept a root iff it is in `configuredRoots`, its snapshot `gate:<root>` equals the current
   `<SCHEMA_VERSION>:<indexOptionsHash>`, and its snapshot `engine:<root>` equals the running engine
   (D6). Absent records ⇒ not accepted.
3. Drop every other root: chunks via `item_rows`, properties, file state, `gate:<root>`,
   `engine:<root>`; graph rows owned by its paths (heading nodes and their edges, outbound edges of its
   file nodes), file nodes demoted to placeholders (`fix-kb-index-integrity` D4).
4. `UPDATE files SET mtime_ms = -1` for kept roots — seeded rows carry the main checkout's mtimes; an
   equal mtime with different content would otherwise skip the file.
5. The normal walk over the sources the caller passed. Callers pass only resolved, trusted sources
   (untrusted remotes are never passed).
6. After the walk: every seeded root the caller did not pass, or whose walk reported `missing`, is
   dropped as in step 3. A source whose walk throws aborts the walk and takes the D4 path.
7. Sweep unreferenced path-less nodes again (step 6's demotions happen after the walk's own sweep).
8. Install (`fix-kb-index-integrity` D1).

### D4 — Containment

- Any throw in D2 or D3.1–D3.4 ⇒ close, unlink the tmp and sidecars, reason `snapshot-error`, continue
  as an unseeded first index.
- Any throw in D3.5–D3.7 of a **seeded** run ⇒ discard the tmp and rerun once as an unseeded first
  index in the same run (reason `snapshot-error`). A failure of that rerun fails the run as today —
  it is no longer a seed failure.

### D5 — DOX staleness copy

- Only when a snapshot was installed (seed used): copy `<main>/.pi/dashboard/kb/dox-staleness.json`
  to `<cwd>/.pi/dashboard/kb/dox-staleness.json` iff the source exists, the target does not, and the
  source is readable by `readStaleness` without loss: JSON parses and its `version` is absent (legacy
  v1 map) or exactly `STALENESS_VERSION` (`staleness.ts:20`, `:31`, `:48` — any other version reads
  as empty).
- `mkdirSync(dirname(target), { recursive: true })`, copy to `<target>.tmp-<pid>`, `renameSync`; any
  error logged once as `[kb] seed-staleness-skipped=<code>`, never thrown.

### D6 — Engine record in the gate, config, logging

- Running engine = `srcHash` of the package's `engine-fingerprint.json`, read once per process from the
  kb package root (resolved relative to the loaded module).
- Per-source record `kb_meta` `engine:<root>` = the engine that produced **all** of that root's rows:
  - the gate (`fix-kb-index-integrity` D6) additionally forces a source whose `engine:<root>` is absent
    or differs from the running engine — so an unforced pass only ever runs with the recorded engine
    and cannot mix engines;
  - a forced pass clears `engine:<root>` in the transaction of its first batch
    (`beginForcedSource(store, root)`) and writes the running engine when the source's walk completes
    (`stampSource(store, cfg, root, { engine })`); an interrupted forced pass therefore leaves no
    record, and its partly rebuilt rows are never accepted as a seed and are forced again.
  - The four writers (`runIndexAtomic`, `cli.ts runIndex`, `reindexNow`, `reindexAll`) call both.
- Upgrade: every source lacks `engine:<root>` once, so each writer's first pass forces it (background
  for `kb_search`, per `fix-kb-index-integrity`) and main becomes seedable without manual steps. A kb
  source change forces each source once, like a schema bump.
- `seedFromMainWorktree?: boolean` (default `true`), validated as a boolean.
- One stderr line per first index, written after D3.7: `[kb] seed=<main path> sources=<kept>/<passed>`
  (passed = roots the caller passed; kept = those whose seeded rows are installed) or
  `[kb] seed-skipped=<reason>`. Precedence: `disabled` › `not-a-worktree` (main checkout, no git) ›
  `no-main-checkout` (incl. git < 2.31) › `custom-dbpath` › `main-building` › `no-main-index` ›
  `snapshot-error`.

## Risks / Trade-offs

- **Snapshot size**: a full copy of main's DB (107 MB here) before pruning; same order as a cold build.
- **Main on older kb** (no `engine:*` / `gate:*` records) ⇒ `sources=0/<n>`; cost ≈ cold + snapshot until
  main's first pass with the new kb (forced by the absent records) completes.
- **A seeded run whose walk fails** reruns unseeded once, doubling the cost of a genuine failure.
- **Engine skew** (the worktree's kb sources differ from main's) ⇒ no source kept; correct, no
  speed-up. Engine identity is the committed `engine-fingerprint.json`; uncommitted kb source edits
  are not reflected (CI's `check-kb-dist-fresh` keeps the committed file current).
- **Every kb source change forces each source once** in every index (background for `kb_search`).
- **Shared relative paths across sources**: dropping one source can remove graph rows another source
  shares (nodes are not root-scoped); equality is stated for trees without shared relative paths.
- **Merge order**: lands after `fix-kb-index-integrity`; both touch `packages/kb/engine-fingerprint.json`
  and `packages/kb/src/AGENTS.md`.

## Migration Plan

Ships enabled. No data migration. Rollback: `seedFromMainWorktree: false` or revert.

## Open Questions

None.
