## ADDED Requirements

### Requirement: Desktop session card keeps only state and its inline controls

The desktop session card SHALL render no action chips, no action rows, and no per-subcard option menus.

**Kept on the card:**
- **Header controls:** the Archive button (when archiving is offered), the session actions trigger `⋯`, and the Exit ✕ button (for alive sessions).
- **Controls that act on one running thing**, unchanged:
  - the PROCESS subcard's row controls (stop an individual in-flight tool, kill a background process, expand or collapse the drawer);
  - the `ProcessSafetyChip` that replaces a hidden PROCESS subcard;
  - the abort control on a running flow's status in the FLOWS subcard.
- **The disabled-OPENSPEC remediation control.**
- **Clickable status:** the OpenSpec lifecycle bar, the attached change link, the archived / missing / main-checkout letters and badges, the git branch control, the dirty-files pill, the PR link, and plugin status pills (for example, KB / MCP worktree pills).

Every other action SHALL be reached through the session actions menu (`session-actions-menu`).

The `session-card-action-bar` slot's output SHALL NOT render on the desktop card, although its claims stay mounted (see `session-actions-menu`). The Rename button SHALL NOT render in the header; double-clicking the name SHALL still start an inline rename, and Rename… is offered in the menu.

#### Scenario: No action chips on an ended session card
- **WHEN** a desktop card renders for an ended session with a `sessionFile` in a git repo
- **THEN** no Resume, Fork, +Session or +Worktree button SHALL render on the card
- **AND** the header SHALL render the Archive button and `session-actions-trigger-<id>`

#### Scenario: PROCESS row controls stay on the card
- **WHEN** a desktop card renders for a session with an in-flight bash tool and a background process
- **THEN** the tool row's stop control and the process row's kill control SHALL render inside the PROCESS subcard as before
- **AND** no Archive button SHALL render (unchanged rule: never archive while running)

#### Scenario: Disabled OPENSPEC keeps its remediation control
- **WHEN** a desktop card renders an OPENSPEC subcard in a BROKEN readiness state
- **THEN** its single remediation control SHALL render and route as before

#### Scenario: Double-click rename still works
- **WHEN** the user double-clicks the session name on a non-ended desktop card
- **THEN** the inline rename input SHALL appear

### Requirement: Subcards render nothing when their content is empty

Each subcard's content SHALL be wrapped in the existing prop guards. When a guard yields no
element, the corresponding `SessionSubcard` SHALL render nothing (no panel, no title).

For MEMORY, WORKSPACE, and FLOWS, the wrapper's visibility is governed by the `shouldRender`
claim field (see `dashboard-plugin-loader` capability). The wrapper SHALL hide when EITHER no
plugin claims the slot OR every claim has `shouldRender(session) === false`. A plugin that
registers a claim whose component conditionally returns `null` SHALL declare a `shouldRender`
**whose boolean condition matches the claim component's own render/skip condition**, so the
wrapper never renders an empty panel.

For the FLOWS subcard specifically, the `session-card-flows` claim (`SessionFlowActionsClaim`)
now renders only flow status; the flow actions moved to the session actions menu (see
`flows-plugin`). The claim returns `null` when the session has no flow event. Its `shouldRender`
predicate SHALL therefore return `true` **iff** the session has at least one flow event (a flow
is running or has run). The predicate SHALL NOT open on `flowsList` contents, on edit mode, or
on mere pi-flows extension presence.

**The OPENSPEC subcard is exempt from the empty-content rule.** Its visibility is governed by
readiness, and in the `BROKEN` and `STALE` states it renders deliberately with no action
controls. An OPENSPEC panel containing only a reason line and a single remediation control
SHALL NOT be treated as empty.

#### Scenario: Empty PROCESS subcard is hidden

- **WHEN** a desktop session card is rendered with `processes={[]}`
- **THEN** no element with title text `PROCESS` SHALL appear

#### Scenario: Control-less OPENSPEC subcard is not treated as empty

- **WHEN** the OPENSPEC subcard renders disabled, containing only a reason line and a single
  remediation control
- **THEN** the panel and its `OPENSPEC` title SHALL still render

#### Scenario: FLOWS subcard hidden without flow activity

- **WHEN** a desktop session card is rendered for a session whose cwd has the pi-flows
  extension loaded (a `flows` command is present)
