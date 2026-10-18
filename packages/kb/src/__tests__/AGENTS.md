# DOX — packages/kb/src/__tests__

Files added by change add-kb-git-forge-scope. One row per file. (Older test rows live in `../AGENTS.md`.)

| File | Purpose |
|------|---------|
| `git-scope-commits.test.ts` | Vitest for commit ingest: path search, no-op on unchanged refs, incremental walk, no e-mail, detached HEAD, `maxInitial`, path cap, non-UTF-8, gc'd-tip recovery, 5 000-commit latency + tx bound (E12–E19, X12, P2, P3). |
| `git-scope-config.test.ts` | Vitest for the `git` config group: defaults, global-only `hosts`/`tokenEnv`, recursive merge, validation table (E22, E40, E41). |
| `git-scope-forge.test.ts` | Vitest for adapters through `runCli`/`fetch` seams: GitHub, GitLab, Gitea; token routing, https only, credentials never persisted (E20, E23, E24, E26, E27, X1, X4, X14, P5). |
| `git-scope-lease.test.ts` | Vitest for the single sync owner: two forked processes, SIGKILLed owner takeover, deposed owner fenced, hint → one extra round (X8–X11). |
| `git-scope-links.test.ts` | Vitest for cross-links: squash `(#N)` → later PR, re-sync keeps links, GitLab `#N`/`!N`, parser table, `See change:` per checkout (E32–E36). |
| `git-scope-repo.test.ts` | Vitest for repo resolution, shared index, privacy, unsupported forge, segment validation, identity purge (E6–E11, E21, E25, E43). |
| `git-scope-store.test.ts` | Vitest for store additions: `replaceItem`, `ensureNode`, `pathPrefix`, `dedup:false`, `findPathsByPrefix`, `immediate` rollback. |
| `git-scope-sync.test.ts` | Vitest for sync coordination (fake adapter + clock): budget, page cap, rate floor, back-off, interrupted page, cohorts, comments, log line (P1, P4, P6, X2, X3, X5–X7, X13, 6.1). |
| `helpers/git-fixture.ts` | Fixtures: temp git repos, isolated HOME + index dir, `FakeForge`, `fakeClock`, `cliHttp`, `instrumentedStore`, `fastImport`. |
| `helpers/event-loop-lag.ts` | `withEventLoopLag(fn)` → `{result,maxDelayMs,elapsedMs}` via `monitorEventLoopDelay` (K1 probe). See change: bound-kb-search-freshness. |
| `helpers/synthetic-tree.ts` | Scaled synthetic trees: `makeDeepTree`, `makeWideDir`, `makeFlatFiles`, `makeFlatDirs`. See change: bound-kb-search-freshness. |
| `helpers/lease-worker.mts` | Child process for the multi-process lease tests (`node --import tsx`); roles `sync` / `hang`. |
| `walk-yield.test.ts` | Vitest: walk + gitignore pre-scan yield (timer fires, lag ≤250 ms), wide-dir R10 residual (P3, P4). See change: bound-kb-search-freshness. |

Files added by change fix-kb-index-integrity.

| File | Purpose |
|------|---------|
| `index-integrity-gate.test.ts` | Vitest for `indexOptionsHash` coverage, per-source gate records, back-compat stamps (E1–E5, X14). |
| `index-integrity-graph.test.ts` | Vitest for qualified heading nodes, owned-row replacement, incremental==first-index graph, neighbors resolution, rowid-addressed deletes, record rebuild, vanished files, `data_version` df cache, perf ratio (E7–E21, E29, X9, X12, X15, P1, P2). |
| `index-integrity-install.test.ts` | Vitest for the live-build marker, heartbeat, orphan sweep, `installIndex` branches/retries and `kb index` CLI concurrency with a holder connection (E22–E28, F6, X1–X5, X7). |
