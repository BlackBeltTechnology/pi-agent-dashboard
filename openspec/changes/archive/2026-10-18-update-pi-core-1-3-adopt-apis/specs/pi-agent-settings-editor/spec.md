## MODIFIED Requirements

### Requirement: Typed patch of curated pi settings
The dashboard SHALL accept a typed PATCH limited to the following keys and types (dotted names address a leaf inside a block):

- Booleans: `hideThinkingBlock`, `showCacheMissNotices`, `compaction.enabled`, `branchSummary.skipPrompt`, `showHardwareCursor`, `terminal.showImages`, `terminal.clearOnShrink`, `terminal.showTerminalProgress`, `images.autoResize`, `images.blockImages`, `enableSkillCommands`, `collapseChangelog`, `enableInstallTelemetry`, `enableAnalytics`, `warnings.anthropicExtraUsage`.
- Enumerations: `cacheWarming` (`"off"` | `"streaming"` | `"idle"`); `steeringMode`, `followUpMode` (`"all"` | `"one-at-a-time"`); `doubleEscapeAction` (`"tree"` | `"fork"` | `"none"`); `treeFilterMode` (`"default"` | `"no-tools"` | `"user-only"` | `"labeled-only"` | `"all"`); `defaultProjectTrust` (`"ask"` | `"always"` | `"never"`); `codemode.mode` (`"on"` | `"only"`); `markdown.mermaid` (`"off"` | `"final"` | `"streaming"`); `transport` (`"auto"` | `"sse"` | `"websocket"` | `"websocket-cached"`); `sessionShareDestination` (`"auto"` | `"gist"` | `"radius"`).
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

