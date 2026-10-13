## Purpose

Make a repository's commits, pull/merge requests and issues searchable through the
kb tools as an opt-in `git` scope. Forge requests are kept to a bounded minimum
that is shared across every pi process working on the same repository.

## ADDED Requirements

### Requirement: Scope selection on kb_search

`kb_search` SHALL accept an optional `scope` parameter with values `"docs"` and
`"git"`, defaulting to `"docs"`. It SHALL also accept an optional `kind` parameter
with values `"commit"`, `"pr"` and `"issue"`, which applies only to the `git` scope.
A call without `scope`, or with `scope: "docs"`, SHALL behave exactly as before
this change.

#### Scenario: Default call is unchanged
- **WHEN** `kb_search` is called without `scope`
- **THEN** it searches the docs index with the same ranking, lanes and output as before
- **AND** no git command or forge request is executed

#### Scenario: Git scope returns history items
- **WHEN** `kb_search` is called with `scope: "git"` and a non-empty query
- **THEN** results are drawn only from commits, pull/merge requests and issues of the session's repository
- **AND** each hit identifies its kind, its identifier (short SHA or number), its date and its author

#### Scenario: Kind filter narrows git results
- **WHEN** `kb_search` is called with `scope: "git"` and `kind: "pr"`
- **THEN** every returned hit is a pull/merge request
- **AND** the result page is filled up to `limit` when enough matching items exist

#### Scenario: Kind without git scope is ignored
- **WHEN** `kind` is passed without `scope: "git"`
- **THEN** the call behaves as a docs search and `kind` has no effect

#### Scenario: Not a git repository
- **WHEN** `scope: "git"` is used in a directory that is not inside a git work tree
- **THEN** the tool returns a message stating the git scope is unavailable because the directory is not a git repository
- **AND** it does not throw

#### Scenario: Git scope disabled
- **WHEN** `git.enabled` is `false` and `scope: "git"` is used
- **THEN** the tool returns a message stating the git scope is disabled, and executes no git command

#### Scenario: doc_type ignored in git scope
- **WHEN** `kb_search` is called with `scope: "git"` and a `doc_type`
- **THEN** `doc_type` has no effect on the git results

### Requirement: Shared per-repository index

All worktrees and pi processes that share one git common directory SHALL share a
single git-scope index and sync state. The index SHALL be stored outside the
repository work tree.

#### Scenario: Worktrees share one index
- **WHEN** two sessions run in different worktrees of the same clone and one of them has indexed the history
- **THEN** a git-scope search in the other session returns those items without re-indexing them

#### Scenario: Nothing is written into the repository
- **WHEN** the git scope indexes or syncs
- **THEN** no file is created or modified inside the repository work tree or its `.git` directory

#### Scenario: Remote changes to a different forge repository
- **WHEN** the configured remote resolves to a different forge host or repository than the one the index was synced from
- **THEN** previously synced PRs, issues and comments are no longer returned, commits remain searchable, and a fresh forge sync starts

#### Scenario: Index is private to the user
- **WHEN** the git-scope index is created
- **THEN** its directory is readable only by the owning user and its database file is readable and writable only by the owning user

#### Scenario: Removed working directory
- **WHEN** a git-scope call runs in a session whose cwd no longer exists
- **THEN** the tool returns a message that the git scope is unavailable because the directory was removed, and does not throw

### Requirement: Local commit indexing

Commits SHALL be indexed from the local repository only, without any forge
request. The indexed history SHALL cover local branches, remote-tracking branches,
tags and every worktree's `HEAD` (including a detached `HEAD`). Indexing SHALL be
incremental: only commits not reachable from the previously indexed tips are
processed. Indexed content SHALL include the
subject, body, author name, author date and changed paths (capped per commit).
It SHALL NOT include the author e-mail or diff content.

#### Scenario: New commits become searchable
- **WHEN** a commit is created or fetched and a git-scope search runs afterwards
- **THEN** the commit is searchable by words from its subject or body and by its changed paths

#### Scenario: Unchanged refs do no work
- **WHEN** a git-scope search runs and no branch, remote-tracking branch or tag has moved since the last indexing
- **THEN** no commit is re-read or re-indexed

#### Scenario: Author e-mail is not indexed
- **WHEN** a commit whose message body contains no e-mail address is indexed
- **THEN** searching for its author e-mail address does not match that commit

#### Scenario: Detached worktree HEAD is indexed
- **WHEN** a commit is made on a detached `HEAD` in a worktree of the repository
- **THEN** a later git-scope search finds that commit

