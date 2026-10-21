## MODIFIED Requirements

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

Every session surface that reads the attached change SHALL use this function. That covers the session card, composer session actions, the mobile action menu, and the session OpenSpec block.

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
