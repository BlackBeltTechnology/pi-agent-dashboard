## Why

Agents can search the repo's markdown (`kb_search`) but not its history. Questions
like "why does this exist?", "which PR changed X?" or "is there an issue about Y?"
end in ad-hoc `git log --grep` / `gh` calls that are unranked, unlinked and, for
PRs and issues, spend the forge's rate limit on every attempt. Many pi sessions and
worktrees run against the same repo, so any naive per-session polling multiplies
the request count.

This change adds a searchable `git` scope to today's kb. It ships before the
`unify-context-manager` cutover, and that umbrella absorbs it as a provider-backed
scope.

## What Changes

- **New `git` scope in the kb.** It holds three item kinds: commits, pull/merge
  requests and issues. They are stored in a separate kb database per repository,
  keyed by git common dir, so worktrees share one index. It reuses the
  `packages/kb` engine (FTS5 BM25 + trigram, graph edges).
- **`kb_search` gains an optional `scope` parameter**: `"docs"` (default,
  unchanged behaviour) or `"git"`. It also gains an optional `kind` filter
  (`commit` | `pr` | `issue`) that only applies to the `git` scope.
- **`kb_get` gains an optional `scope` parameter.** With `scope: "git"`, `path`
  is `commit/<sha prefix>`, `pr/<n>` or `issue/<n>`. A PR or issue fetch loads its
  comments on demand and caches them. There is no `git:` ref prefix, which would
  collide with kb's `git:` source refs.
- **Commits are indexed from local git only, with zero forge requests.** Freshness
  comes from a ref fingerprint, and indexing is incremental from the previously
  indexed tips. Indexed content: subject, body, author name, date and changed paths
  (capped). Author e-mail is not indexed.
- **PRs and issues are synced from the forge** through adapters for GitHub (`gh`
  CLI), GitLab (`glab` CLI) and Gitea/Forgejo/Codeberg (HTTPS REST). A Gitea token
  is read from an environment variable and sent only to hosts in a global-only
  allowlist. Self-hosted hosts need an explicit global host → forge mapping.
  Indexed content: title, body, labels, state, author and dates. Comments are
  fetched lazily.
- **Request-minimising sync policy:**
  - one sync owner per repo across all pi processes: a SQLite lease with fenced
    writes, where watermarks commit atomically with the items they cover;
  - lazy: a sync runs only when a `git`-scope search finds the data stale, never on
    a timer;
  - incremental: only items updated since the last watermark are fetched, in
    ascending update order, so an interrupted sync resumes safely;
  - conditional requests (`If-None-Match`) where the forge returns ETags;
  - a minimum sync interval, shortened (never bypassed) by event hints such as
    `gh pr create` or `git push`;
  - a rate-limit floor that pauses syncing and serves the cached index flagged as
    stale;
  - bounded first sync (time window plus item cap) and a page cap per sync.
- **Cross-links as graph edges:** `#N` / `!N`, `Fixes|Closes|Resolves #N`,
  same-repo PR/issue URLs and `See change: <id>` trailers link commits, PRs, issues
  and OpenSpec changes. `kb_get` lists them.
- **Untrusted content:** every `git`-scope result is marked
  `details.untrusted = true`. This includes commits, because squash merges embed
  contributor-written PR text. `untrusted-content-guard` spotlights them, and the
  output labels git hits and states they are data, even without the guard.
- **Configuration**: a new `git` group in `knowledge_base.json`, deep-merged
  across layers. Credential-routing keys (`git.forge.hosts`,
  `git.forge.gitea.tokenEnv`) are honoured only from the global layer, so a cloned
  repository cannot redirect credentials. Tokens are never written to config.

## Capabilities

### New Capabilities
- `kb-git-forge-scope`: the `git` scope. Covers commit indexing and freshness;
  forge PR/issue sync with its request budget, single-owner lock and staleness;
  cross-link edges; the `scope`/`kind` parameters on `kb_search` and git refs on
  `kb_get`; the `git` configuration group; untrusted-content marking.

### Modified Capabilities
- `kb-config-and-init`: deep merge covers the nested `git` group; validation adds
  the `git` constraints.
- `kb-extension-auto-reindex`: `git`-scope pull-tool calls skip the docs freshness
  reindex and cold-start populate.

## Impact

- **Code:**
  - `packages/kb/src/`: new `git-scope/` module (repo resolver, commit ingester,
    forge adapters, lease/sync coordinator, link parser).
  - `sqlite-store.ts` / `types.ts`: `SearchOpts.pathPrefix`, `findPathsByPrefix`,
    `replaceItem` (keeps inbound edges) and `ensureNode` (placeholder link
    targets).
  - `config.ts`: new `git` group, recursive merge, validation and global-only
    keys.
  - `types.ts`: no `DocType` widening; git items use `root: "git"` and virtual
    paths `commit/<sha>`, `pr/<n>`, `issue/<n>`.
  - `packages/kb-extension/src/extension.ts`: `scope`/`kind` on `kb_search`,
    `scope` on `kb_get`, and a `tool_result` hint matcher for forge/git commands.
- **Storage:** `~/.pi/dashboard/kb/git/<repoKey>/index.db` (`0700` directory,
  `0600` file) holds the items, sync state, lease and comment cache. It lives
  outside the repo, so nothing is committed or gitignored.
- **External calls:** `git` (local), `gh api` and `glab api` (absolute binary
  paths), and HTTPS to the repo's Gitea host. No new npm dependencies.
- **Compatibility:** additive. No `scope` → identical docs behaviour.
  `unify-context-manager` gains a `git` scope backed by this code (umbrella D13).
- **Rollback:** set `git.enabled: false`, or delete
  `~/.pi/dashboard/kb/git/`. The docs index is untouched.

## Discipline Skills

- `security-hardening`: forge PR/issue bodies and comments are attacker-writable
  text that reaches the model; the change uses CLI-held credentials and a token
  from an env var, and runs `gh`/`glab`/`git` subprocesses with remote-derived
  arguments.
- `performance-optimization`: the forge rate-limit budget, first-sync cost on large
  repos, and search latency while a sync runs.
- `observability-instrumentation`: sync outcomes, requests spent versus `304`s,
  remaining rate, and staleness surfaced in results.
- `doubt-driven-review`: the cross-process lease and fencing, and the credential
  routing (it ran in planning; re-run if either design changes).
- `review-code`: before commit.
