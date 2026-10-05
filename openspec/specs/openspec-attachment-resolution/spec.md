# openspec-attachment-resolution Specification

## Purpose
TBD - created by archiving change resolve-archived-attached-proposal. Update Purpose after archive.

## Requirements

### Requirement: Attached change resolves to active, archived, or missing
The client SHALL resolve a session's `attachedProposal` with one pure function, `resolveAttachment`. The result SHALL be exactly one of:
- `{kind: "active", change, cwd}`
- `{kind: "archived", entry, cwd}`
- `{kind: "missing"}`
- `{kind: "unresolved", reason: "loading" | "disabled" | "error"}`

`cwd` SHALL be the folder in which the match was found.

The lookup order SHALL be:
1. active changes of `session.cwd`;
2. active changes of `session.gitWorktree.mainPath`;
3. archive entries of `session.cwd`;
4. archive entries of `session.gitWorktree.mainPath`.

Steps 2 and 4 SHALL apply only when `gitWorktree` is set and `mainPath` differs from `cwd`.

For each active step, the folder's state SHALL be one of:
- **known**: a settled entry with `initialized: true`; search its changes.
- **unavailable**: a settled `final` gate placeholder with `initialized: false`, whatever its readiness (`ABSENT`, `GLOBAL_OFF`, `OPTED_OUT`); skip the step. The `disabled` rule below for `session.cwd` takes precedence.
- **unsettled**: no entry, or only a `pending: true` placeholder.

An unsettled folder SHALL NOT count as "no active changes". When no earlier step matched and a needed folder is unsettled, or a needed archive has not been fetched, the result SHALL be `unresolved` with reason `loading`. When `session.cwd` reports readiness `GLOBAL_OFF` or `OPTED_OUT`, the result SHALL be `unresolved` with reason `disabled`. Archive steps SHALL run only after both active steps are known or unavailable. When a needed archive fetch has failed and no matching entry was found elsewhere, the result SHALL be `unresolved` with reason `error`, never `missing`.

An `unresolved` attachment SHALL render exactly as a bare attachment (name + `⋯` Detach), with no badge.

An archive entry SHALL match when its name equals `<YYYY-MM-DD>-<attachedProposal>`. Regex metacharacters in the name SHALL be escaped.

Every session surface that reads the attached change SHALL use this function. That covers the session card, the desktop session header, composer session actions, the mobile action menu, and the session OpenSpec block.

#### Scenario: Active change wins
- **WHEN** `attachedProposal = "add-auth"` and `session.cwd` has active change `add-auth`
- **THEN** the result SHALL be `kind: "active"` with that change
- **AND** no archive listing SHALL be fetched

#### Scenario: Archived in place
- **WHEN** `attachedProposal = "add-auth"`, `session.cwd` has no active `add-auth`, and the archive of `session.cwd` contains `2026-09-30-add-auth`
- **THEN** the result SHALL be `kind: "archived"` with entry `2026-09-30-add-auth` and `cwd = session.cwd`

#### Scenario: Removed worktree resolves against the main checkout
- **WHEN** `session.cwd = "/repo/.worktrees/os-add-auth"` has no OpenSpec data, `gitWorktree.mainPath = "/repo"`, and the `/repo` archive contains `2026-09-30-add-auth`
- **THEN** the result SHALL be `kind: "archived"` with `cwd = "/repo"`

#### Scenario: Removed worktree cwd is unavailable, not blocking
- **WHEN** `session.cwd` is a removed worktree whose `openspec_get` reply is a final `ABSENT` placeholder
- **THEN** step 1 SHALL be skipped and resolution SHALL continue with `mainPath`

#### Scenario: OpenSpec disabled for the folder
- **WHEN** `session.cwd` reports readiness `OPTED_OUT`
- **THEN** the result SHALL be `kind: "unresolved"`, reason `disabled`
- **AND** no `Archived` or `Not found` badge SHALL render

#### Scenario: Worktree change still active in main checkout
- **WHEN** a removed-worktree session's change is not archived but is still active in `gitWorktree.mainPath`, and `mainPath` is pinned or is some session's cwd
- **THEN** the result SHALL be `kind: "active"` with `cwd = mainPath` (rendered read-only per openspec-attach-combo, since `cwd ≠ session.cwd`)

#### Scenario: Unsettled data is unresolved, not missing
- **WHEN** an ended session's `cwd` has no settled `openspecMap` entry yet
- **THEN** the result SHALL be `kind: "unresolved"`, reason `loading`
- **AND** no `Not found` badge SHALL render

#### Scenario: Ended session attached to a still-active change
- **WHEN** an ended session in an unpinned folder is attached to `add-auth`, which is still active on disk
- **THEN** after the folder's `openspec_get` reply settles, the result SHALL be `kind: "active"`