- **AND** the session's `flowsList` is empty
- **AND** the flows plugin edit mode (`editFlow`) is off
- **AND** the session has no flow event (no flow running or previously run)
- **THEN** no element with title text `FLOWS` SHALL appear
- **AND** no empty flows panel SHALL be rendered

#### Scenario: Edit mode alone does not show the FLOWS subcard

- **WHEN** a desktop session card is rendered for a session with an empty `flowsList`
- **AND** the flows plugin edit mode (`editFlow`) is on
- **AND** the session has no flow event
- **THEN** no element with title text `FLOWS` SHALL appear
- **AND** the author-first **New / Edit…** entry point SHALL be offered in the session actions menu instead

#### Scenario: FLOWS subcard appears once a flow has run

- **WHEN** a desktop session card is rendered for a session with an empty `flowsList` and edit
  mode off
- **AND** the session has at least one flow event (a flow ran or is running)
- **THEN** an element with title text `FLOWS` SHALL appear

## MODIFIED Requirements

### Requirement: Desktop session card body groups sections into six subcards in order
The desktop branch of `SessionCard.tsx` SHALL render its grouped sections as `SessionSubcard` instances in the following top-to-bottom order: `OPENSPEC`, `GIT`, `STATUS`, `PROCESS`, `FLOWS`, `MEMORY`.

The header zone SHALL remain outside any subcard, above the first subcard. It contains:
- the status chip, the name (double-click to rename), the time, the Archive / `⋯` / Exit controls;
- the model + thinking-level line;
- the activity row with context bar + cost.

The header zone SHALL NOT contain action chips (Resume, Fork, +Session, +Worktree); those actions live in the session actions menu. No footer action row SHALL render below the last subcard. The `session-card-action-bar` slot's output renders in the session actions menu.

The previous `WORKSPACE` subcard SHALL be removed and replaced by two sibling subcards `GIT` and `STATUS` rendered in that order. The `GIT` subcard hosts git branch / PR / worktree information as clickable status. It SHALL NOT host a worktree actions row; worktree actions live in the session actions menu's GIT group. The `STATUS` subcard hosts the `session-card-badge` slot (goal / automation badge contributions).

#### Scenario: All six subcard titles appear in order when populated
- **WHEN** a desktop session card is rendered with content for every subcard
- **THEN** the rendered DOM SHALL contain centered title elements `OPENSPEC`, `GIT`, `STATUS`, `PROCESS`, `FLOWS`, `MEMORY` in that document order

#### Scenario: Header zone stays outside subcards
- **WHEN** a desktop session card is rendered
- **THEN** the session name, model line, and activity/cost row SHALL render before the first `SessionSubcard` element
- **AND** none of those elements SHALL be descendants of a `SessionSubcard`

#### Scenario: WORKSPACE subcard no longer rendered
- **WHEN** a desktop session card is rendered
- **THEN** no element with title text `WORKSPACE` SHALL appear in the rendered DOM

#### Scenario: No footer action row and no worktree actions row
- **WHEN** a desktop session card is rendered for a worktree session with an action-bar plugin claim
- **THEN** no element SHALL render below the last subcard
- **AND** the GIT subcard SHALL NOT contain Push, Open PR, Merge or Close worktree controls

### Requirement: Resume button disabled when cwd missing
When `session.cwdMissing === true`, the desktop session card's Resume action, an item of the session actions menu, SHALL be disabled with the reason "session's directory no longer exists".

#### Scenario: Resume disabled
- **WHEN** the user opens the session actions menu of a cwd-missing ended session
- **THEN** the Resume item SHALL be `aria-disabled="true"`
- **AND** its reason SHALL read "session's directory no longer exists"

### Requirement: +Session sibling-spawn button on session card
The desktop session card SHALL offer an always-available New session action (formerly the inline `+Session` button) as an item of the session actions menu's SESSION group, with test id `session-card-spawn-sibling`. Unlike Fork/Resume, this action SHALL NOT be gated on `session.status === "ended"` or on the presence of `session.sessionFile` — it is offered for live and ended sessions alike.

Activation SHALL emit a `spawn_session` ws message with:
- `cwd` set to the parent session's `cwd`,
- `attachProposal` set to the parent session's `attachedProposal` when that field is a non-empty string (omitted otherwise),
- a fresh `requestId` (UUIDv4).

