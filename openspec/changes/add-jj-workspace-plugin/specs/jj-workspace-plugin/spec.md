# Capability: jj-workspace-plugin

## ADDED Requirements

### Requirement: Plugin manifest and slot claims

The dashboard SHALL load `@blackbelt-technology/pi-dashboard-jj-plugin` as a workspace package whose `package.json` carries the `pi-dashboard-plugin` manifest with `id: "jj"`.

The manifest SHALL claim the following slots:

- `session-card-badge` → `JjWorkspaceBadge`, predicate `isInJjWorkspace`
- `session-card-action-bar` → `JjActionBar`, predicate `isInJjRepo`
- `sidebar-folder-section` → `JjWorkspaceList`
- `command-route` `/jj` → `JjWorkspaceView`
- `settings-section` (tab `general`) → `JjPluginSettings`

#### Scenario: Predicate-gated rendering when jj is not installed

- **GIVEN** the user has no `jj` binary on PATH
- **THEN** the bridge's cwd probe never populates `Session.jjState`
- **AND** every claim's predicate returns `false`
- **AND** no JjPlugin component renders for any session
- **AND** no error or banner appears in the UI

#### Scenario: Badge displays workspace name when inside a jj workspace

- **GIVEN** a session whose cwd is inside `.shadow/agent-1/` of a jj-colocated repo
- **WHEN** the bridge's cwd probe reports `Session.jjState.workspaceName === "agent-1"`
- **THEN** the session card SHALL display a badge with the text "agent-1"
- **AND** clicking the badge SHALL navigate to the `/jj` content-area route for that session

### Requirement: Activation gate via tool registry + filesystem

The plugin SHALL be active for a given session if and only if:

- The shared `ToolRegistry` resolves `jj` to a non-null Resolution, AND
- The session's cwd contains a `.jj/` directory.

#### Scenario: Tool registry returns null for jj

- **GIVEN** `getDefaultRegistry().resolve("jj")` returns null
- **WHEN** the bridge's cwd probe runs
- **THEN** the probe SHALL skip jj entirely without writing `Session.jjState`

#### Scenario: jj is installed but cwd has no `.jj/`

- **GIVEN** the registry resolves jj successfully
- **AND** the session cwd has no `.jj/` directory
- **THEN** the probe SHALL set `Session.jjState = { isJjRepo: false, ... }` (or leave undefined; both are equivalent for predicate purposes)
- **AND** `JjWorkspaceBadge` SHALL render nothing

### Requirement: Workspace add via existing pending-attach lever

The dashboard SHALL expose a `POST /api/jj/workspace/add` endpoint accepting `{ fromCwd: string, name: string, taskDescription?: string }`.

The endpoint SHALL accept an optional `baseRev?: string` field naming the revision the new workspace's working copy commits onto. When omitted, the server SHALL resolve the current bookmark of `fromCwd` (via `jj log -r @ -T 'bookmarks'`) and use that; when no bookmark is present, the server SHALL fall back to the result of the revset `trunk()`.

The endpoint SHALL:

1. Validate `name` matches `/^[a-z0-9-]+$/`.
2. Compute the destination path as `<fromCwd>/<configuredWorkspaceRoot>/<name>` (default `<fromCwd>/.shadow/<name>`).
3. Reject with HTTP 409 if the destination path already exists.
4. Resolve `baseRev` per the rule above.
5. Run `jj workspace add <destPath> -r <baseRev>` via `platform/jj.ts`.
6. Resolve the destination with `safeRealpathSync`.
7. Call `pendingAttachRegistry.enqueue(realDestPath, name)`.
8. Call `spawnPiSession({ cwd: realDestPath, taskDescription })`.
9. Return HTTP 202 with the new session id (when known) or a ticket id (when queued).

Creating a workspace SHALL NOT alter the source workspace's working copy, index, bookmarks, or any other observable state. The plugin SHALL NOT require any other session to pause or quiesce before workspace creation.

#### Scenario: Successful workspace add and spawn

- **GIVEN** a colocated jj repo at `/repo`
- **WHEN** the browser POSTs `{ fromCwd: "/repo", name: "agent-1" }`
- **THEN** `/repo/.shadow/agent-1/` SHALL exist as a registered jj workspace
- **AND** a new pi session SHALL spawn with cwd `/repo/.shadow/agent-1/`
- **AND** the new session's `Session.jjState.workspaceName` SHALL be `"agent-1"` after the next probe tick

#### Scenario: Concurrent workspace creation while another session has uncommitted work

