## ADDED Requirements

### Requirement: The dashboard model-list filter SHALL NOT be replaced by `ctx.scopedModels` while it is a startup snapshot

The bridge SHALL keep filtering the published model list by re-applying the session's `enabledModels` patterns to the current catalogue on every push. `ctx.scopedModels` is resolved once at startup and pi does not export its pattern resolver, so it would hide in-scope models discovered after startup. This non-adoption SHALL be revisited when pi re-resolves the scope on catalogue refresh or exports its resolver.

#### Scenario: Late-discovered in-scope model is published
- **WHEN** `enabledModels` contains `myprovider/*` and `myprovider`'s models are discovered after session start
- **THEN** the next model-list push SHALL include those models

### Requirement: The dashboard thinking-level derivation SHALL NOT be replaced by pi-ai's

The bridge SHALL keep its single `supportedThinkingLevels` derivation (`model-selector`). pi-ai 0.99.1 `getSupportedThinkingLevels` is not equivalent: it offers `max` whenever the model's `thinkingLevelMap.max` is not `undefined`, with no runtime-capability gate, and returns `["off"]` for models without thinking metadata, where the dashboard omits the field. This non-adoption SHALL be revisited if pi-ai adds a runtime-capability gate.

#### Scenario: max stays fail-closed
- **WHEN** a model declares `thinkingLevelMap.max` and the session runtime does not advertise `max`
- **THEN** the published levels SHALL NOT include `max`

### Requirement: pi 0.87 event and session-entry shapes SHALL be tolerated

The bridge, server and client SHALL accept the 0.87 extension-event and session-entry shapes without failing: `agent_before_settle` events, the expanded `turn_end` boundary fields, and `context_edit` session entries. A `context_edit` entry SHALL NOT remove or alter any message in the dashboard's rendered history, because it changes only future model context.

#### Scenario: context_edit on replay
- **WHEN** a session JSONL containing a `context_edit` entry with `replacement: null` is replayed
- **THEN** the targeted message SHALL still render in the dashboard chat
- **AND** replay SHALL NOT error on the unfamiliar entry type

#### Scenario: agent_before_settle forwarded without side effects
- **WHEN** pi emits `agent_before_settle`
- **THEN** the session status SHALL NOT transition to idle on that event alone

### Requirement: Built-in extension and tool settings SHALL be read and written in pi's form

Where the dashboard reads or writes pi's `extensions` setting, it SHALL treat `-builtin:<name>` entries as disables of a pi built-in extension (`mcp`, `llama.cpp`, `codemode`, `tool-search`) and SHALL preserve them on write. Where it reads or writes `defaultTools`, it SHALL preserve `+name` / `-name` delta entries rather than expanding or discarding them.

#### Scenario: Round-trip preserves built-in disables
- **WHEN** the dashboard writes the `extensions` setting of a scope whose current value contains `-builtin:mcp`
- **THEN** the written value SHALL still contain `-builtin:mcp`

#### Scenario: defaultTools deltas are preserved
- **WHEN** the dashboard writes a settings file whose `defaultTools` is `["+codemode"]`
- **THEN** the written `defaultTools` SHALL still be `["+codemode"]`

### Requirement: A session whose file does not exist yet SHALL register normally

pi ≥ 0.99 creates the session file when the first user message is sent. Session registration, state sync and sidecar metadata SHALL work for a session whose reported session-file path does not exist on disk yet, and SHALL pick up the file once it appears.

#### Scenario: Fresh session before first prompt
- **WHEN** a session is spawned and registers before any user message
- **THEN** it SHALL appear in the dashboard with its cwd and model
- **AND** no error SHALL be logged for the missing session file

### Requirement: pi 0.87–0.99 TUI-only and non-consumed changes SHALL be recorded as documented no-ops

The adoption record SHALL list, as having no dashboard surface: the `system` theme and OKHSL/`#rgb` theme colors, `fullscreenWheelScrollLines`, the startup header change, ChatGPT sign-in on the OpenAI provider, the GPT-6.1 Sol Codex default, HTML-export hidden-message toggles, pi's TypeScript 7 build and removal of `tsx`, `provider_stream_event`, llama.cpp and Jev classifier models, per-model image input limits, and the `builtin:<name>` naming of built-in extensions in RPC source info (no dashboard code parses `<inline:` / `<builtin:` names).

#### Scenario: No-op list is present
- **WHEN** the change is archived
- **THEN** the feature-detection spec SHALL name each listed item as a no-op with the reason