The action SHALL be disabled when `session.cwdMissing === true`, with the reason `session's directory no longer exists`.

The action SHALL NOT carry `gitWorktreeBase` or any worktree-related metadata. Worktree-sibling spawning is covered by separate surfaces (New worktree session, folder `+Worktree`, per-change `⑂+`).

The action SHALL use the green session-spawn palette, consistent with every other session-spawn control (`FolderSpawnButtons` `+ New Session`, folder-section `spawn-attached`). Session-spawn actions SHALL NOT use the purple `accent` palette, which is reserved for OpenSpec actions (Attach / Archive).

#### Scenario: Visible on live session
- **WHEN** the session actions menu opens for a session with any non-ended status
- **THEN** the New session item SHALL render
- **AND** Fork SHALL render only when the session has a `sessionFile`, and Resume SHALL NOT render

#### Scenario: Visible on ended session alongside Fork
- **WHEN** the session actions menu opens for a session with `status === "ended"` and a valid `sessionFile`
- **THEN** New session, Resume and Fork SHALL all render in the SESSION group

#### Scenario: Click inherits cwd and proposal
- **WHEN** the user activates New session on a session with `cwd = "/project/foo"` and `attachedProposal = "add-dark-mode"`
- **THEN** a `spawn_session` ws message SHALL be sent with `cwd: "/project/foo"`, `attachProposal: "add-dark-mode"`, and a UUIDv4 `requestId`

#### Scenario: Click omits proposal when parent has none
- **WHEN** the user activates New session on a session whose `attachedProposal` is `null`, `undefined`, or empty string
- **THEN** the emitted `spawn_session` payload SHALL omit the `attachProposal` key entirely (not send empty string)

#### Scenario: Disabled on missing cwd
- **WHEN** the parent session has `cwdMissing === true`
- **THEN** the New session item SHALL be `aria-disabled="true"` with reason `session's directory no longer exists`
- **AND** activating it SHALL NOT emit a `spawn_session` message

### Requirement: +Worktree button on session card
The desktop session card SHALL offer a New worktree session action (formerly the inline `+Worktree` button) as an item of the session actions menu's SESSION group, with test id `session-card-spawn-worktree`.

It SHALL be gated by the `gitWorktreeEnabled` config flag (default true), mirroring the folder-header `+Worktree` gate. It SHALL NOT be gated on `session.status` or `session.sessionFile`.

It SHALL be hidden in either of these cases:
- the session is already a worktree session (`session.gitWorktree` set), since spawning a worktree from inside a worktree is redundant;
- the session's cwd is a **confirmed non-git** directory, `session.isGitRepo === false`.

It SHALL remain offered when `session.isGitRepo` is `true` OR `undefined` (unknown / not-yet-probed / legacy). A git repo whose probe timed out, or a session predating the signal, must never lose the action. The gate SHALL NOT use `session.gitBranch`: that is a data-arrival signal, absent during the register race, on probe failure and after a server restart for cold sessions, so it would wrongly hide the action for real git repos.

Activation SHALL open the existing `WorktreeSpawnDialog` scoped to the parent session's `cwd`.
- When `session.attachedProposal` is a non-empty string, the dialog SHALL open via the proposal-aware path (pre-filled branch `os/<change>`, with `attachProposal` carried through).
- Otherwise it SHALL open via the plain path (no proposal).

The action SHALL be disabled when `session.cwdMissing === true`, with reason `session's directory no longer exists`. The card SHALL NOT implement its own worktree-creation, bootstrap or `spawn_session` logic; it reuses the dialog's existing machinery.

#### Scenario: Visible next to +Session in a git repo
- **WHEN** the session actions menu opens with `gitWorktreeEnabled !== false`, a worktree handler supplied, AND `session.isGitRepo === true`
- **THEN** the New worktree session item SHALL render after New session

#### Scenario: Hidden when worktrees disabled
- **WHEN** the dashboard config has `gitWorktreeEnabled === false`
- **THEN** the New worktree session item SHALL NOT render (the New session item is unaffected)