- **GIVEN** session A is in `/repo` on bookmark `develop` with uncommitted edits to `auth.ts`
- **AND** the repo is jj-colocated
- **WHEN** session B (or a browser action originating elsewhere) POSTs `{ fromCwd: "/repo", name: "agent-1" }`
- **THEN** the workspace add SHALL succeed without coordinating with session A
- **AND** session A's working copy on disk SHALL be unchanged
- **AND** session A's `@` commit SHALL be unchanged
- **AND** the new workspace's working copy SHALL be empty on top of `develop`, NOT inheriting session A's `auth.ts` edits
- **AND** the `develop` bookmark SHALL still point at the same commit as before

#### Scenario: Name validation rejection

- **GIVEN** the browser POSTs `{ fromCwd: "/repo", name: "agent_1" }` (underscore)
- **THEN** the endpoint SHALL respond HTTP 400 with `{ code: "INVALID_NAME", message: "..." }`
- **AND** no filesystem mutation SHALL occur

### Requirement: Workspace forget refuses on unfolded commits

The `POST /api/jj/workspace/forget` endpoint SHALL accept `{ cwd, name, force?: boolean }` and SHALL:

1. Inspect the workspace's working-copy state via `jj log -r 'fork_point(<workspace-name>@, trunk()) .. <workspace-name>@'`.
2. If the resulting revset contains any non-empty commits (i.e., the workspace has unfolded work), respond HTTP 409 (`code: "UNFOLDED_WORK"`) with a payload listing the change ids and descriptions of the unfolded commits, UNLESS `force === true`.
3. When the call succeeds (no unfolded work, or `force === true`):
   - Run `jj workspace forget <name>` to detach the workspace from the store.
   - Recursively delete the on-disk workspace directory (`<workspaceRoot>/<name>/`) via `fs.rm({ recursive: true, force: true })`.
   - Return HTTP 200.

The client `JjActionBar`'s "Forget workspace" button SHALL NOT pass `force: true` on the first attempt. If the server returns 409, the client SHALL render a confirmation dialog enumerating the unfolded commits and SHALL re-issue the request with `force: true` only after explicit user confirmation.

#### Scenario: Forget refused when workspace has unfolded commits

- **GIVEN** workspace `agent-1` whose `@` and `@-` contain agent commits not present on trunk
- **WHEN** the browser POSTs `{ cwd, name: "agent-1" }` (no `force`)
- **THEN** the endpoint SHALL respond HTTP 409 with `code: "UNFOLDED_WORK"` and a list of the unfolded commits
- **AND** `.shadow/agent-1/` SHALL still exist on disk
- **AND** `jj workspace list` SHALL still include `agent-1`

#### Scenario: Forget succeeds with force after confirmation

- **GIVEN** the same workspace with unfolded commits
- **WHEN** the browser re-issues the request with `force: true` after user confirmation
- **THEN** the endpoint SHALL run `jj workspace forget agent-1`
- **AND** SHALL `rm -rf .shadow/agent-1/`
- **AND** SHALL respond HTTP 200
- **AND** the unfolded commits SHALL remain in the jj op log (recoverable via `jj op restore`) but no longer reachable from any workspace tip

#### Scenario: Forget on clean workspace

- **GIVEN** workspace `agent-1` whose tip equals trunk (no unfolded work)
- **WHEN** the browser POSTs `{ cwd, name: "agent-1" }` (no `force`)
- **THEN** the endpoint SHALL succeed without requiring `force`
- **AND** SHALL forget the workspace and remove the directory

### Requirement: Fold-back skill is jj-native and never invokes mutating git

The skill `.pi/skills/jj-workspace-fold-back/SKILL.md` SHALL:

- Refuse to operate if the parent repo is not jj-colocated.
- Refuse to operate if `jj resolve --list` reports unresolved conflicts.
- Refuse to operate if `jj diff` against the workspace tip is empty.
- Refuse to operate if `git status --porcelain` reports staged or unstaged changes (footgun guardrail).
- NEVER invoke `git commit`, `git rebase`, `git cherry-pick`, `git merge`, `git reset --hard`, `git checkout` on tracked files, or `git stash`.
- Use `jj git push --bookmark <name>` as the sole git-touching operation, and only after the agent's changes have been bookmarked and rebased onto the trunk.

#### Scenario: Default flavor preserves agent commit history

- **GIVEN** the agent has produced 3 commits in workspace `agent-1`
- **WHEN** the user invokes `jj-workspace-fold-back` with the default flavor
- **THEN** the skill SHALL create a bookmark at the workspace's tip
- **AND** rebase the bookmark onto the trunk
- **AND** push via `jj git push --bookmark <bookmarkName>`
- **AND** all 3 commits SHALL be preserved in the resulting git history (no squash)

#### Scenario: Auto-abandon on rebase conflict

