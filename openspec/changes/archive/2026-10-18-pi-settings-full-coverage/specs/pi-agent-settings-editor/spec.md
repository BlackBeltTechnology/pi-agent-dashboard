## MODIFIED Requirements

### Requirement: Typed patch of curated pi settings
The dashboard SHALL accept a typed PATCH limited to the following keys and types (dotted names address a leaf inside a block):

- Booleans: `hideThinkingBlock`, `showCacheMissNotices`, `compaction.enabled`, `branchSummary.skipPrompt`, `showHardwareCursor`, `terminal.showImages`, `terminal.clearOnShrink`, `terminal.showTerminalProgress`, `images.autoResize`, `images.blockImages`, `enableSkillCommands`, `collapseChangelog`, `enableInstallTelemetry`, `enableAnalytics`, `warnings.anthropicExtraUsage`.
- Enumerations: `cacheWarming` (`"off"` | `"streaming"` | `"idle"`); `steeringMode`, `followUpMode` (`"all"` | `"one-at-a-time"`); `doubleEscapeAction` (`"tree"` | `"fork"` | `"none"`); `treeFilterMode` (`"default"` | `"no-tools"` | `"user-only"` | `"labeled-only"` | `"all"`); `defaultProjectTrust` (`"ask"` | `"always"` | `"never"`); `codemode.mode` (`"on"` | `"only"`); `markdown.mermaid` (`"off"` | `"final"` | `"streaming"`); `transport` (`"auto"` | `"sse"` | `"websocket"` | `"websocket-cached"`).
- Mixed values: `quietStartup` (`true` | `false` | `"header"`); `terminal.hyperlinks`, `terminal.trueColor` (`true` | `false` | `"auto"`); `terminal.images` (`"kitty"` | `"iterm2"` | `"auto"` | `false`).
- Non-negative integers: `compaction.reserveTokens`, `compaction.keepRecentTokens`, `branchSummary.reserveTokens`, `codemode.inlineBudget`, `httpIdleTimeoutMs`, `websocketConnectTimeoutMs`, `thinkingBudgets.minimal`, `thinkingBudgets.low`, `thinkingBudgets.medium`, `thinkingBudgets.high`.
- Bounded integers: `terminal.imageWidthCells` (≥ 1), `editorPaddingX` (0 to 3), `autocompleteMaxVisible` (3 to 20).
- Strings: `externalEditor`, `sessionDir`, `shellPath`, `shellCommandPrefix`, `httpProxy`, `markdown.codeBlockIndent`, and `theme` (non-empty).
- `enabledModels`: an array of non-empty strings.

The default-model keys (`defaultProvider`, `defaultModel`, `defaultThinkingLevel`) are not in this set and stay rejected as today. The patch SHALL address leaf keys only (`enabledModels` is replaced whole): only provided leaves SHALL change, a `null` leaf SHALL delete that key, and a whole block (`compaction`, `branchSummary`, `codemode`, `terminal`, `images`, `markdown`, `warnings`, `thinkingBudgets`) SHALL NOT be set to `null`. Every other key in the file, including unknown keys inside those blocks, SHALL survive unchanged. Any other key in the patch, or a value of the wrong type or outside its range, SHALL reject the whole patch with `400` and per-field errors, writing nothing. For a key outside the set, the error SHALL point to the raw JSON editor. When the current file is unparseable, the patch SHALL be rejected with `400` and a `parseError`, writing nothing.

#### Scenario: Patch changes only the provided key
- **GIVEN** the file contains `packages`, `retry`, and `compaction: { enabled: true, futureKnob: 1 }`
- **WHEN** a client patches `compaction.reserveTokens = 20000`
- **THEN** the file SHALL contain `compaction: { enabled: true, futureKnob: 1, reserveTokens: 20000 }`
- **AND** `packages` and `retry` SHALL be deep-equal to their prior values

#### Scenario: Null deletes a key
- **GIVEN** the file contains `steeringMode: "all"`
- **WHEN** a client patches `steeringMode = null`
- **THEN** the file SHALL NOT contain `steeringMode`

#### Scenario: Wrong type rejects the whole patch
- **WHEN** a client patches `{ steeringMode: "all", compaction: { reserveTokens: -1 } }`
- **THEN** the response SHALL be `400` naming `compaction.reserveTokens`
- **AND** the file SHALL be byte-identical to before