#### Scenario: Previously indexed tip was garbage-collected
- **WHEN** a previously indexed tip commit no longer exists in the object store
- **THEN** indexing recovers by re-walking from the current tips, without error, and already-indexed commits remain searchable

#### Scenario: First index is capped
- **WHEN** a repository has more reachable commits than `git.commits.maxInitial`
- **THEN** only the newest `git.commits.maxInitial` commits are indexed on the first run

### Requirement: Forge pull request and issue sync

When the repository's configured remote points to a supported forge (GitHub,
GitLab, Gitea/Forgejo/Codeberg) and `git.forge.enabled` is `true`, pull/merge
requests and issues SHALL be synced into the git scope. Indexed fields: title,
body, labels, state, author, number and dates. Comments SHALL NOT be fetched
during sync.

#### Scenario: PRs and issues are searchable
- **WHEN** the forge sync has completed for a GitHub repository
- **THEN** a git-scope search returns matching PRs and issues by words from their titles or bodies, with their state

#### Scenario: Unsupported forge
- **WHEN** the remote is on a host without an adapter (e.g. Bitbucket), on a self-hosted host not mapped in the global configuration, or there is no remote
- **THEN** commits remain searchable
- **AND** results carry a notice that forge items are unavailable for this remote

#### Scenario: No cleartext forge requests
- **WHEN** the repository remote uses `http://` and the host maps to a Gitea-family forge
- **THEN** forge requests use HTTPS only, and if HTTPS is unavailable the result reports the forge as unavailable without sending any request or credential over cleartext

#### Scenario: Missing CLI or credentials
- **WHEN** the forge CLI is not installed or not authenticated
- **THEN** commits remain searchable and the result notes that the forge is unavailable, with the reason
- **AND** the tool does not throw

#### Scenario: Credentials are never persisted
- **WHEN** the forge is synced
- **THEN** no token or credential is written to any kb file, config file or log

#### Scenario: Token only to allowlisted hosts
- **WHEN** the remote points to a Gitea-family host that is not listed in the global `git.forge.hosts`
- **THEN** no request to that host carries a credential

#### Scenario: Repository cannot redirect credentials
- **WHEN** a repository's project configuration sets `git.forge.hosts` or `git.forge.gitea.tokenEnv`
- **THEN** those project values are ignored with a warning and only the global values apply

### Requirement: Forge request budget

Forge sync SHALL be lazy, incremental and bounded:
- A sync SHALL be attempted only from a git-scope `kb_search` or `kb_get`, never on
  a timer and never from docs-scope calls.
- No sync SHALL start within `git.forge.minSyncIntervalSeconds` of the previous
  successful sync. After an event hint, the minimum is
  `git.forge.hintedMinSyncIntervalSeconds`.
- Each sync SHALL request only items updated since the stored watermark, and
  SHALL issue at most `git.forge.pagesPerSync` list pages per forge endpoint. Where
  one endpoint returns both pull requests and issues, it SHALL be requested once
  per page, not once per kind.
- The first sync SHALL be limited to `git.forge.firstSyncWindowDays` and
  `git.forge.firstSyncMaxItems`.
- When the forge reports a remaining rate below the configured floor, or signals
  rate limiting, no sync request SHALL be made until the reported reset time.

#### Scenario: Repeated searches within the interval cost nothing
- **WHEN** ten git-scope searches run in different sessions on the same repository within the minimum sync interval after a successful sync
- **THEN** no forge request is made by any of them

#### Scenario: Steady-state sync is incremental
- **WHEN** a sync runs after a previous successful sync and fewer than one page of items changed
- **THEN** at most one list request per forge endpoint is made, filtered by the stored watermark

#### Scenario: Interrupted sync loses nothing
- **WHEN** the syncing process dies while applying a page
- **THEN** the next sync resumes from the last fully applied page and every item updated since then is indexed exactly once

#### Scenario: Page cap resumes later
- **WHEN** more items changed than fit in `pagesPerSync` pages
- **THEN** the sync stops after the cap with its watermark advanced to the last applied item
- **AND** the next permitted sync continues from that watermark without losing or duplicating items

#### Scenario: Rate floor pauses syncing
- **WHEN** the last known remaining rate is below the floor
- **THEN** a git-scope search makes no forge request and returns the cached items
- **AND** the result states that forge data is stale because of the rate limit

#### Scenario: Rate observation expires at reset
- **WHEN** the last known remaining rate was below the floor and its reported reset time has passed
- **THEN** the next permitted git-scope search may sync again

#### Scenario: Rate-limit response backs off
- **WHEN** the forge answers a sync request with a rate-limit error
- **THEN** syncing is suspended until the reported reset or retry-after time

