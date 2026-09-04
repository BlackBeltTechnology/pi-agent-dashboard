## RENAMED Requirements

- FROM: `### Requirement: reasoningInlineFlow and customEntryFallback display preferences`
- TO: `### Requirement: reasoningInlineFlow and customEventGroups display preferences`

## MODIFIED Requirements

### Requirement: Global display preferences SHALL gate chat-view elements
The dashboard MUST persist a `DisplayPrefs` object in `preferences.json` controlling which chat-view elements render. The schema SHALL include boolean flags for `tokenStatsBar`, `contextUsageBar`, `reasoning`, `toolResults`, `turnMetadata`, `debugTools`, plus a `toolCalls` sub-object with booleans `read`, `bash`, `edit`, `agent`, `generic`, plus a `customEventGroups` sub-object mapping custom event group ids to booleans. The schema SHALL also include a numeric `reasoningAutoCollapseMs` controlling how long a live-streamed reasoning block stays expanded after it completes before auto-collapsing.

`reasoningAutoCollapseMs` SHALL default to `30000` (30 seconds). A value of `0` SHALL mean "never auto-collapse" — a live-streamed reasoning block stays expanded until the user collapses it. The value SHALL only affect live-streamed reasoning blocks; replayed blocks are unaffected.

`customEventGroups` SHALL be an open keyspace keyed by the group ids defined in the custom event groups configuration. A group id absent from the object SHALL resolve to that group's configured `default` visibility, so a preferences file that predates a group never hides it implicitly.

#### Scenario: Reasoning hidden when disabled
- **GIVEN** global `displayPrefs.reasoning = false`
- **WHEN** the chat view renders a turn containing reasoning content
- **THEN** no reasoning block SHALL render
- **AND** `reasoningAutoCollapseMs` SHALL have no effect

#### Scenario: Default auto-collapse delay
- **GIVEN** a `DisplayPrefs` object with no explicit `reasoningAutoCollapseMs`
- **WHEN** it is loaded or merged from a preset
- **THEN** the effective value SHALL be `30000`

#### Scenario: Legacy preferences file is backfilled
- **GIVEN** a persisted `preferences.json` whose `displayPrefs` predates the field and has no `reasoningAutoCollapseMs`
- **WHEN** the preferences store loads it
- **THEN** `reasoningAutoCollapseMs` SHALL be set to `30000` before it reaches any client
- **AND** the client SHALL never observe `reasoningAutoCollapseMs` as `undefined`

#### Scenario: Partial PATCH preserves the field
- **GIVEN** a stored `reasoningAutoCollapseMs` value
- **WHEN** a `PATCH /api/preferences/display` updates a different display field and omits `reasoningAutoCollapseMs`
- **THEN** the stored and broadcast `reasoningAutoCollapseMs` SHALL retain its prior value
- **AND** SHALL NOT be reset to `undefined`

#### Scenario: Unknown group id falls back to its configured default
- **GIVEN** a stored `customEventGroups` object that has no key for a configured group
- **WHEN** effective visibility for that group is computed
- **THEN** the group's configured `default` SHALL be used
- **AND** the group SHALL NOT be treated as hidden merely because the key is absent

### Requirement: Display prefs SHALL be controllable via REST and broadcast over WS

The server SHALL expose:

- `GET /api/preferences/display` returning the current `DisplayPrefs` or HTTP 200 with `displayPrefs: undefined` when never seeded.
- `PATCH /api/preferences/display` accepting `Partial<DisplayPrefs>` and deep-merging into the stored prefs (`toolCalls` and `customEventGroups` merged field-by-field).

On any successful PATCH, the server MUST broadcast `display_prefs_updated { prefs: DisplayPrefs }` to every connected browser socket. Connected clients MUST update their local store on receipt without page reload.