#### Scenario: Out-of-range bounded integer is rejected
- **WHEN** a client patches `autocompleteMaxVisible = 25`
- **THEN** the response SHALL be `400` naming `autocompleteMaxVisible` and its 3 to 20 range
- **AND** nothing SHALL be written

#### Scenario: Newly typed scalar key is accepted
- **WHEN** a client patches `{ shellPath: "/bin/zsh", terminal: { images: false } }`
- **THEN** the file SHALL contain `shellPath: "/bin/zsh"` and `terminal.images: false`

#### Scenario: enabledModels is replaced whole
- **GIVEN** the file contains `enabledModels: ["anthropic/*", "openai/*"]`
- **WHEN** a client patches `enabledModels = ["anthropic/*", "opencode-go/muse-spark-1.3-contributor"]`
- **THEN** the file SHALL contain exactly that array

#### Scenario: Non-typed pi key is rejected with a pointer to JSON mode
- **WHEN** a client patches `{ defaultTools: ["read"] }` or `{ tuiMode: "regular" }`
- **THEN** the response SHALL be `400` naming the key and referring to the raw JSON editor
- **AND** nothing SHALL be written

#### Scenario: Patch over an unparseable file is refused
- **GIVEN** the file contains truncated JSON
- **WHEN** a client patches `steeringMode = "all"` with the matching token
- **THEN** the response SHALL be `400` with a `parseError`
- **AND** the file SHALL be byte-identical to before

### Requirement: Raw replacement of the whole file
The dashboard SHALL accept the full file text as a raw replacement. A body larger than 256 KiB SHALL be rejected with `413`. Before any write it SHALL verify:

- the text is valid JSON (a leading BOM is ignored) and the root is a plain object;
- `compaction.enabled`, `branchSummary.skipPrompt` and `hideThinkingBlock`, when present, are booleans;
- `compaction.reserveTokens`, `compaction.keepRecentTokens` and `branchSummary.reserveTokens`, when present, are non-negative integers;
- `steeringMode`, `followUpMode`, `defaultProjectTrust` and `quietStartup`, when present, hold one of their typed-patch values;
- `retry` and `retry.provider`, when present, are plain objects (not arrays) whose present fields obey the retry editor's rules: `enabled` is a boolean; `maxRetries`, `maxAgentDelayMs`, `provider.maxRetries` and `provider.maxRetryDelayMs` are non-negative integers; `baseDelayMs` and `provider.timeoutMs` are positive integers. Absent and unknown `retry` fields are accepted;
- `extensions`, `prompts`, `themes`, `enabledModels`, `defaultTools` and `npmCommand` are arrays of strings;
- `skills` is an array of strings or the legacy object form pi still accepts;
- `packages` is an array of strings or objects;
- `shellPath` and `shellCommandPrefix` are strings;
- `modelThinkingLevels` is an object whose values are valid thinking levels.

Keys not listed here SHALL NOT be type-checked and SHALL pass. The typed-patch keys added by this change are NOT checked in raw mode, so a value written by a newer pi never blocks a raw save. A failure SHALL return `400` with per-field errors and write nothing. A success SHALL write the object as 2-space-indented JSON with a trailing newline. An unparseable current file SHALL NOT block a raw replacement carrying the matching token.

#### Scenario: Unknown keys are accepted and persisted
- **WHEN** a client submits raw text `{ "someFutureKey": { "a": 1 } }` with a fresh token
- **THEN** the write SHALL succeed and the file SHALL contain `someFutureKey`

#### Scenario: Newer pi enum value passes raw mode
- **WHEN** a client submits raw text `{ "transport": "quic" }` with a fresh token
- **THEN** the write SHALL succeed

#### Scenario: Partial retry block is accepted
- **WHEN** a client submits raw text `{ "retry": { "enabled": true, "maxAgentDelayMs": 5000 } }` with a fresh token
- **THEN** the write SHALL succeed

#### Scenario: Raw retry values obey the retry editor's rules
- **WHEN** a client submits raw text `{ "retry": { "baseDelayMs": 0 } }`, `{ "retry": 5 }`, or `{ "retry": { "provider": [] } }`
- **THEN** the response SHALL be `400` naming the `retry` field
- **AND** nothing SHALL be written