#### Scenario: Event hint shortens but does not bypass
- **WHEN** a `gh pr create` (or equivalent forge or `git push`) command completes in a session
- **THEN** the next git-scope search may sync once `hintedMinSyncIntervalSeconds` have elapsed since the last sync
- **AND** the rate floor and back-off still apply

#### Scenario: Hint during a running sync is not lost
- **WHEN** an event hint is recorded while another process is syncing
- **THEN** the syncing process performs one additional sync round before it finishes, regardless of the minimum intervals but still subject to the rate floor and back-off
- **AND** the item created by the hinted command becomes searchable without waiting for the full minimum sync interval

#### Scenario: Many items share one update time
- **WHEN** more items share the same update timestamp than fit in one sync's page cap
- **THEN** successive syncs still make progress and eventually index every item

#### Scenario: Forge without rate information
- **WHEN** the forge reports no remaining-rate information
- **THEN** syncing is still bounded by the minimum interval and by back-off on rate-limit responses

### Requirement: Single sync owner per repository

At most one process SHALL sync or write a repository's git-scope index at a time,
and a process that has lost ownership SHALL NOT be able to write afterwards.
Other processes SHALL serve the existing index without waiting for ownership.
Ownership left by a dead or hung process SHALL expire after
`git.forge.leaseSeconds` and be taken over automatically.

#### Scenario: Concurrent searches trigger one sync
- **WHEN** two sessions on the same repository run a git-scope search at the same moment while the data is stale
- **THEN** exactly one forge sync runs
- **AND** the other session returns results from the existing index without blocking on the sync

#### Scenario: Crashed owner does not block forever
- **WHEN** the owner dies mid-sync
- **THEN** a later git-scope search after `leaseSeconds` takes over ownership and syncs

#### Scenario: Deposed owner cannot write
- **WHEN** an owner stalls past its lease, another process takes over, and the stalled owner resumes
- **THEN** the stalled owner's subsequent writes are rejected and the index contains no interleaved partial writes

### Requirement: Bounded search latency

A git-scope call SHALL wait for commit indexing and forge sync together for at
most `git.searchWaitMs`. When they have not finished by then, it SHALL return
results from the current index, state which part is still in progress, and let
the work continue in the background.

#### Scenario: Slow first sync does not block
- **WHEN** the first forge sync takes longer than `searchWaitMs`
- **THEN** the search returns within that budget with the results indexed so far and a "sync in progress" notice

#### Scenario: Large first commit index does not block
- **WHEN** the first commit indexing of a large repository takes longer than `searchWaitMs`
- **THEN** the search returns within that budget with the commits indexed so far and states that commit indexing is in progress

### Requirement: Staleness reporting

Every git-scope result SHALL report the freshness of the commit and forge data:
fresh with the time since the last sync, stale with the reason, sync in progress,
unsupported, or unavailable.

#### Scenario: Freshness footer
- **WHEN** a git-scope search returns
- **THEN** the output includes one line stating the commit status and the forge sync status

#### Scenario: Commits never reported fresh while behind
- **WHEN** refs have moved since the last commit indexing and indexing is not complete
- **THEN** the commit status is reported as indexing or stale, never fresh

### Requirement: Git items on kb_get

`kb_get` SHALL accept an optional `scope` parameter (`"docs"` default, or
`"git"`). With `scope: "git"`, `path` SHALL be `commit/<sha>` (a unique prefix of
at least 7 hex characters), `pr/<n>` or `issue/<n>`. For a commit it SHALL return
the full message, author, date and changed paths. For a PR or issue it SHALL
return the indexed fields plus its comments, fetched from the forge on demand and
cached, subject to the minimum interval, the rate floor and back-off. Every git
item result SHALL list linked items. A call without `scope: "git"` SHALL behave
exactly as before.

#### Scenario: Commit by prefix
- **WHEN** `kb_get` is called with `scope: "git"` and `path: "commit/<7-char prefix>"` that matches exactly one indexed commit
- **THEN** it returns that commit's full message, author, date and changed paths

#### Scenario: Ambiguous or unknown commit prefix
- **WHEN** the prefix matches no commit or more than one
- **THEN** a not-found or ambiguity message is returned, listing candidates when ambiguous

#### Scenario: PR with comments
- **WHEN** `kb_get` is called with `scope: "git"` and `path: "pr/12"` for a synced PR
- **THEN** it returns the PR fields and its comments
- **AND** a second call within the minimum sync interval makes no forge request

#### Scenario: Comments under rate floor
- **WHEN** comments are requested while the rate is below the floor and none are cached
- **THEN** the PR fields are returned with a notice that comments are unavailable because of the rate limit

