## ADDED Requirements

### Requirement: Folder list mode setting (Classic default)

The dashboard SHALL expose a global setting `folderListMode: "classic" | "accordion"` persisted in the server config, defaulting to `"classic"`. A secondary setting `folderAttentionPeek: boolean` SHALL default to `true`.

When `folderListMode` is `"classic"`, the sidebar SHALL render exactly as it did before this change: the focus-driven derivation (`activeCwd`, render-mode resolution, header-body focus split) SHALL NOT apply, and folders SHALL follow the existing binary `collapsedGroups` toggle only. When `folderListMode` is `"accordion"`, the focus-driven behavior in the requirements below SHALL apply.

The config parser SHALL fall back to `"classic"` for any unrecognized `folderListMode` value.

#### Scenario: Classic is the default
- **WHEN** no `folderListMode` is persisted
- **THEN** the effective mode SHALL be `"classic"` and the sidebar SHALL render with today's binary-collapse behavior unchanged

#### Scenario: Classic mode ignores focus
- **WHEN** `folderListMode` is `"classic"` and a session in folder `/foo` is selected
- **THEN** no folder SHALL be treated as focused and every folder SHALL follow its `collapsedGroups` state only

#### Scenario: Accordion enables focus-driven rendering
- **WHEN** `folderListMode` is `"accordion"`
- **THEN** the active-folder derivation and render-mode resolution SHALL govern folder rendering

#### Scenario: Unknown mode falls back to Classic
- **WHEN** the persisted `folderListMode` is an unrecognized string
- **THEN** the parser SHALL yield `"classic"`

#### Scenario: Attention peek off forces compact-empty
- **WHEN** `folderListMode` is `"accordion"` and `folderAttentionPeek` is `false`
- **THEN** every unfocused, non-user-expanded folder SHALL render `compactEmpty` regardless of attention state

### Requirement: Active folder derivation

The session sidebar SHALL maintain a single `activeCwd: string | null` value derived from two inputs:

1. The `cwd` of the currently selected session (`selectedId`), when a selection exists.
2. The `cwd` of the most recently focused folder header click (`lastFocusedCwd`), held in component-local state.

Selection SHALL take precedence over click. When neither input resolves to a known folder, `activeCwd` SHALL be `null`.

The derivation SHALL be exposed as a pure helper `resolveActiveCwd(selectedId, lastFocusedCwd, sessionsByCwd) → string | null` in `packages/client/src/lib/folder-focus.ts` so it is unit-testable without mounting the component tree.

#### Scenario: Selection sets active folder
- **WHEN** a session is selected and the session belongs to folder `/foo`
- **THEN** `activeCwd` SHALL equal `/foo` regardless of `lastFocusedCwd`

#### Scenario: Click sets active folder when nothing selected
- **WHEN** no session is selected and the user clicks the header body of folder `/bar`
- **THEN** `activeCwd` SHALL equal `/bar`

#### Scenario: Selection beats click
- **WHEN** a session in folder `/foo` is selected and the user clicks the header body of folder `/bar`
- **THEN** `activeCwd` SHALL remain `/foo`

#### Scenario: Stale click cleared
- **WHEN** `lastFocusedCwd` points at a folder that no longer has any rendered group (all sessions removed and not pinned)
- **THEN** `lastFocusedCwd` SHALL be cleared on the next render so `activeCwd` does not resolve to a missing folder

#### Scenario: Neither input resolves
- **WHEN** no session is selected and `lastFocusedCwd` is `null`
- **THEN** `activeCwd` SHALL be `null`

### Requirement: Header body click focuses without toggling

The folder header click handler SHALL be split into two regions:

- The chevron icon region SHALL toggle membership in `collapsedGroups` (existing collapse behavior, unchanged).
- The header body (everything outside the chevron) SHALL set `lastFocusedCwd = group.cwd` and SHALL NOT mutate `collapsedGroups`.

The chevron handler SHALL call `event.stopPropagation()` to prevent the header-body listener from also firing on the same click.