#### Scenario: Legacy skills object is accepted
- **WHEN** a client submits raw text `{ "skills": { "customDirectories": ["~/s"] } }` with a fresh token
- **THEN** the write SHALL succeed

#### Scenario: Invalid JSON is rejected
- **WHEN** a client submits raw text `{ "a": 1,, }`
- **THEN** the response SHALL be `400`
- **AND** the file SHALL be byte-identical to before

#### Scenario: Non-object root is rejected
- **WHEN** a client submits raw text `[1, 2]`
- **THEN** the response SHALL be `400` and nothing SHALL be written

#### Scenario: Wrong-typed command key is rejected
- **WHEN** a client submits raw text `{ "npmCommand": "curl x | sh" }`
- **THEN** the response SHALL be `400` naming `npmCommand`
- **AND** nothing SHALL be written

#### Scenario: Wrong array element type is rejected
- **WHEN** a client submits raw text `{ "enabledModels": [123] }`
- **THEN** the response SHALL be `400` naming `enabledModels`

#### Scenario: Oversize body is rejected
- **WHEN** a client submits raw text larger than 256 KiB
- **THEN** the response SHALL be `413` in the same error envelope as the other rejections
- **AND** nothing SHALL be written and no session SHALL be reloaded

#### Scenario: Raw replacement repairs an unparseable file
- **GIVEN** the file contains truncated JSON and the client holds its token
- **WHEN** the client submits valid raw text with that token
- **THEN** the write SHALL succeed and the file SHALL parse

## REMOVED Requirements

### Requirement: pi settings section on Settings → Sessions
**Reason**: The editor outgrows a section once it covers every pi key. It moves to its own Settings page.
**Migration**: Use Settings → pi → pi settings. The page keeps every behaviour of the removed section (see "pi settings page").

## ADDED Requirements

### Requirement: pi settings page
The settings rail SHALL show a `pi settings` entry that opens a page editing pi's global settings file. The Sessions page SHALL no longer render a pi settings section. The page SHALL offer a Form mode and a JSON mode (full-file editor). Edits SHALL commit through the panel's unified Save, mark the page dirty, and participate in the unsaved-changes guard; the page SHALL NOT render its own Save button. The page SHALL hold a draft for one mode at a time: switching mode with a dirty draft SHALL ask the user to discard or stay, and SHALL never convert a dirty draft between modes. A `409` SHALL show a conflict notice offering to reload from disk, which discards the draft, and SHALL NOT retry automatically. A `400` SHALL show the per-field errors and keep the draft dirty. A `413` or `503` SHALL be shown like any failed commit, keeping the draft dirty. In JSON mode, a draft that changes a default-model key SHALL show a notice before saving that those keys are managed by the Default model control. The page SHALL state that saving reloads running sessions, and that it edits the global file only while a project `<cwd>/.pi/settings.json` may override these values at runtime.

#### Scenario: Page replaces the Sessions section
- **WHEN** the user opens Settings
- **THEN** the rail SHALL contain a `pi settings` entry
- **AND** the Sessions page SHALL NOT contain a pi settings section

#### Scenario: Form edit commits through unified Save
- **WHEN** the user changes Steering mode in Form mode and presses the panel Save
- **THEN** the typed patch SHALL be sent and, on success, the page SHALL no longer be dirty

#### Scenario: Conflict offers reload, never silent overwrite
- **GIVEN** a save returns `409`
- **THEN** the page SHALL show a conflict notice with a "Reload from disk" action
- **AND** SHALL NOT retry the write automatically

#### Scenario: Validation errors keep the draft
- **GIVEN** the user enters invalid JSON in JSON mode
- **WHEN** the user presses Save
- **THEN** the page SHALL show the error and remain dirty

#### Scenario: Switching mode with a dirty draft asks first
- **GIVEN** the Form mode draft is dirty
- **WHEN** the user selects JSON mode
- **THEN** the page SHALL ask to discard or stay
- **AND** choosing stay SHALL keep Form mode with the draft intact
- **AND** choosing discard SHALL show JSON mode with the last-loaded content

#### Scenario: Editing a managed key in JSON mode is flagged before save
- **GIVEN** the user changes `defaultModel` in the JSON draft
- **THEN** the page SHALL show a notice that the key is managed by the Default model control and will not be written