The server MUST ALSO send a `display_prefs_updated { prefs }` snapshot to each browser socket on connect (within the `wss.on("connection")` handshake, alongside the `pinned_dirs_updated` / `favorite_models_updated` / `workspaces_updated` snapshots), **only when the stored prefs are defined**. This gives display-prefs the same reconnect self-healing as every sibling preference: a client that missed a live broadcast (socket not `OPEN` at broadcast time — the broadcast fan-out skips non-`OPEN` sockets and never replays) recovers the current prefs on its next connect without a full page reload. When prefs are undefined (seedless install), the server MUST NOT send the connect snapshot, so a genuine first launch still opens the first-launch modal exactly once.

A browser-to-server WS message `setSessionDisplayPrefs { sessionId, override }` SHALL update the per-session override. `override: null` clears it.

The server SHALL broadcast `session_updated` with `updates.displayPrefsOverride: null` (not `undefined`) so the field survives JSON serialization. The client's `getSessionOverride` SHALL normalize `null` to `undefined` before returning to consumers, so a cleared session merges as pure global prefs and its "modified" indicator turns off without a page reload.

#### Scenario: PATCH broadcasts to other tabs
- **GIVEN** two browser tabs A and B connected to the same server
- **WHEN** tab A PATCHes `{ debugTools: true }`
- **THEN** tab B receives `display_prefs_updated` and its store reflects `debugTools: true` without reload

#### Scenario: Connect snapshot re-delivers seeded prefs on reconnect
- **GIVEN** stored prefs are defined AND a browser missed a `display_prefs_updated` broadcast because its socket was not `OPEN`
- **WHEN** the browser reconnects and completes the WS handshake
- **THEN** the server SHALL send `display_prefs_updated { prefs }` as part of the connect snapshot
- **AND** the client's local store SHALL reflect the current prefs without a page reload

#### Scenario: Seedless install sends no connect snapshot
- **GIVEN** the stored prefs are `undefined` (fresh install, never seeded)
- **WHEN** a browser connects and completes the WS handshake
- **THEN** the server SHALL NOT send a `display_prefs_updated` snapshot
- **AND** the client's mount `GET /api/preferences/display` SHALL return `undefined` and open the first-launch modal exactly once

#### Scenario: Clearing override broadcasts null, not empty
- **GIVEN** a session with an active override
- **WHEN** a browser sends `setSessionDisplayPrefs { sessionId, override: null }`
- **THEN** the broadcast `session_updated` carries `updates.displayPrefsOverride: null`
- **AND** `JSON.stringify` does not drop the field
- **AND** all connected browsers apply the clear

#### Scenario: Client normalizes cleared override to undefined
- **GIVEN** a session whose in-memory record carries `displayPrefsOverride: null` after applying a clearing `session_updated` broadcast
- **WHEN** a consumer reads the override via `getSessionOverride(sessionId)`
- **THEN** the returned value SHALL be `undefined`, not `null`
- **AND** `useDisplayPrefs` SHALL merge to pure global prefs (no override applied)
- **AND** the `ChatViewMenu` "modified" pill SHALL NOT render for that session

#### Scenario: PATCH deep-merges toolCalls
- **GIVEN** stored `toolCalls = { read:true, bash:true, edit:true, agent:true, generic:true }`
- **WHEN** a PATCH body of `{ toolCalls: { bash: false } }` is applied
- **THEN** stored `toolCalls.bash = false` and every other `toolCalls.*` field is unchanged

#### Scenario: PATCH deep-merges customEventGroups
- **GIVEN** stored `customEventGroups = { memory:false, search:true, subagents:true }`
- **WHEN** a PATCH body of `{ customEventGroups: { search: false } }` is applied
- **THEN** stored `customEventGroups.search = false` and every other `customEventGroups.*` field is unchanged
- **AND** the merge SHALL NOT drop keys for groups absent from the PATCH body

### Requirement: reasoningInlineFlow and customEventGroups display preferences
`DisplayPrefs` SHALL include `reasoningInlineFlow: boolean` and `customEventGroups: Record<string, boolean>`. `reasoningInlineFlow` SHALL default to `false` in every preset (`simple`, `standard`, `everything`) and in the legacy-backfill path. `customEventGroups` SHALL default to an object seeding each configured group id with that group's configured `default` visibility, so out-of-the-box behavior matches the shipped configuration.

