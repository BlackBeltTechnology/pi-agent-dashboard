## MODIFIED Requirements

### Requirement: Typed patch of curated pi settings
The dashboard SHALL accept a typed PATCH limited to the following keys and types (dotted names address a leaf inside a block):

- Booleans: `hideThinkingBlock`, `showCacheMissNotices`, `compaction.enabled`, `branchSummary.skipPrompt`, `showHardwareCursor`, `terminal.showImages`, `terminal.clearOnShrink`, `terminal.showTerminalProgress`, `images.autoResize`, `images.blockImages`, `enableSkillCommands`, `collapseChangelog`, `enableInstallTelemetry`, `enableAnalytics`, `warnings.anthropicExtraUsage`.
- Enumerations: `cacheWarming` (`"off"` | `"streaming"` | `"idle"`); `steeringMode`, `followUpMode` (`"all"` | `"one-at-a-time"`); `doubleEscapeAction` (`"tree"` | `"fork"` | `"none"`); `treeFilterMode` (`"default"` | `"no-tools"` | `"user-only"` | `"labeled-only"` | `"all"`); `defaultProjectTrust` (`"ask"` | `"always"` | `"never"`); `codemode.mode` (`"on"` | `"only"`); `markdown.mermaid` (`"off"` | `"final"` | `"streaming"`); `transport` (`"auto"` | `"sse"` | `"websocket"` | `"websocket-cached"`); `sessionShareDestination` (`"auto"` | `"gist"` | `"radius"`).
- Mixed values: `quietStartup` (`true` | `false` | `"header"`); `terminal.hyperlinks`, `terminal.trueColor` (`true` | `false` | `"auto"`); `terminal.images` (`"kitty"` | `"iterm2"` | `"auto"` | `false`).
- Non-negative integers: `compaction.reserveTokens`, `compaction.keepRecentTokens`, `branchSummary.reserveTokens`, `codemode.inlineBudget`, `thinkingBudgets.minimal`, `thinkingBudgets.low`, `thinkingBudgets.medium`, `thinkingBudgets.high`.
- Non-negative integer or exactly the string `"disabled"`, the canonical spelling the dashboard writes: `httpIdleTimeoutMs`, `websocketConnectTimeoutMs`. pi 1.5.0 documents both `0` and `"disabled"` as disabling the timeout; pi's runtime parser has accepted `"disabled"` (trimmed, case-insensitive) since 1.3.0 or earlier. Other spellings, and `"disabled"` on any other integer key, are rejected.
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

#### Scenario: Timeout keys accept the disabled literal
- **WHEN** a client patches `httpIdleTimeoutMs = "disabled"` and `websocketConnectTimeoutMs = 0`
- **THEN** the write SHALL succeed and the file SHALL contain both values as sent
- **AND** a patch of `compaction.reserveTokens = "disabled"` SHALL be rejected with `400` naming `compaction.reserveTokens`
- **AND** a patch of `httpIdleTimeoutMs = "Disabled"` SHALL be rejected with `400` naming `httpIdleTimeoutMs`

### Requirement: Form rows for every typed key
Form mode SHALL render one row per typed-patch key, grouped into the categories Model and thinking, Interaction, Tools, Sessions and context, Terminal and display, Network, Shell, Resources, and Updates and privacy. Each row SHALL show a label, the raw dotted key, a control, and a hint. The control SHALL offer an explicit "default" choice that leaves the key unset and SHALL display pi's documented default value. Boolean keys and enumerations with at most three values SHALL use a segmented control; longer enumerations SHALL use a select. A stored value outside the known options SHALL be shown as an extra, selected option in either control, and SHALL NOT be changed unless the user changes it. A key that is set SHALL show a "Changed" marker that carries text, not only colour, and a reset action that returns it to unset. An integer outside its range SHALL show an inline error tied to the control as soon as it is entered. A stored string on `httpIdleTimeoutMs` or `websocketConnectTimeoutMs` that pi parses as disabled (`"disabled"`, trimmed and case-insensitive) SHALL be shown as `0` (both disable the timeout in pi), with the Changed marker, and SHALL NOT be rewritten unless the user edits that row. Any other stored string on those keys SHALL be shown as an empty number input with the Changed marker and no extra text, SHALL be kept as stored in the file, SHALL NOT be rewritten unless the user edits that row, and SHALL NOT block saving other rows. A Save attempted while any field error remains SHALL fail with those errors, write nothing, and keep the draft dirty. Keys with their own editor elsewhere SHALL render as link rows instead of editable controls: the default-model keys (read-only values plus a link to the Default model control), `retry.*` (link to the Retry editor), `packages` (link to Add-ons), and `extensions` and `skills` (link to Skills). The object- or array-valued keys `modelThinkingLevels`, `compaction.modelOverrides`, `defaultTools`, `npmCommand`, `prompts` and `themes`, and the TUI-only keys `tuiMode`, `fullscreenExitOutput`, `fullscreenScrollbar`, `fullscreenCopyOnSelect`, `fullscreenWheelScrollLines` and `outputPad` (documented no-ops with no dashboard surface), SHALL render as rows whose action switches to JSON mode and that offer no editable control. The keys `dashboardPluginBridges`, `_dashboardManagedPackages`, `lastChangelogVersion` and `extensionChangelogVersions` (the last two written by pi) SHALL render as a collapsed, read-only list. A stored key that is in none of these lists, such as `selfUpdateCommand`, SHALL render no row in Form mode; it is shown and edited only in JSON mode.

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

#### Scenario: Stored disabled timeout is shown as 0 and preserved
- **GIVEN** the file contains `httpIdleTimeoutMs: "disabled"`
- **WHEN** Form mode renders and the user saves after editing an unrelated key
- **THEN** the HTTP idle timeout row SHALL show `0` with the Changed marker, not pi's default
- **AND** the patch SHALL NOT contain `httpIdleTimeoutMs`

#### Scenario: Disabled spellings show as 0 and other stored strings do not block Save
- **GIVEN** the file contains `httpIdleTimeoutMs: " Disabled "` and `websocketConnectTimeoutMs: "soon"`
- **WHEN** Form mode renders and the user saves after editing an unrelated key
- **THEN** the HTTP idle timeout row SHALL show `0` with the Changed marker
- **AND** the save SHALL succeed, and the patch SHALL contain neither `httpIdleTimeoutMs` nor `websocketConnectTimeoutMs`

#### Scenario: Non-numeric stored timeout string shows an empty input
- **GIVEN** the file contains `websocketConnectTimeoutMs: "soon"`
- **WHEN** Form mode renders
- **THEN** the WebSocket connect timeout row SHALL show an empty number input with the Changed marker and no field error or extra hint text
- **AND** the file SHALL still hold `"soon"` until the user edits that row
