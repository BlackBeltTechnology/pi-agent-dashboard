## MODIFIED Requirements

### Requirement: Folder group header shows OpenSpec section

Each folder group in the session list SHALL render a `FolderOpenSpecSection` component in the
folder header, below git info and above editor/spawn buttons, driven by the cwd's broadcast
readiness state (see `openspec-readiness`).

The previous gate — render only when `initialized: true` or `pending: true` — is retired. It
made the two states a user must act on (`ABSENT`, `BROKEN`) the two states with no affordance.

The section SHALL NOT render for `GLOBAL_OFF`, for `OPTED_OUT`, or for `ABSENT` when
`offerInitialization` is `false`. It SHALL render in every other state.

The section SHALL render as a single-line pill in every state, matching the READY pill's height
and chrome. It SHALL NOT render as a banner in any state, because a directory whose OpenSpec is
missing or broken is not blocked from proceeding.

#### Scenario: Directory with initialized OpenSpec

- **WHEN** a folder group is rendered for a cwd whose readiness state is `READY`
- **THEN** a `FolderOpenSpecSection` SHALL be rendered showing the standard collapsed header

#### Scenario: Directory with openspec dir but slow poll pending

- **WHEN** a folder group is rendered for a cwd whose readiness state is `PENDING`
- **THEN** a `FolderOpenSpecSection` SHALL be rendered showing the grey loading spinner (no
  buttons, no chevron)

#### Scenario: Directory without OpenSpec now offers initialization

- **WHEN** a folder group is rendered for a cwd whose readiness state is `ABSENT` and
  `offerInitialization` is `true`
- **THEN** a `FolderOpenSpecSection` SHALL be rendered showing a not-set-up label, an
  Initialize action, and a dismiss action
- **AND** it SHALL NOT render a change count or a navigation affordance to the board

#### Scenario: Fleet switch suppresses the offer

- **WHEN** a folder group is rendered for a cwd whose readiness state is `ABSENT` and
  `offerInitialization` is `false`
- **THEN** no OpenSpec section SHALL be rendered in the folder header

#### Scenario: Directory without OpenSpec

- **WHEN** a folder group is rendered for a cwd whose OpenSpec data carries no `readiness`
  (an older server) and reports neither `initialized: true` nor `pending: true`
- **THEN** no OpenSpec section SHALL be rendered in the folder header
- **AND** no disabled or stale state SHALL be inferred from the absent data — the
  pre-readiness hide behaviour is preserved verbatim for legacy payloads

#### Scenario: Globally disabled renders nothing

- **WHEN** a folder group is rendered for a cwd whose readiness state is `GLOBAL_OFF`
- **THEN** no OpenSpec section SHALL be rendered in the folder header

#### Scenario: Opted-out directory renders nothing

- **WHEN** a folder group is rendered for a cwd whose readiness state is `OPTED_OUT`
- **THEN** no OpenSpec section SHALL be rendered in the folder header
- **AND** the folder actions menu SHALL offer re-enabling (see `folder-actions-menu`)

#### Scenario: Pinned directory with no sessions

- **WHEN** a pinned directory has OpenSpec data but no active sessions
- **THEN** the `FolderOpenSpecSection` SHALL still be rendered for its readiness state

## ADDED Requirements

### Requirement: Folder section renders a state-specific recovery action

For each rendered non-`READY`, non-`PENDING` state the section SHALL render the action that
resolves that state, keyed on the readiness reason:

| state · reason | label | action |
|---|---|---|
| `ABSENT` | not set up | Initialize — `POST /api/openspec/init` |
| `BROKEN` · `missing-changes-dir` | not initialized properly | Repair — confirm, then `POST /api/openspec/init` |
| `BROKEN` · `cli-failed` | OpenSpec command failed | **no destructive action** — show the error |
| `STALE` · `missing-skills` | skills missing | Update — `POST /api/openspec/update` |
| `STALE` · `profile-stale` | needs update | Update — `POST /api/openspec/update` |

`BROKEN` · `cli-failed` SHALL NOT offer Repair. Re-running init cannot fix a failing CLI, and
the invocation carries `--force`, which auto-cleans files in a directory that may hold real
proposals.

`ABSENT` SHALL additionally render a dismiss control that adds the cwd to the opt-out list.
`BROKEN` and `STALE` SHALL NOT render a dismiss control: the user has already opted in, and
silencing a broken state is not a resolution.

#### Scenario: Initialize triggers server-side init

- **WHEN** the user activates Initialize on an `ABSENT` folder section
- **THEN** the client SHALL call `POST /api/openspec/init` for that cwd
- **AND** on success the section SHALL re-render in its new readiness state without a manual
  refresh

#### Scenario: Initialize over legacy files requires confirmation

- **WHEN** the user activates Initialize for a directory that already contains legacy OpenSpec
  files that the invocation would auto-clean
- **THEN** a confirmation naming the directory SHALL be shown before any request is sent

#### Scenario: Repair requires confirmation

- **WHEN** the user activates Repair on a `BROKEN` · `missing-changes-dir` folder section
- **THEN** a confirmation naming the directory SHALL be shown before any request is sent
- **AND** dismissing the confirmation SHALL send no request

#### Scenario: CLI failure offers no repair

- **WHEN** the folder section renders for `BROKEN` · `cli-failed`
- **THEN** no Repair or Initialize control SHALL be present
- **AND** the underlying error SHALL be shown

#### Scenario: Dismiss opts the directory out

- **WHEN** the user activates dismiss on an `ABSENT` folder section
- **THEN** the cwd SHALL be added to `openspec.optOutDirectories`
- **AND** the section SHALL stop rendering for that cwd

#### Scenario: Broken and stale states offer no dismiss

- **WHEN** a folder section renders in state `BROKEN` or `STALE`
- **THEN** no dismiss control SHALL be present

#### Scenario: Init failure surfaces the CLI error

- **WHEN** an Initialize or Repair request fails
- **THEN** the CLI's stderr SHALL be surfaced to the user
- **AND** the section SHALL remain in its previous state rather than showing success
