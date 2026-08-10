# kb-plugin-folder-section Specification

## Purpose

The kb-plugin registers a per-folder KB section into the dashboard's folder and worktree card slots, plus an overlay route for the per-folder KB settings page. The section surfaces a folder's KB index state and offers a link into settings; navigation carries the folder's working directory encoded as a URL-safe base64url token.

## Requirements

### Requirement: Folder KB section slot registration

The plugin SHALL register a KB section component into the dashboard's folder-row and worktree-card slots so every folder and worktree surface shows a KB entry.

#### Scenario: Section claimed into folder and worktree slots

- **WHEN** the dashboard loads the plugin manifest
- **THEN** the same section component is claimed into the `sidebar-folder-section` slot
- **AND** the same section component is claimed into the `worktree-card-section` slot
- **AND** each claim resolves to the `FolderKbSection` component from the plugin's client entry

#### Scenario: Section receives the folder's working directory

- **WHEN** the slot renders the section for a folder or worktree
- **THEN** the section reads the folder's `cwd` from the slot-provided folder descriptor
- **AND** the section renders nothing when `cwd` is absent

### Requirement: KB settings overlay route claim

The plugin SHALL register an overlay route that opens the per-folder KB settings page for a folder path carried in the URL.

#### Scenario: Overlay route registered

- **WHEN** the dashboard loads the plugin manifest
- **THEN** a `shell-overlay-route` claim is registered with the route pattern `/folder/:encodedCwd/kb`
- **AND** the claim resolves to the `KbSettingsClaim` component

#### Scenario: Route decodes the folder path

- **WHEN** the overlay route activates with an `encodedCwd` route parameter
- **THEN** the folder path is decoded from `encodedCwd`
- **AND** the KB settings panel renders for the decoded folder path
- **AND** an "Invalid folder path" message renders instead when the parameter decodes to an empty or unparseable value

### Requirement: Base64url folder-path codec

The plugin SHALL encode and decode the folder working directory as a UTF-8-safe base64url token used in the settings route URL.

#### Scenario: Encoding a working directory

- **WHEN** a settings URL is built for a folder
- **THEN** the URL is `/folder/<token>/kb` where `<token>` is the `cwd` encoded to base64url
- **AND** the token replaces `+` with `-`, `/` with `_`, and strips trailing `=` padding
- **AND** a `cwd` containing non-Latin1 characters (accents, CJK) round-trips through UTF-8 bytes without error

#### Scenario: Decoding a token

- **WHEN** an `encodedCwd` token is decoded
- **THEN** the base64url token is converted back to the original `cwd` string
- **AND** decoding returns a null/empty result when the token is malformed

### Requirement: Section state and open-settings affordance

The section SHALL render a KB status summary derived from the folder's KB stats and SHALL always expose an affordance that opens the per-folder KB settings page.

#### Scenario: Status summary reflects KB state

- **WHEN** the folder's KB stats are available
- **THEN** the section shows one of the ordered states: error, indexing, not-indexed, stale, or populated
- **AND** the populated/stale states show the folder's chunk count, with a stale badge when there are stale entries
- **AND** the indexing state shows the in-progress file count
- **AND** error precedes indexing, which precedes the not-indexed and count-based states

#### Scenario: Opening settings in every state

- **WHEN** the user activates the KB status label
- **THEN** the app navigates to the folder's KB settings URL `/folder/<encodedCwd>/kb`
- **AND** this affordance is available in every state, including not-indexed and error, so a fresh folder can reach settings to define its sources

#### Scenario: Loading state before stats arrive

- **WHEN** the folder's KB stats are `null` (not yet fetched)
- **THEN** state derivation returns `loading`

### Requirement: Reindex action affordance

The section SHALL expose a per-state action control, separate from the settings label, that triggers a reindex of the folder's KB.

#### Scenario: Action control varies by state

- **WHEN** the section renders in the `error` state
- **THEN** a "Retry" button is shown that calls `reindex()` on activation
- **WHEN** the section renders in the `indexing` state
- **THEN** a spinning refresh icon is shown in place of an action button
- **WHEN** the section renders in the `not-indexed` state
- **THEN** an "Index now" button is shown that calls `reindex()` on activation
- **WHEN** the section renders in the `stale` or `populated` state
- **THEN** a refresh-icon button is shown that calls `reindex()` on activation
- **AND** the reindex control activation does not also open settings (click propagation is stopped)

### Requirement: Optimistic pending and double-submit prevention

The section SHALL reflect a reindex click immediately and SHALL prevent a second submission while a reindex is in flight.

#### Scenario: Click renders the indexing branch optimistically

- **WHEN** the user activates the reindex control and `pending` becomes true
- **THEN** the section renders the `indexing` branch immediately, before the server's 202 response or first stats poll
- **AND** an `error` condition still outranks `pending` so a rejected trigger shows the error/Retry state instead of a spinner

#### Scenario: Action controls disabled while busy

- **WHEN** `busy` is true, where `busy` is `pending` OR `stats.indexing`
- **THEN** the "Index now" and refresh-icon reindex buttons are disabled
- **AND** this covers the whole pending-plus-indexing window to prevent double-submit

### Requirement: Error state from client-side and poll failures

The section SHALL treat a rejected reindex trigger or a persistent stats-poll outage as the error state, in addition to a failed indexing job.

#### Scenario: Error derives from multiple sources

- **WHEN** the reindex trigger POST is rejected (`reindexError` set) so no job started
- **THEN** the section renders the `error` state
- **WHEN** the stats poll fails persistently (`error` set) with no live indexing walk
- **THEN** the section renders the `error` state
- **WHEN** the folder's KB stats report `jobStatus === "error"`
- **THEN** the section renders the `error` state
- **AND** the client-side error (`reindexError` or `error`) takes precedence over the stats-derived state when present
