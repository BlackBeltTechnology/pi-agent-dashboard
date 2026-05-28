## ADDED Requirements

### Requirement: Global display preferences SHALL gate chat-view elements

The dashboard MUST persist a `DisplayPrefs` object in `preferences.json` controlling which chat-view elements render. The schema SHALL include boolean flags for `tokenStatsBar`, `contextUsageBar`, `reasoning`, `toolResults`, `turnMetadata`, `debugTools`, plus a `toolCalls` sub-object with booleans `read`, `bash`, `edit`, `agent`, `generic`.

When a flag is `false`, the corresponding element MUST NOT render in any session view. Headers and status indicators on tool calls SHALL remain visible even when `toolResults: false` — only the result body is gated.

The `ask_user` tool SHALL render unconditionally. No preference flag controls its visibility. Both inline ask-user dialogs and ask-user tool result blocks are non-hidable.

#### Scenario: Reasoning toggle hides ThinkingBlock
- **GIVEN** global `displayPrefs.reasoning = false`
- **WHEN** the chat view renders a turn containing reasoning content
- **THEN** no `ThinkingBlock` component mounts for that turn

#### Scenario: Tool-result toggle preserves headers
- **GIVEN** global `displayPrefs.toolResults = false`
- **WHEN** a turn contains a `Bash` tool call with a result body
- **THEN** the `ToolCallStep` renders with name + status visible but the result body section is omitted

#### Scenario: ask_user is non-hidable
- **GIVEN** global `displayPrefs.toolCalls.generic = false` and `toolResults = false`
- **WHEN** the assistant invokes the `ask_user` tool
- **THEN** the ask-user UI renders in full regardless of preferences

#### Scenario: Tool-type granularity
- **GIVEN** global `displayPrefs.toolCalls.read = false` and `bash = true`
- **WHEN** a turn contains one `Read` call and one `Bash` call
- **THEN** only the `Bash` call renders; the `Read` call is omitted

### Requirement: Per-session overrides SHALL deep-merge over global prefs

Each session's `.meta.json` MAY contain a `displayPrefsOverride: Partial<DisplayPrefs>` field. The effective prefs for a session SHALL be computed as a shallow merge of global over override for top-level keys, and a shallow merge for the nested `toolCalls` sub-object.

Clearing an override (setting it to `null` via the WS message) SHALL remove the field from `.meta.json` entirely so the session falls back to pure global prefs.

#### Scenario: Sparse override inherits unset fields
- **GIVEN** global `displayPrefs.reasoning = true`, `tokenStatsBar = true`
- **AND** session override `{ reasoning: false }`
- **WHEN** the effective prefs are computed for that session
- **THEN** the result has `reasoning: false` and `tokenStatsBar: true`

#### Scenario: toolCalls deep-merges
- **GIVEN** global `toolCalls = { read:true, bash:true, edit:true, agent:true, generic:true }`
- **AND** session override `{ toolCalls: { bash: false } }`
- **WHEN** the effective prefs are computed
- **THEN** the result has `toolCalls.bash = false` and every other `toolCalls.*` field equals the global value

#### Scenario: Clearing an override restores global behavior
- **GIVEN** a session with `displayPrefsOverride = { reasoning: false }` while global `reasoning = true`
- **WHEN** the client sends `setSessionDisplayPrefs { sessionId, override: null }`
- **THEN** the server removes the field from `.meta.json` and the session renders reasoning blocks again

### Requirement: Display prefs SHALL be controllable via REST and broadcast over WS

The server SHALL expose:

- `GET /api/preferences/display` returning the current `DisplayPrefs` or HTTP 200 with `displayPrefs: undefined` when never seeded.
- `PATCH /api/preferences/display` accepting `Partial<DisplayPrefs>` and deep-merging into the stored prefs (toolCalls merged field-by-field).

On any successful PATCH, the server MUST broadcast `display_prefs_updated { prefs: DisplayPrefs }` to every connected browser socket. Connected clients MUST update their local store on receipt without page reload.

A browser-to-server WS message `setSessionDisplayPrefs { sessionId, override }` SHALL update the per-session override. `override: null` clears it.

#### Scenario: PATCH broadcasts to other tabs
- **GIVEN** two browser tabs A and B connected to the same server
- **WHEN** tab A PATCHes `{ debugTools: true }`
- **THEN** tab B receives `display_prefs_updated` and its store reflects `debugTools: true` without reload

#### Scenario: PATCH deep-merges toolCalls
- **GIVEN** stored `toolCalls = { read:true, bash:true, edit:true, agent:true, generic:true }`
- **WHEN** a PATCH body of `{ toolCalls: { bash: false } }` is applied
- **THEN** stored `toolCalls.bash = false` and every other `toolCalls.*` field is unchanged

### Requirement: First-launch SHALL prompt the user to choose a preset

When the client receives a `GET /api/preferences/display` response indicating prefs have never been seeded (`displayPrefs === undefined`), it MUST display a one-shot modal offering three presets: `simple`, `standard`, `everything`.

On submit, the client SHALL PATCH the chosen preset. On dismiss (Esc or backdrop), the client SHALL PATCH the `standard` preset. Either action MUST cause the server's stored prefs to become defined so the modal does not re-open.

#### Scenario: Undefined prefs trigger modal
- **GIVEN** a fresh install with no `displayPrefs` in `preferences.json`
- **WHEN** the client loads and fetches `/api/preferences/display`
- **THEN** the first-launch modal mounts

#### Scenario: Dismiss defaults to standard
- **GIVEN** the first-launch modal is open
- **WHEN** the user presses Esc
- **THEN** the client PATCHes `DISPLAY_PRESETS.standard` and the modal closes permanently

#### Scenario: Already-seeded prefs suppress modal
- **GIVEN** `preferences.json` already contains a `displayPrefs` object
- **WHEN** the client loads
- **THEN** the first-launch modal does NOT mount

### Requirement: Legacy localStorage debug toggle SHALL migrate once

On first client hydration after upgrade, if `localStorage["show-debug-tools"]` exists, the client MUST PATCH `{ debugTools: <localStorage value as boolean> }` and remove the localStorage key. The migration MUST be idempotent — after the key is absent, no further action.

#### Scenario: Legacy true value migrates
- **GIVEN** `localStorage["show-debug-tools"] === "true"` and `displayPrefs.debugTools === false`
- **WHEN** the client hydrates
- **THEN** the client PATCHes `{ debugTools: true }`, removes the localStorage key, and subsequent loads do not re-PATCH
