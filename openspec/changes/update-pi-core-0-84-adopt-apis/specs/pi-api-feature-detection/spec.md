## ADDED Requirements

### Requirement: The pi 0.84.0 delta-only `message_update` change SHALL be recorded as not applicable

pi 0.84.0 removed the cumulative `message` field and `assistantMessageEvent.partial` from `message_update`. That change applies ONLY to pi's JSON and RPC **stdout** protocols (`dist/modes/json-event.d.ts`, `toJsonEvent()`, `JsonAgentSessionEvent`). The in-process `ExtensionAPI` event surface (`dist/core/extensions/types.d.ts`) is unchanged. The dashboard SHALL continue to consume the in-process surface and SHALL NOT implement delta-accumulation, dual-shape reduction, or replay-compaction rework for this release.

#### Scenario: In-process event shape is unchanged across the bump

- **WHEN** `MessageUpdateEvent` in `dist/core/extensions/types.d.ts` is compared between pi 0.83.0 and 0.84.0
- **THEN** the interface SHALL be identical
- **AND** it SHALL still declare `message: AgentMessage`

#### Scenario: The bridge consumes the in-process surface

- **WHEN** the bridge subscribes to core events
- **THEN** it SHALL do so via `pi.on(<eventType>, handler)` from the in-process `ExtensionAPI`
- **AND** it SHALL NOT parse pi's JSON/RPC stdout event stream

#### Scenario: The RPC keeper is outbound-only

- **WHEN** the RPC keeper sidecar communicates with a spawned `pi --mode rpc` process
- **THEN** it SHALL only write RPC command lines to the keeper socket
- **AND** it SHALL NOT read pi stdout as an event stream

### Requirement: pi 0.84.0 surfaces adopted behind runtime feature-detection

Each pi 0.84.0 surface the dashboard adopts SHALL be feature-detected on its concrete shape, never on the pi version string, and SHALL have an explicit fallback reproducing pre-adoption behavior for sessions at or above `piCompatibility.minimum`.

#### Scenario: `AGENTS.override.md` present

- **WHEN** the running pi recognizes `AGENTS.override.md` as a context-file name
- **THEN** the dashboard SHALL treat that file as shadowing the directory's `AGENTS.md`

#### Scenario: `AGENTS.override.md` absent on floor pi

- **WHEN** the running pi does not recognize `AGENTS.override.md`
- **THEN** the dashboard SHALL fall back to normal `AGENTS.md` ancestor inheritance with no crash and no behavior regression

#### Scenario: `samplingParams` present

- **WHEN** the running pi's model config accepts a `samplingParams` record
- **THEN** custom-model configuration SHALL be able to carry arbitrary OpenAI-compatible sampling parameters

#### Scenario: `samplingParams` absent on floor pi

- **WHEN** the running pi's model config does not accept `samplingParams`
- **THEN** the dashboard SHALL omit the field and configure the model exactly as before

### Requirement: Fullscreen TUI mode and TUI Mermaid/LaTeX are documented no-ops

pi 0.84.0's fullscreen TUI mode and its terminal Mermaid/LaTeX rendering are TUI-only surfaces with no dashboard equivalent to add. The web client already renders both via `chat-math-rendering` (KaTeX) and `mermaid-diagram`. These SHALL be recorded as no-ops alongside `outputPad`.

#### Scenario: Fullscreen TUI mode has no web-client surface

- **WHEN** the running pi supports fullscreen TUI mode
- **THEN** the dashboard SHALL expose no corresponding setting or control
- **AND** no dashboard behavior SHALL change

#### Scenario: TUI Mermaid/LaTeX does not displace the existing web renderers

- **WHEN** the running pi renders Mermaid and LaTeX in its own transcript
- **THEN** the web client SHALL continue to render them via its existing KaTeX and Mermaid components