- **GIVEN** the fold-back skill has bookmarked the workspace tip and begun `jj rebase -d <trunk> -s <bookmark>`
- **WHEN** the rebase produces conflicts (`jj resolve --list` returns non-empty after the rebase)
- **THEN** the skill SHALL invoke `jj op restore <op-id-before-rebase>` to undo the rebase entirely
- **AND** SHALL surface the conflict details to the user (changed paths + conflicting hunks if available)
- **AND** SHALL NOT push anything
- **AND** SHALL leave the workspace in its pre-rebase state so the user can investigate or retry
- **AND** the fold-back operation SHALL be reported as failed (the skill returns an error to the caller)

The rationale: keeping the user in the workspace with conflicts mid-rebase produces a confusing state where the workspace's `@` is inside an in-progress rebase that they may not understand how to recover from. Restoring to pre-rebase state returns the user to known territory and lets them either resolve the conflicts manually in the workspace and re-invoke fold-back, or rebase the workspace onto trunk first themselves.

#### Scenario: Bookmark name auto-derived from workspace name

- **GIVEN** the user invokes fold-back from workspace `agent-1`
- **WHEN** the skill runs without an explicit `--bookmark` argument
- **THEN** the skill SHALL use `agent-1` as the bookmark name verbatim (matching the workspace name)
- **AND** SHALL refuse with a clear error if a bookmark named `agent-1` already exists pointing at a different commit

If the user supplies an explicit bookmark name, that overrides the auto-derived one.

#### Scenario: Refusal on dirty git index

- **GIVEN** the parent jj-colocated repo has staged changes (`git diff --cached` non-empty)
- **WHEN** the user invokes `jj-workspace-fold-back`
- **THEN** the skill SHALL refuse with a message that:
  - explains the index is invisible to jj and would silently desync after rebase,
  - presents `git reset` (no flags) as the safe escape hatch (clears index without touching working copy or HEAD),
  - presents `jj new -m "WIP"` as the jj-native equivalent of stash (set current work aside as a real change),
  - explicitly lists `git stash` as forbidden (resets the working tree, triggers an unwanted jj snapshot)

### Requirement: Plain-git repos receive an opt-in colocated-init affordance

When a session's cwd is inside a git repo that is NOT yet a jj repo, AND `showInitColocatedSuggestion === true` in plugin config, `JjActionBar` SHALL render a single "Enable jj workspaces" button (gated by the predicate `isInGitRepoButNotJj && showInitColocatedSuggestion`).

When `showInitColocatedSuggestion === false` (default), the plugin SHALL render nothing on plain-git sessions — no button, no banner, no nag. Users who want the affordance flip the setting once in `Settings → Jujutsu Workspaces`.

The corresponding `POST /api/jj/init-colocated { cwd }` endpoint SHALL:

1. Check that the git index is clean (`git diff --cached --quiet` exits 0).
2. Refuse with HTTP 409 (`code: "DIRTY_INDEX"`) if the index has staged changes — those changes live only in git's index and would be lost when jj writes the index to match `@-`.
3. Allow the operation when only the working tree is dirty (unstaged edits and untracked files); jj snapshots them into the new `@` commit non-destructively.
4. Run `jj git init --colocate` in the cwd.
5. Return HTTP 200 on success.

#### Scenario: Init allowed on unstaged dirty working tree

- **GIVEN** a git repo at `/repo` with an UNSTAGED modification to `README.md` and a clean index
- **WHEN** the browser POSTs to `/api/jj/init-colocated` with `{ cwd: "/repo" }`
- **THEN** the endpoint SHALL succeed (HTTP 200)
- **AND** `.jj/` SHALL be created
- **AND** the user's edits to `README.md` SHALL be preserved on disk and snapshot into the new `@` commit

#### Scenario: Init affordance hidden by default on plain-git

- **GIVEN** a session whose cwd contains `.git/` but no `.jj/`
- **AND** plugin config `showInitColocatedSuggestion` is `false` (default)
- **WHEN** the session card renders
- **THEN** no "Enable jj workspaces" button SHALL appear
- **AND** no other JjPlugin UI SHALL appear (the badge and full action bar require `.jj/`)

#### Scenario: Init affordance opt-in via plugin settings

- **GIVEN** the user toggles `showInitColocatedSuggestion` to `true` in plugin settings
- **WHEN** any plain-git session card re-renders
- **THEN** the "Enable jj workspaces" button SHALL appear on every plain-git session card

#### Scenario: Init refused on dirty index

- **GIVEN** a git repo at `/repo` with `git add src/foo.ts` having staged a blob that differs from HEAD
- **WHEN** the browser POSTs to `/api/jj/init-colocated` with `{ cwd: "/repo" }`
- **THEN** the endpoint SHALL respond HTTP 409 with `{ code: "DIRTY_INDEX", message: "..." }`
- **AND** no `.jj/` directory SHALL be created
- **AND** the message SHALL instruct the user to either commit or `git reset` the staged changes first