#### Scenario: Item not yet synced
- **WHEN** `kb_get` is called with `scope: "git"` for a PR or issue that is not indexed yet
- **THEN** it returns a not-indexed message with the current forge sync status and makes no per-item forge request

#### Scenario: Docs path unchanged
- **WHEN** `kb_get` is called with a path and no `scope`
- **THEN** it behaves exactly as before this change, including for paths beginning with `pr/` or `commit/`

### Requirement: Cross-links between history items

References in commit messages and PR/issue bodies SHALL be recorded as links:
- issue/PR numbers (`#N`, and `!N` for GitLab merge requests);
- closing keywords (`Fixes|Closes|Resolves #N`);
- URLs to the same repository's PRs or issues;
- OpenSpec change ids from `See change: <id>`.

`kb_get` SHALL list an item's links. A change id SHALL be shown as the change
directory path when that change exists locally, active or archived.

#### Scenario: Squash-merge commit links to its PR
- **WHEN** a commit subject ends with `(#123)` on a GitHub repository, the commit was indexed before PR 123 was synced, and PR 123 is synced afterwards
- **THEN** `kb_get` on that commit lists `pr/123` as linked

#### Scenario: Re-synced PR keeps its links
- **WHEN** PR 123 is updated on the forge and re-synced
- **THEN** commits that referenced it still list it as linked

#### Scenario: GitLab issue and merge request numbers stay distinct
- **WHEN** a GitLab commit message references `#7` and `!7`
- **THEN** `#7` links to issue 7 and `!7` links to merge request 7

#### Scenario: Commit links to an OpenSpec change
- **WHEN** a commit body contains `See change: add-foo` and `openspec/changes/archive/<date>-add-foo/` exists in the calling session's checkout
- **THEN** `kb_get` on that commit lists that archive directory as linked

### Requirement: Git results are marked untrusted

Every `kb_search` or `kb_get` result of the `git` scope SHALL mark itself untrusted
(`details.untrusted = true`), because commit messages routinely embed text written
by external contributors. The output SHALL also label each git hit as git content
and state that git results are data, not instructions, so the marking is visible
without an untrusted-content guard installed. Docs-scope results SHALL be
unaffected.

#### Scenario: PR hit is marked
- **WHEN** a git-scope search returns at least one PR or issue hit
- **THEN** the tool result carries `details.untrusted = true`

#### Scenario: Commit-only result is marked
- **WHEN** a git-scope search with `kind: "commit"` returns only commits
- **THEN** the tool result carries `details.untrusted = true`

#### Scenario: Visible marking without a guard
- **WHEN** no untrusted-content guard is installed and a git-scope search returns hits
- **THEN** each hit line is labelled as git content and the output states that git results are data, not instructions

#### Scenario: Docs results unaffected
- **WHEN** `kb_search` runs without `scope`
- **THEN** the result does not carry `details.untrusted`

### Requirement: Git scope configuration

The kb configuration SHALL accept a `git` group with the keys `enabled`, `remote`,
`searchWaitMs`, `commits.*` and `forge.*`. It SHALL be layered project → global →
defaults like the rest of the kb configuration, with every nested level of the
group keeping sibling values from earlier layers, and validated on load. The keys
`git.forge.hosts` and `git.forge.gitea.tokenEnv` SHALL be honoured only from the
global layer. Invalid values (non-positive
counts, intervals or caps, `rateFloorPercent` outside 0–100) SHALL produce a
validation error naming the key. Credentials SHALL NOT be configurable as values;
only the name of the environment variable that holds the Gitea token SHALL be
configurable.

#### Scenario: Invalid rate floor
- **WHEN** `git.forge.rateFloorPercent` is `150`
- **THEN** configuration validation fails with an error naming `git.forge.rateFloorPercent`

#### Scenario: Project overrides global
- **WHEN** the global config sets `git.forge.minSyncIntervalSeconds: 600` and the project config sets `300`
- **THEN** the effective value for that project is `300`
- **AND** every other `git.forge` key keeps its global value

#### Scenario: Hint interval longer than minimum
- **WHEN** `git.forge.hintedMinSyncIntervalSeconds` is greater than `git.forge.minSyncIntervalSeconds`
- **THEN** configuration validation fails with an error naming `git.forge.hintedMinSyncIntervalSeconds`

#### Scenario: Invalid host mapping
- **WHEN** `git.forge.hosts` maps a host to a value other than `github`, `gitlab` or `gitea`
- **THEN** configuration validation fails with an error naming `git.forge.hosts`
