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

The KB folder section's **sidebar** placement SHALL NOT render an action control inside its pill. It SHALL instead contribute a single declarative reindex item to the `folder-actions-menu` slot, in the `MAINTENANCE` group, which triggers a reindex of the folder's KB.

That menu contribution SHALL be made ONLY from the section's sidebar placement. The worktree-card placement's scope has no folder actions menu, and the section SHALL register nothing there — otherwise its item lands in a scope with nothing to render it. See `folder-actions-menu` → "Card-placement sections do not register".

The **card** placement SHALL instead render a compact reindex control as a **sibling of the pill, outside the pill root**, so the card surface has a direct reindex affordance despite having no folder actions menu, while the pill itself stays action-free in every placement (no interactive element nests inside the pill's button root). The sibling control SHALL express the same state-varying action as the menu item — "Retry" in the `error` state, in-progress and disabled in the `indexing` state, "Index now" in the `not-indexed` state, and "Reindex now" in the `stale` or `populated` state — and SHALL be disabled for the whole busy window (pending or a running job). Activating the sibling control, by pointer or keyboard, SHALL trigger only the reindex; it SHALL NOT also activate the pill's open-settings navigation. Its state label SHALL remain perceivable while the control is disabled.

Each placement exposes ONE affordance, and each expresses every state through its own attributes rather than separate controls. The **menu item** (sidebar) varies its label, badge and disabled state: "Retry" in `error`, disabled with an in-progress indication in `indexing`, "Index now" in `not-indexed`, "Reindex now" in `stale` or `populated`, carrying the stale badge when stale. The **sibling control** (card) varies its accessible name/tooltip and disabled state with the same labels; it carries NO badge — the pill's inline stale marker already renders that fact on the same card.

#### Scenario: State varies the single menu item

- **WHEN** the KB is in the `error` state
- **THEN** the menu SHALL show one KB item labelled "Retry" that calls `reindex()` on activation
- **WHEN** the KB is in the `indexing` state
- **THEN** the menu SHALL show one KB item that is disabled and indicates progress
- **WHEN** the KB is in the `not-indexed` state
- **THEN** the menu SHALL show one KB item labelled "Index now" that calls `reindex()` on activation
- **WHEN** the KB is in the `stale` or `populated` state
- **THEN** the menu SHALL show one KB item labelled "Reindex now" that calls `reindex()` on activation

#### Scenario: Never more than one KB action

- **WHEN** the menu renders for any KB state
- **THEN** exactly one KB reindex item SHALL render

#### Scenario: Pill carries no action control

- **WHEN** the KB folder section renders its pill in any placement
- **THEN** no reindex, retry or index-now control SHALL render inside the pill root

#### Scenario: Card placement renders a sibling reindex control

- **WHEN** the KB folder section renders in the card placement
- **THEN** exactly one compact reindex control SHALL render as a sibling of the pill, outside the pill root, whose action matches the KB state (Retry / Index now / Reindex now)
- **AND** no folder-actions-menu item SHALL be registered from the card placement
- **AND** the sidebar placement SHALL render no such sibling control

#### Scenario: Card sibling control disabled while busy

- **WHEN** the card placement's KB is pending or `indexing`
- **THEN** the sibling control SHALL render disabled and SHALL NOT invoke `reindex()` on activation
- **AND** its state label SHALL remain perceivable while disabled

#### Scenario: Card sibling control does not open settings

- **WHEN** the user activates the card placement's sibling reindex control by pointer or by keyboard
- **THEN** a reindex SHALL be triggered
- **AND** the KB settings page SHALL NOT open from that activation

### Requirement: Optimistic pending and double-submit prevention

The section SHALL reflect a reindex activation immediately and SHALL prevent a second submission while a reindex is in flight.

#### Scenario: Activation renders the indexing branch optimistically

- **WHEN** the user activates the reindex menu item and `pending` becomes true
- **THEN** the section renders the `indexing` branch immediately, before the server's 202 response or first stats poll
- **AND** an `error` condition still outranks `pending` so a rejected trigger shows the error/Retry state instead of a spinner

#### Scenario: Menu item disabled while busy

- **WHEN** `busy` is true, where `busy` is `pending` OR `stats.indexing`
- **THEN** the KB reindex menu item SHALL render disabled and SHALL NOT invoke its callback
- **AND** this covers the whole pending-plus-indexing window to prevent double-submit
- **AND** the guard SHALL cover the optimistic `pending` window, not only the polled `indexing` state

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