### Requirement: Form rows for every typed key
Form mode SHALL render one row per typed-patch key, grouped into the categories Model and thinking, Interaction, Tools, Sessions and context, Terminal and display, Network, Shell, Resources, and Updates and privacy. Each row SHALL show a label, the raw dotted key, a control, and a hint. The control SHALL offer an explicit "default" choice that leaves the key unset and SHALL display pi's documented default value. Boolean keys and enumerations with at most three values SHALL use a segmented control; longer enumerations SHALL use a select. A stored value outside the known options SHALL be shown as an extra, selected option in either control, and SHALL NOT be changed unless the user changes it. A key that is set SHALL show a "Changed" marker that carries text, not only colour, and a reset action that returns it to unset. An integer outside its range SHALL show an inline error tied to the control as soon as it is entered. A Save attempted while any field error remains SHALL fail with those errors, write nothing, and keep the draft dirty. Keys with their own editor elsewhere SHALL render as link rows instead of editable controls: the default-model keys (read-only values plus a link to the Default model control), `retry.*` (link to the Retry editor), `packages` (link to Add-ons), and `extensions` and `skills` (link to Skills). The object- or array-valued keys `modelThinkingLevels`, `compaction.modelOverrides`, `defaultTools`, `npmCommand`, `prompts` and `themes`, and the TUI-only keys `tuiMode`, `fullscreenExitOutput`, `fullscreenScrollbar`, `fullscreenCopyOnSelect`, `fullscreenWheelScrollLines` and `outputPad` (documented no-ops with no dashboard surface), SHALL render as rows whose action switches to JSON mode and that offer no editable control. The keys `dashboardPluginBridges`, `_dashboardManagedPackages` and `lastChangelogVersion` SHALL render as a collapsed, read-only list.

#### Scenario: Unset key shows pi's default
- **GIVEN** the file does not contain `compaction.reserveTokens`
- **WHEN** Form mode renders
- **THEN** the row SHALL show pi's default `16384` and SHALL NOT show the Changed marker

#### Scenario: Reset returns a key to unset
- **GIVEN** the file contains `theme: "dark"`
- **WHEN** the user activates the Terminal theme reset action and saves
- **THEN** the typed patch SHALL send `theme = null`

#### Scenario: Unknown stored enum value is preserved
- **GIVEN** the file contains `transport: "quic"`
- **WHEN** Form mode renders and the user saves after editing an unrelated key
- **THEN** the transport row SHALL show `quic` as selected
- **AND** the patch SHALL NOT contain `transport`

#### Scenario: Range error blocks Save
- **WHEN** the user enters `25` for Autocomplete entries
- **THEN** the row SHALL show an error naming the 3 to 20 range
- **AND** pressing the panel Save SHALL send no request and keep the page dirty

#### Scenario: Retry is a link, not a second editor
- **WHEN** Form mode renders the Network category
- **THEN** it SHALL show a Retry row linking to the Retry editor and SHALL NOT render retry inputs

### Requirement: Filtering the settings page
Form mode SHALL provide a text filter that matches a row's label, dotted key, or hint case-insensitively, a "Set or changed only" toggle that shows only keys set in the file or changed in the draft, and a jump link per visible category. Categories with no matching rows SHALL be hidden, each category heading SHALL show its matching and total row counts while a filter is active, and no match SHALL show a message naming the query.

#### Scenario: Filter by key
- **WHEN** the user types `terminal.images` in the filter
- **THEN** only the Image protocol row SHALL be visible, under Terminal and display

#### Scenario: Changed-only toggle
- **GIVEN** the file contains only `theme` and `enabledModels` among the typed keys
- **WHEN** the user enables the changed-only toggle
- **THEN** only the Terminal theme and Model cycling scope rows SHALL be visible

#### Scenario: No match
- **WHEN** the user types `zzz`
- **THEN** every category SHALL be hidden and a message SHALL name `zzz`

