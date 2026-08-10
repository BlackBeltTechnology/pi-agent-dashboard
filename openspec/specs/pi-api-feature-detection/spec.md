# pi-api-feature-detection Specification

## Purpose
TBD - created by archiving change update-pi-core-0-83-adopt-apis. Update Purpose after archive.
## Requirements
### Requirement: Runtime feature-detection governs all new-pi API adoption

The dashboard SHALL adopt every new pi runtime API (introduced above the compatibility `minimum`) behind runtime feature-detection of the concrete surface, and SHALL NOT gate behavior on the pi version string. Detection SHALL test the surface in the form that is actually load-bearing for the adoption — for a value surface, that includes its meaningful shape (e.g. `ctx.scopedModels` is detected as a **non-empty array**, because it is present-but-empty on a default unscoped 0.83.0 session), not mere presence. Each detected surface SHALL have an explicit fallback path that reproduces the pre-adoption behavior. A session running on any pi at or above the compatibility `minimum` SHALL continue to function with no crash and no behavior regression when a newer surface is absent (or present in its no-op shape).

#### Scenario: New surface present is used

- **WHEN** a new pi API surface is detected at runtime in its load-bearing shape
- **THEN** the dashboard SHALL use the enhanced path

#### Scenario: New surface absent or no-op-shaped falls back cleanly

- **GIVEN** a pi runtime at or above `minimum` that lacks a newer surface, or exposes it only in a no-op shape (e.g. an empty scope array)
- **WHEN** the dashboard reaches the corresponding code path
- **THEN** it SHALL execute the documented fallback
- **AND** SHALL NOT throw, block the session, or regress prior behavior

### Requirement: The "pending" streaming stop reason SHALL NOT be misclassified as empty-actionable

`"pending"` (pi ≥ 0.83.0) is a partial-**streaming** stop reason. The change SHALL first establish whether `"pending"` can reach the terminal `agent_end` assistant message that `turn-actionability.ts` classifies (via `bridge.ts`); the classifier change SHALL be written only for the shapes that actually reach it, and the reachability finding SHALL be recorded. Where a `"pending"` turn does reach the classifier, it SHALL be treated as an in-progress turn and SHALL NOT be classified as `empty-actionable`. The change SHALL NOT suppress the `EmptyActionableGuard` for turns that are genuinely idle (non-`"pending"`). Error precedence SHALL remain unchanged: a `"pending"` turn carrying an error SHALL still classify as `error`. Because `#7272` converts unmapped terminal provider stop reasons to provider errors pi-side, the classifier SHALL continue to resolve provider-error turns through the existing `error` branch without expecting raw terminal reason strings.

#### Scenario: Pending partial is not treated as empty

- **GIVEN** an assistant turn with `stopReason === "pending"` reaching the classifier with no visible text or tool call
- **WHEN** the turn is classified
- **THEN** the result SHALL be an in-progress/`normal` classification
- **AND** SHALL NOT be `empty-actionable`

#### Scenario: Genuinely idle non-pending turn still guarded

- **GIVEN** an assistant turn that is empty and whose stop reason is NOT `"pending"`
- **WHEN** the turn is classified
- **THEN** the `EmptyActionableGuard` behavior SHALL be unchanged from today

#### Scenario: Provider-error turns still classify as error

- **GIVEN** an assistant turn whose stop reason maps to a provider error (including 0.83.0 unmapped-terminal-reason → error conversion)
- **WHEN** the turn is classified
- **THEN** the result SHALL be `error`

### Requirement: outputPad is a TUI setting with no dashboard surface (documented no-op)

`outputPad` is a pi **TUI horizontal-padding setting** (`docs/settings.md`, `#6168`) that predates the current pin — it is not a custom-message-renderer API and is not new in 0.82/0.83. The dashboard renders in its web client, not pi's TUI, so `outputPad` has no dashboard surface to consume. This requirement SHALL be satisfied as a documented no-op recording that rationale; the change SHALL NOT introduce a pi custom message renderer solely to consume `outputPad`, and the absence SHALL NOT be treated as a gap.

#### Scenario: outputPad has no web-client surface

- **GIVEN** the dashboard renders in the web client and registers no pi TUI custom message renderer
- **WHEN** the `outputPad` adoption is evaluated
- **THEN** the requirement SHALL be considered satisfied as a documented no-op
- **AND** no renderer SHALL be introduced and no code SHALL land for it

### Requirement: The pi 0.84.1 delta-only `message_update` change SHALL be recorded as not applicable

pi 0.84.1 removed the cumulative `message` field and `assistantMessageEvent.partial` from `message_update`. That change applies ONLY to pi's JSON and RPC **stdout** protocols (`dist/modes/json-event.d.ts`, `toJsonEvent()`, `JsonAgentSessionEvent`). The in-process `ExtensionAPI` event surface (`dist/core/extensions/types.d.ts`) is unchanged. The dashboard SHALL continue to consume the in-process surface and SHALL NOT implement delta-accumulation, dual-shape reduction, or replay-compaction rework for this release.

#### Scenario: In-process event shape is unchanged across the bump

- **WHEN** `MessageUpdateEvent` in `dist/core/extensions/types.d.ts` is compared between pi 0.83.0 and 0.84.1
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

### Requirement: pi 0.84.1 surfaces adopted behind runtime feature-detection

Each pi 0.84.1 surface the dashboard adopts SHALL be feature-detected on its concrete shape, never on the pi version string, and SHALL have an explicit fallback reproducing pre-adoption behavior for sessions at or above `piCompatibility.minimum`.

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

pi 0.84.1's fullscreen TUI mode and its terminal Mermaid/LaTeX rendering are TUI-only surfaces with no dashboard equivalent to add. The web client already renders both via `chat-math-rendering` (KaTeX) and `mermaid-diagram`. These SHALL be recorded as no-ops alongside `outputPad`.

#### Scenario: Fullscreen TUI mode has no web-client surface

- **WHEN** the running pi supports fullscreen TUI mode
- **THEN** the dashboard SHALL expose no corresponding setting or control
- **AND** no dashboard behavior SHALL change

#### Scenario: TUI Mermaid/LaTeX does not displace the existing web renderers

- **WHEN** the running pi renders Mermaid and LaTeX in its own transcript
- **THEN** the web client SHALL continue to render them via its existing KaTeX and Mermaid components

### Requirement: The `tool_call` `terminate` result field SHALL be recorded as having no dashboard consumer

pi 0.84.1 added `ToolCallEventResult.terminate?: boolean` (`dist/core/extensions/types.d.ts`), which lets an extension stop an all-terminating tool batch without another model call. It takes effect ONLY for a handler that blocks the call. The dashboard bridge forwards `tool_call` as a pass-through event and never blocks, so the field is unreachable. The dashboard SHALL record this as audited-with-no-consumer and SHALL NOT introduce a blocking `tool_call` handler to use it.

#### Scenario: The bridge does not block tool calls

- **WHEN** the bridge's `tool_call` subscription is inspected
- **THEN** `tool_call` SHALL appear in the pass-through event list
- **AND** the handler SHALL return no `block` and no `terminate` result

#### Scenario: A future blocking handler makes the field live

- **WHEN** a later change introduces a `tool_call` handler that returns `block: true`
- **THEN** this requirement SHALL be revisited, because `terminate` then governs whether the blocked batch triggers a follow-up model call