#### Scenario: Chevron click toggles collapse only
- **WHEN** the user clicks the chevron icon of folder `/foo`
- **THEN** `/foo` SHALL toggle membership in `collapsedGroups`
- **AND** `lastFocusedCwd` SHALL NOT change

#### Scenario: Header body click focuses only
- **WHEN** the user clicks the folder name text or any non-chevron, non-button area of the header for folder `/foo`
- **THEN** `lastFocusedCwd` SHALL equal `/foo`
- **AND** `collapsedGroups` membership for `/foo` SHALL NOT change

#### Scenario: Header body click on already-active folder is a no-op
- **WHEN** the user clicks the header body of a folder whose `cwd` already equals `activeCwd`
- **THEN** no observable state change SHALL occur

### Requirement: User-expanded override set

A second persisted set `userExpanded: Set<cwd>` SHALL exist alongside the existing `collapsedGroups`. Helper module `packages/client/src/lib/user-expanded-groups.ts` SHALL mirror the collapsed-group helpers in `packages/client/src/lib/session-filter-storage.ts` (`getUserExpanded`, `setUserExpanded`, `pruneStaleUserExpanded`) and SHALL store the set under localStorage key `folder.userExpanded` as a JSON array of cwd strings.

When a folder's `cwd` is in `userExpanded`, the folder SHALL render in expanded form (full session list) regardless of `activeCwd` or `collapsedGroups` state. Removing a folder from `userExpanded` SHALL be available via the chevron control.

The set SHALL be pruned of stale `cwd` entries on the same trigger as `pruneStaleCollapsedGroups`.

#### Scenario: User-expanded folder stays open when not focused
- **WHEN** folder `/foo` is in `userExpanded` and `activeCwd` is `/bar`
- **THEN** `/foo` SHALL render its full session list

#### Scenario: User-expanded wins over collapsed
- **WHEN** folder `/foo` is in both `collapsedGroups` and `userExpanded`
- **THEN** `/foo` SHALL render expanded

#### Scenario: Persistence round-trip
- **WHEN** the user adds folder `/foo` to `userExpanded` and reloads the page
- **THEN** `/foo` SHALL still be in `userExpanded` after reload

#### Scenario: Stale entry pruned
- **WHEN** session data loads and a `cwd` in `userExpanded` no longer matches any active sessions or pinned directory
- **THEN** the stale `cwd` SHALL be removed from `userExpanded` and from localStorage

### Requirement: Render-mode resolution

Each folder group SHALL be rendered in one of four modes computed by pure helper `resolveGroupRenderMode({focused, collapsed, userExpanded, hasAttention}) → "expandedFull" | "expandedToggleHidden" | "compactWithAttention" | "compactEmpty"` defined in `packages/client/src/lib/folder-focus.ts`.

The resolution table SHALL be:

| `focused` | `collapsed` | `userExpanded` | `hasAttention` | mode |
|---|---|---|---|---|
| any | any | true | any | `expandedFull` |
| true | false | false | any | `expandedFull` |
| true | true | false | any | `expandedToggleHidden` |
| false | any | false | true | `compactWithAttention` |
| false | any | false | false | `compactEmpty` |

#### Scenario: User-expanded always wins
- **WHEN** `userExpanded` is `true`
- **THEN** the mode SHALL be `expandedFull` regardless of other inputs

#### Scenario: Focused, not collapsed
- **WHEN** `focused = true`, `collapsed = false`, `userExpanded = false`
- **THEN** the mode SHALL be `expandedFull`

#### Scenario: Focused but user-collapsed
- **WHEN** `focused = true`, `collapsed = true`, `userExpanded = false`
- **THEN** the mode SHALL be `expandedToggleHidden`

#### Scenario: Unfocused with attention
- **WHEN** `focused = false`, `userExpanded = false`, `hasAttention = true`
- **THEN** the mode SHALL be `compactWithAttention`

#### Scenario: Unfocused without attention
- **WHEN** `focused = false`, `userExpanded = false`, `hasAttention = false`
- **THEN** the mode SHALL be `compactEmpty`