### Requirement: Model cycling scope editor
The `enabledModels` row SHALL offer a choice between "All models", which leaves the key unset, and "Selected only". In "Selected only" it SHALL list every provider of the model catalogue, including providers without credentials, with a provider-level toggle and per-model toggles, plus free-text glob patterns. Selecting a whole provider SHALL save `<provider>/*`, or explicit picks of all its catalogue models when any of its model ids contains `/` (which `*` does not match); a single model SHALL save `<provider>/<modelId>`; a pattern SHALL be saved verbatim. A model covered by a pattern SHALL show as selected and not individually toggleable. Deselecting one model of a whole-selected provider SHALL replace `<provider>/*` with explicit picks of that provider's other catalogue models. The editor SHALL show how many catalogue models are in scope, SHALL preview the array that will be saved, SHALL state that the setting does not restrict roles or subagents, and SHALL note that pi adds the current default model to the list when it is missing. If the model catalogue cannot be loaded, the editor SHALL show a notice, offer no toggles, and leave `enabledModels` out of every patch. Loading an existing `enabledModels` SHALL map `<provider>/*` entries to provider toggles, `<provider>/<modelId>` entries whose full id exists in the catalogue, or that exist after removing a trailing `:<thinking level>` suffix (which is kept on save), to model toggles, and every other entry to a pattern, so a load-then-save without user edits writes the same set of entries. "Selected only" with no provider, model or pattern selected SHALL NOT be saved, because pi treats an empty list as all models: Save SHALL fail with an error asking for at least one selection. A stored empty array loads as "All models", and nothing is sent for it unless the user changes the scope.

#### Scenario: Provider toggle saves a provider glob
- **GIVEN** "Selected only" is chosen and nothing is selected
- **WHEN** the user toggles provider `anthropic` on and saves
- **THEN** the patch SHALL set `enabledModels` to `["anthropic/*"]`

#### Scenario: Single model pick
- **WHEN** the user toggles only `opencode-go/muse-spark-1.3-contributor` and saves
- **THEN** the patch SHALL set `enabledModels` to `["opencode-go/muse-spark-1.3-contributor"]`

#### Scenario: Round trip preserves unknown entries
- **GIVEN** the file contains `enabledModels: ["openrouter/*", "*sonnet*", "anthropic/claude-opus-5-5"]`
- **WHEN** the page loads and the user saves after editing an unrelated key
- **THEN** the patch SHALL NOT contain `enabledModels`
- **AND** the editor SHALL show `openrouter/*` and `*sonnet*` as patterns and `claude-opus-5-5` as a selected model

#### Scenario: Empty selection cannot be saved
- **GIVEN** "Selected only" is chosen and every selection is cleared
- **WHEN** the user presses Save
- **THEN** no request SHALL be sent and the editor SHALL show an error asking for at least one selection

#### Scenario: Thinking-level suffix round-trips
- **GIVEN** the file contains `enabledModels: ["anthropic/claude-opus-5-5:high"]`
- **WHEN** the page loads
- **THEN** `claude-opus-5-5` SHALL show as selected
- **AND** saving after an unrelated edit SHALL NOT change `enabledModels`

#### Scenario: Deselecting one model of a whole provider
- **GIVEN** the file contains `enabledModels: ["deepseek/*"]` and the catalogue lists `deepseek/deepseek-flash` and `deepseek/deepseek-v4-pro`
- **WHEN** the user deselects `deepseek-flash` and saves
- **THEN** the patch SHALL set `enabledModels` to `["deepseek/deepseek-v4-pro"]`

#### Scenario: Catalogue unavailable
- **GIVEN** the model catalogue request fails
- **WHEN** the user saves after editing an unrelated key
- **THEN** the patch SHALL NOT contain `enabledModels`

#### Scenario: All models clears the key
- **GIVEN** the file contains `enabledModels`
- **WHEN** the user chooses "All models" and saves
- **THEN** the patch SHALL send `enabledModels = null`

### Requirement: Available pi themes are listed
The settings read response SHALL include the theme names pi can resolve: the built-in `system`, `dark` and `light`, plus the themes pi resolves from its global theme paths and installed packages. A theme's name is the `name` declared in its file, falling back to the file name without extension when the file declares none. The Terminal theme control SHALL offer those names and SHALL also accept a typed custom value, including pi's `light/dark` pair form. A stored value that is not in the list SHALL be shown as selected. If theme discovery fails, the read SHALL still succeed with the built-in names only.

#### Scenario: Package theme is offered
- **GIVEN** an installed pi package contributes a theme named `nord`
- **WHEN** the page loads
- **THEN** the Terminal theme control SHALL offer `nord`

#### Scenario: Unknown stored theme stays selected
- **GIVEN** the file contains `theme: "my-theme"` and no resolved theme has that name
- **WHEN** the page loads
- **THEN** the control SHALL show `my-theme` as selected