### Requirement: Plugin configuration via JSON Schema 7

The plugin SHALL declare a `configSchema.json` (JSON Schema 7) exposing:

- `defaultPushTarget`: enum `["trunk", "bookmark"]`, default `"bookmark"`
- `workspaceRoot`: string, default `".shadow"`
- `allowDirectTrunkPush`: boolean, default `false`
- `showInitColocatedSuggestion`: boolean, default `false` — when `false`, the "Enable jj workspaces" button on plain-git repos SHALL NOT render. The plugin is therefore opt-in for plain-git users; users who want the affordance enable it once in plugin settings.

Configuration is plugin-global (one set of values applies across all repos). The plugin SHALL NOT read per-repo override files. Users who need divergent settings per repo invoke the REST endpoints directly.

When `allowDirectTrunkPush` is `false`, the fold-back skill SHALL refuse any operation that would push to a bookmark named `main`, `master`, or `trunk`.

#### Scenario: Trunk push blocked by config

- **GIVEN** `allowDirectTrunkPush: false`
- **WHEN** the agent invokes the fold-back skill with intent to push directly to `main`
- **THEN** the skill SHALL refuse with a message and instruct the agent to push to a feature bookmark instead

### Requirement: Session diff is jj-aware in jj regimes

The `GET /api/session-diff` route SHALL select its diff strategy from the session's vcs regime:

- **Plain git** (no `.jj/` in cwd): use the existing `git diff HEAD -- <path>` enrichment unchanged.
- **jj-colocated, default workspace** (cwd is the colocated repo root, jj reports `default` workspace): use `jj diff --from @- --to @ -- <path>` per file.
- **jj non-default workspace** (cwd is a `jj workspace add` target): use `jj diff --from 'fork_point(@, trunk())' --to @ -- <path>` per file.

The response SHALL be additively extended with the optional fields `vcsKind: "git" | "jj"`, `diffBase: string` (the literal revset used), and `baseLabel: string` (human-readable, e.g. "develop" or "HEAD"). Existing clients SHALL continue to receive correctly-shaped diff entries; the new fields are opt-in.

Untracked files in the jj path SHALL rely on `jj diff`'s native new-file unified-diff output and SHALL NOT use the synthetic `/dev/null` fallback used by the git path.

#### Scenario: Diff in a workspace shows all agent commits, not just the last

- **GIVEN** a session in `/repo/.shadow/agent-1/` whose agent produced three jj commits via `jj new` between operations
- **AND** only the last commit's working-copy changes affect a file `src/auth.ts`
- **WHEN** the browser GETs `/api/session-diff` for this session
- **THEN** the response SHALL include the cumulative diff of all three commits for `src/auth.ts`, not only the last working-copy delta
- **AND** `vcsKind` SHALL be `"jj"`
- **AND** `diffBase` SHALL be the revset `fork_point(@, trunk())`

#### Scenario: Diff in plain git repo is unchanged

- **GIVEN** a session whose cwd contains `.git/` but no `.jj/`
- **WHEN** the browser GETs `/api/session-diff`
- **THEN** the response SHALL be byte-equivalent to the pre-change behavior for the existing `files` and `isGitRepo` fields
- **AND** `vcsKind` MAY be omitted or set to `"git"`

#### Scenario: Untracked file in jj path uses native jj diff output

- **GIVEN** a jj-aware session with a brand-new untracked file `src/new.ts`
- **WHEN** `/api/session-diff` runs the jj enrichment path
- **THEN** the file's `gitDiff` field SHALL contain the diff returned by `jj diff` directly
- **AND** the server SHALL NOT synthesize a `/dev/null` + `+`-prefixed-lines fallback

### Requirement: jj-aware bridge probe is gated by `.jj/` existence

The bridge's per-session 30 s cwd probe SHALL:

- Run a single `fs.access` check for `<cwd>/.jj/` before invoking any `jj` subprocess.
- Skip all jj probes if `.jj/` is absent (no subprocess spawn).
- Run `jj st --no-pager` and `jj workspace list --no-pager` in parallel only when `.jj/` exists.
- Update `Session.jjState` and broadcast via the existing `session_updated` message.

#### Scenario: Non-jj cwd incurs no jj subprocess cost

- **GIVEN** a session cwd of `/home/user/plain-folder` with no `.jj/`
- **WHEN** the bridge probe tick fires
- **THEN** zero `jj` subprocesses SHALL be spawned
- **AND** `Session.jjState` SHALL remain undefined or `{ isJjRepo: false }`
