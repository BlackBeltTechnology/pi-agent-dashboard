# DOX — packages/kb/src/git-scope

Files in this directory. One row per source file. The `git` scope: commits, PRs and issues of the session repository, searchable via `kb_search`/`kb_get` with `scope: "git"`. See change: add-kb-git-forge-scope.

| File | Purpose |
|------|---------|
| `commits.ts` | Local commit ingest. `fingerprint` (for-each-ref + worktree HEADs), streamed `git log --stdin` (tips positive, recorded tips `^sha`), NUL-record `CommitStreamParser`, pages ≤500 commits or ≤1 s per fenced tx, missing-object reset, `commitChunk`. |
| `deps.ts` | `GitScopeDeps` seams (git, spawnGit, resolveBin, runCli, fetch, now, env, baseDir, owner, log) + `defaultDeps`. `resolveBinOnPath` caches an absolute `gh`/`glab` path once per process. |
| `forge/cli.ts` | Shared `gh api -i` / `glab api -i` transport. `parseHttpHead`, `cliRequest` classifies 200/304/rate-limit/auth/404; a 304 exits non-zero but its head is on stdout (spike 1.1). |
| `forge/gitea.ts` | Gitea/Forgejo/Codeberg adapter over `fetch`. Always `https://<host>`; token only when host is global-allowlisted as gitea; `sort=leastupdate`; UTC-normalised timestamps; `RateLimit` header parsing. |
| `forge/github.ts` | GitHub adapter (`gh api -i --hostname`). One `issues` endpoint serves PRs + issues; `x-ratelimit-*`; no `rate_limit` preflight. |
| `forge/gitlab.ts` | GitLab adapter (`glab api -i`). `issues` + `merge_requests`; `updated_after`; rate floor only when both `RateLimit-*` headers exist. |
| `forge/index.ts` | `createAdapter(deps, forge, cfg)` factory. |
| `forge/types.ts` | `ForgeAdapter` (endpoint-oriented), `ForgeItem`, `ForgePage`, `RateInfo`, `ForgeUnavailable`, `ForgeRateLimited`, `PAGE_SIZE`. |
| `index.ts` | Public surface: `createGitScope`, `GitScope`, option/result types. |
| `lease.ts` | `GitLease`: single-row SQLite lease. Fenced acquire/extend/release, `fenced(fn)` re-checks the nonce in-transaction; `LeaseLostError`. |
| `links.ts` | `extractRefs` (`#N`, `!N` GitLab, same-repo URLs, `See change:`), `buildEdges`, `repointIssuePlaceholder` (GitHub/Gitea shared number space), `linkedItems`. |
| `repo.ts` | `resolveRepo`: `git.enabled` first, removed-cwd vs missing-git, common dir → `repoKey`, remote → forge identity (4-entry public host table + global `hosts`), segment validation, `ensureRepoDir` (0700/0600). |
| `scope.ts` | `GitScope` facade: `search`, `get`, `hint`, `shutdown`, `idle`. Try-lease → background work → time-boxed await (`searchWaitMs`); status footers; cached rate-aware comments; `Linked:` line. |
| `store.ts` | Per-repo db (`index.db`): kb schema + `git_meta`, `git_lease`, `git_comments`; `hasGitSupport`; meta helpers. |
| `sync.ts` | Forge sync: keyset cursor per endpoint + cohort paging, `pagesPerSync`, rate floor with expiry, back-off, `reconcileForgeIdentity`, `forgeSyncDue`, one log line per sync. |