#### Scenario: Nothing found
- **WHEN** neither active data nor any archive contains the name
- **THEN** the result SHALL be `kind: "missing"`

#### Scenario: Prefix-only names do not match
- **WHEN** `attachedProposal = "add-auth"` and the archive contains only `2026-09-30-add-auth-v2`
- **THEN** the result SHALL be `kind: "missing"`

### Requirement: Same-name archive disambiguation
When several archive entries match, let `startDay` be the local calendar date of `session.startedAt` minus one day. The resolver SHALL pick the newest matching entry whose date is on or after `startDay`, comparing `YYYY-MM-DD` strings. When no entry qualifies, it SHALL pick the newest matching entry overall.

#### Scenario: Picks the archive produced during the session
- **WHEN** the archive contains `2026-05-01-add-auth` and `2026-09-30-add-auth`, and `session.startedAt` is on 2026-09-20
- **THEN** the resolved entry SHALL be `2026-09-30-add-auth`

#### Scenario: Timezone skew tolerated
- **WHEN** the session started at local 2026-09-30 00:30 and the change was archived as `2026-09-29-add-auth` (archive stamped in an earlier timezone)
- **THEN** the resolved entry SHALL be `2026-09-29-add-auth`, not an older same-name entry

#### Scenario: Older session falls back to newest
- **WHEN** both matching entries predate `session.startedAt`
- **THEN** the resolved entry SHALL be the newest matching entry

### Requirement: Shared per-folder archive cache
The client SHALL fetch `GET /api/openspec-archive?cwd=<cwd>` at most once per folder while all of these hold: the folder's active change set is unchanged, the cached listing is younger than 5 minutes, and the last fetch did not fail within the past 30 seconds without a retry being due. Concurrent readers SHALL share one in-flight request.

Attachment resolution SHALL trigger a fetch only when it reaches an archive step. Direct consumers of the listing, such as the archive browser via `useArchiveListing`, fetch on mount as today.

When the set of active change names for a folder changes, the next read of that folder's archive SHALL refetch.

#### Scenario: Many ended sessions in one folder
- **WHEN** 20 ended session cards in `/repo` each need archive resolution
- **THEN** exactly one archive request for `/repo` SHALL be made

#### Scenario: Running session flips to archived
- **WHEN** a running session is attached to `add-auth` and `/skill:openspec-archive-change add-auth` moves the change into the archive
- **THEN** after the next OpenSpec poll removes `add-auth` from the active set, the archive SHALL be refetched
- **AND** the session SHALL resolve `kind: "archived"` without a page reload

#### Scenario: Failed fetch is retried
- **WHEN** the archive request for `/repo` fails
- **THEN** affected attachments SHALL resolve `kind: "unresolved"`, reason `error`, and render bare with no `Not found` badge
- **AND** `useArchiveListing("/repo")` SHALL expose the error
- **AND** a read at least 30 s later SHALL issue a new request

#### Scenario: Quiet folder refreshes after TTL
- **WHEN** a cached archive listing is older than 5 minutes and its folder's active set has not changed
- **THEN** the next read SHALL refetch

### Requirement: OpenSpec data is requested for attachment folders
The set of cwds that the client reconciles via `openspec_get` SHALL include the `cwd` and the `gitWorktree.mainPath` of every rendered session card with a non-empty `attachedProposal`, ended sessions included. While the archive browser route is active, the set SHALL also include the archive folder, plus the `cwd` and `mainPath` of every session (rendered or not) whose `attachedProposal` matches an entry of that folder's archive. Existing dedupe, in-flight and timeout rules SHALL apply unchanged.

#### Scenario: Ended session folder is requested
- **WHEN** an ended session card attached to `add-auth` renders for unpinned folder `/proj` with no other live session
- **THEN** the client SHALL send `openspec_get` for `/proj` exactly once while no settled entry exists

#### Scenario: Removed worktree requests its main checkout
- **WHEN** a rendered ended session has `gitWorktree.mainPath = "/repo"` and `cwd = "/repo/.worktrees/os-x"`
- **THEN** `openspec_get` SHALL be requested for both `/repo/.worktrees/os-x` and `/repo` (each deduped)

#### Scenario: Archive browser requests data for non-rendered candidates
- **WHEN** the archive browser for unpinned `/repo` is open, and ended session A (`cwd=/repo/.worktrees/os-x`, `mainPath=/repo`, attached to `x`) is not rendered in the sidebar while `/repo` has entry `2026-09-30-x`
- **THEN** `openspec_get` SHALL be requested for `/repo` and `/repo/.worktrees/os-x`
- **AND** A's chip SHALL appear on that entry once both settle