#### Scenario: Hidden in a confirmed non-git folder
- **WHEN** the session actions menu opens with `gitWorktreeEnabled !== false` and a worktree handler supplied, but `session.isGitRepo === false`
- **THEN** the New worktree session item SHALL NOT render
- **AND** the New session item SHALL be unaffected

#### Scenario: Visible when git status is unknown (no regression)
- **WHEN** the session actions menu opens with `gitWorktreeEnabled !== false` and a worktree handler supplied, and `session.isGitRepo` is `undefined` (probe inconclusive, register race, or legacy session)
- **THEN** the New worktree session item SHALL render (unknown is not treated as non-git)

#### Scenario: Click with proposal opens proposal-aware dialog
- **WHEN** the user activates New worktree session on a session with `attachedProposal = "add-dark-mode"`
- **THEN** the `WorktreeSpawnDialog` SHALL open scoped to the session's `cwd` with branch pre-filled `os/add-dark-mode` and `attachProposal` carried through

#### Scenario: Click without proposal opens plain dialog
- **WHEN** the user activates New worktree session on a session with no `attachedProposal`
- **THEN** the `WorktreeSpawnDialog` SHALL open scoped to the session's `cwd` with no pre-filled proposal

### Requirement: OPENSPEC subcard visibility is governed by broadcast readiness

The OPENSPEC subcard's gate SHALL be the cwd's broadcast readiness state (see
`openspec-readiness`), replacing the `openspecHasDir || openspecPending` condition currently
evaluated in `SessionCard.tsx` and the equivalent condition in `ComposerSessionActions.tsx`.

| readiness state | OPENSPEC subcard |
|---|---|
| `GLOBAL_OFF` | hidden |
| `OPTED_OUT` | hidden |
| `ABSENT` | hidden |
| `PENDING` | existing placeholder |
| `BROKEN` | rendered **disabled** |
| `STALE` | rendered **disabled** |
| `READY` | rendered live when the session has an attachment to show; not rendered on the desktop card for an unattached session (its actions are in the session actions menu) |

`ABSENT` hides rather than disabling: initialization is offered once on the folder card, not
repeated on every session card in that directory.

When `readiness` is absent from the payload — an older server — the gate SHALL degrade to the
previous `hasOpenspecDir || pending` behaviour and SHALL NOT render a disabled subcard.

#### Scenario: Directory with no OpenSpec hides the subcard

- **WHEN** a desktop session card is rendered for a session whose cwd readiness is `ABSENT`
- **THEN** no element with title text `OPENSPEC` SHALL appear

#### Scenario: Partially initialized directory disables the subcard

- **WHEN** a desktop session card is rendered for a session whose cwd readiness is `BROKEN`
- **THEN** an element with title text `OPENSPEC` SHALL appear
- **AND** it SHALL NOT render the Explore, Propose, Attach, or Archive controls

#### Scenario: Valid project with no pi skills disables the subcard

- **WHEN** a desktop session card is rendered for a session whose cwd readiness is `STALE`
  with reason `missing-skills`
- **THEN** the OPENSPEC subcard SHALL render disabled
- **AND** the reason text SHALL indicate that the project's OpenSpec skills are missing

#### Scenario: Ready project renders live controls

- **WHEN** a desktop session card is rendered for a session attached to a change, whose cwd readiness is `READY`
- **THEN** the OPENSPEC subcard SHALL render live: the attached change link and the lifecycle bar
- **AND WHEN** the session has no attachment
- **THEN** no OPENSPEC subcard SHALL render, and the session actions menu SHALL offer the unattached OpenSpec actions

#### Scenario: Legacy server degrades to previous behaviour

- **WHEN** the client receives `OpenSpecData` with no `readiness` field
- **THEN** the subcard SHALL render exactly as it does today
- **AND** no disabled variant SHALL be shown

## REMOVED Requirements

### Requirement: Subcards hide when their content is empty
**Reason**: Replaced by "Subcards render nothing when their content is empty". Its FLOWS clause changes, because the FLOWS subcard now carries flow status only and flow actions moved to the session actions menu. A REMOVED + ADDED pair lets the FLOWS scenarios be renamed to match the new behaviour.
**Migration**: The general empty-content rule and the OPENSPEC exemption are unchanged in the replacement. The FLOWS predicate becomes "at least one flow event". The edit-mode authoring entry point is now the **New / Edit…** item in the session actions menu.