The `customEntryFallback` boolean is REMOVED from `DisplayPrefs`; the catch-all `other` group entry in `customEventGroups` replaces it.

The legacy defaults SHALL be injected at every `DisplayPrefs` construction site for persisted prefs — the server's per-field backfill (`backfillDisplayPrefs`) and the `setDisplayPrefs` base/merged literals — not only in `mergeDisplayPrefs`, because a legacy file without the fields must resolve to the defaults (a missing `customEventGroups` backfill would leave every group gate `undefined` and hide custom rows for existing users). `mergeDisplayPrefs` SHALL resolve `reasoningInlineFlow` as a plain top-level arm (override value when present, else global), and SHALL resolve `customEventGroups` by shallow field-by-field merge, exactly as it resolves `toolCalls` — an override key present wins for that group id only, and every group id absent from the override falls through to the global value. Existing persisted preferences files and per-session overrides without the new fields SHALL load unchanged and resolve to the defaults.

#### Scenario: Defaults preserve current behavior
- **WHEN** a preferences file predates the new fields (or a fresh preset is applied)
- **THEN** the effective prefs SHALL resolve `reasoningInlineFlow` to `false`
- **AND** `customEventGroups` SHALL resolve each configured group to its configured `default`
- **AND** a legacy global file without the fields SHALL resolve them via the server backfill (not stay `undefined`)

#### Scenario: Per-session override wins
- **WHEN** a per-session override sets `reasoningInlineFlow`
- **THEN** `mergeDisplayPrefs` SHALL return the override value for that field and the global value for every other field

#### Scenario: Per-session override merges customEventGroups field-by-field
- **GIVEN** global `customEventGroups = { memory:false, search:true }`
- **AND** a per-session override `{ customEventGroups: { memory: true } }`
- **WHEN** effective prefs are computed
- **THEN** the result SHALL have `customEventGroups.memory = true` and `customEventGroups.search = true`
- **AND** the override SHALL NOT replace the whole object

#### Scenario: PATCH round-trips the new fields
- **WHEN** a client PATCHes `/api/preferences/display` with the new fields (globally or as a per-session override)
- **THEN** the fields SHALL persist, broadcast via `display_prefs_updated`, and be included in the connect snapshot

## ADDED Requirements

### Requirement: customEntryFallback SHALL migrate once to the other group
On upgrade, any persisted `customEntryFallback` value SHALL be migrated to `customEventGroups.other` and the legacy
field removed, so a user who had already hidden custom chat entries does not have them reappear. The migration SHALL be
applied to the global `DisplayPrefs` and to every per-session `displayPrefsOverride` that carries the legacy field. The
migration SHALL be idempotent — once the legacy field is absent, no further action.

#### Scenario: Hidden custom entries stay hidden across upgrade
- **GIVEN** a persisted global `displayPrefs.customEntryFallback === false`
- **WHEN** the preferences store loads after upgrade
- **THEN** `customEventGroups.other` SHALL be `false`
- **AND** `customEntryFallback` SHALL no longer be present in the stored prefs

#### Scenario: Per-session override carrying the legacy field migrates too
- **GIVEN** a session whose `displayPrefsOverride` contains `customEntryFallback: false`
- **WHEN** the migration runs
- **THEN** that override SHALL carry `customEventGroups: { other: false }`
- **AND** SHALL no longer carry `customEntryFallback`

#### Scenario: Default-valued legacy field does not force an explicit key
- **GIVEN** a persisted `customEntryFallback === true` (the legacy default)
- **WHEN** the migration runs
- **THEN** the resulting effective visibility of the `other` group SHALL be visible
- **AND** the legacy field SHALL be removed

#### Scenario: Migration is idempotent
- **GIVEN** preferences that have already been migrated
- **WHEN** the preferences store loads again
- **THEN** no further migration SHALL occur
- **AND** an explicit user choice for `customEventGroups.other` SHALL NOT be overwritten
