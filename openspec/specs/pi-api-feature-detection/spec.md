# pi-api-feature-detection Specification

## Purpose
TBD - created by archiving change update-pi-core-0-83-adopt-apis. Update Purpose after archive.

## Requirements

### Requirement: Runtime feature-detection governs all new-pi API adoption

The dashboard SHALL adopt every new pi runtime API behind runtime feature-detection of the concrete surface, and SHALL NOT gate behavior on the pi version string. Detection SHALL test the surface in the form that is actually load-bearing for the adoption — for a value surface, that includes its meaningful shape (e.g. `ctx.scopedModels` is detected as a **non-empty array**, because it is present-but-empty on a default unscoped session), not mere presence. A session SHALL continue to function with no crash and no behavior regression when a surface is absent or present in its no-op shape.

Because `piCompatibility.minimum` now tracks the pinned runtime in lockstep, a surface that exists at or below the pinned version is guaranteed present on every supported pi. For such a surface the dashboard SHALL consume it unconditionally and SHALL NOT retain a fallback branch, a version comparator, or a capability flag. Retaining a fallback that no supported runtime can reach SHALL be treated as dead code and removed. Feature-detection remains required only where a surface is genuinely optional at the pinned version — for example a surface whose presence depends on the provider, transport, or host rather than on the pi version.

Where a fallback is legitimately retained, it SHALL have an explicit, reachable trigger that a test can exercise.

**The removal obligation applies to version-string gates, not to runtime probes.** A fallback whose trigger is a *version comparison* against a below-floor pi SHALL be removed. A fallback reached by *probing the surface itself* MAY be retained even when the pinned runtime always satisfies the probe, because the probe costs nothing, cannot mis-answer on a future version, and is the pattern this requirement mandates. Consequently the standing `AGENTS.override.md` and `samplingParams` detections (adopted for pi 0.84.1) are retained unchanged; their scenario framing "absent on floor pi" is superseded by the lockstep floor — the absent-branch is now unreachable in the shipped configuration but stays as a probe, and SHALL NOT be cited as dead code licensed for removal by this requirement.

#### Scenario: Surface guaranteed by the pinned version is consumed unconditionally

- **GIVEN** a pi API surface that exists at the pinned runtime version
- **WHEN** the dashboard consumes it
- **THEN** the call site SHALL be unconditional
- **AND** SHALL NOT carry a version comparison or a below-floor fallback branch

#### Scenario: Optional-at-pin surface is still feature-detected

- **GIVEN** a surface whose presence at the pinned version depends on provider, transport, or host rather than on the pi version
- **WHEN** the dashboard reaches the corresponding code path
- **THEN** it SHALL detect the surface in its load-bearing shape
- **AND** SHALL execute a documented, reachable fallback when it is absent
- **AND** SHALL NOT throw, block the session, or regress prior behavior

#### Scenario: Unreachable fallback is removed, not left in place

- **GIVEN** a fallback branch whose only trigger is a pi version below `piCompatibility.minimum`
- **WHEN** the floor is raised past that version
- **THEN** the branch and its version gate SHALL be removed in the same change
- **AND** any test that existed only to cover that branch SHALL be retired with it

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

pi 0.84.1 added `ToolCallEventResult.terminate?: boolean` (`dist/core/extensions/types.d.ts`), which lets an extension stop an all-terminating tool batch without another model call. It takes effect ONLY for a handler that blocks the call.

The dashboard bridge forwards `tool_call` as a pass-through event. It ALSO registers a blocking `tool_call` handler — **subagent fan-out admission** (change: `bound-subagent-fanout-under-host-pressure`) — which answers `{ block: true, reason }` for an over-cap `Agent` call so the call ends with a real errored tool result rather than an unanswered card that spins forever. That handler deliberately does NOT set `terminate`: a refusal is "not now", not a task failure, so the batch is not terminated and the model may re-issue after the running children finish. The dashboard SHALL keep recording `terminate` as audited-with-no-consumer and SHALL NOT set it.

#### Scenario: The pass-through forwarder does not block tool calls

- **WHEN** the bridge's pass-through `tool_call` forwarder is inspected
- **THEN** `tool_call` SHALL appear in the pass-through event list
- **AND** that handler SHALL return no `block` and no `terminate` result

#### Scenario: The admission handler blocks but never terminates

- **GIVEN** an `Agent` call refused by subagent fan-out admission
- **WHEN** the blocking handler's result is inspected
- **THEN** it SHALL carry `block: true` and a reason
- **AND** it SHALL NOT set `terminate`
- **AND** the blocked call SHALL still yield a terminal errored tool result

#### Scenario: A future blocking handler makes the field live

- **WHEN** a later change makes a blocking `tool_call` handler set `terminate: true`
- **THEN** this requirement SHALL be revisited, because `terminate` then governs whether the blocked batch triggers a follow-up model call

### Requirement: Tool `ctx.cwd` is honoured by dashboard-registered tools

The pinned runtime's built-in filesystem and shell tools now honour `ctx.cwd` rather than ignoring it. The dashboard's own registered tools SHALL be audited against the same defect class: any tool that resolves a filesystem path or spawns a process SHALL resolve it against `ctx.cwd` when one is supplied, and SHALL NOT silently fall back to the host process working directory. Where a dashboard tool is intentionally cwd-independent, that independence SHALL be recorded rather than left implicit.

#### Scenario: Dashboard tool resolves a relative path against ctx.cwd

- **GIVEN** a dashboard-registered tool that accepts a filesystem path
- **WHEN** it is invoked with a relative path and a `ctx.cwd` that differs from the host process cwd
- **THEN** the path SHALL resolve against `ctx.cwd`

#### Scenario: Cwd-independent tool is documented as such

- **GIVEN** a dashboard-registered tool that performs no path or process resolution
- **WHEN** the `ctx.cwd` audit is applied
- **THEN** the tool SHALL be recorded as cwd-independent
- **AND** no cwd handling SHALL be added to it

#### Scenario: No behavior depended on the previous ignore-cwd semantics

- **WHEN** the audit is performed
- **THEN** the change SHALL confirm that no dashboard code path relied on built-in tools ignoring `ctx.cwd`
- **AND** the finding SHALL be recorded

### Requirement: Abort SHALL cancel an in-progress manual compaction without stranding the compacting latch

The pinned runtime's RPC `abort` now genuinely cancels an in-progress manual compaction; previously it reported success without cancelling. The dashboard's compaction state SHALL reflect that: when a manual compaction is aborted, the server-side `compacting` indicator SHALL clear, and the session SHALL return to an idle, promptable state. The indicator SHALL NOT depend solely on a compaction-failure event to clear, because the abort path may complete without emitting one.

#### Scenario: Abort during manual compaction clears the indicator

- **GIVEN** a session with a manual compaction in progress and the `compacting` indicator set
- **WHEN** the user aborts
- **THEN** the compaction SHALL be cancelled
- **AND** the `compacting` indicator SHALL clear
- **AND** the session SHALL accept a subsequent prompt

#### Scenario: Compaction failure still clears the indicator

- **GIVEN** a session with a manual compaction in progress
- **WHEN** the compaction fails and the runtime emits its compaction-failure event
- **THEN** the `compacting` indicator SHALL clear as before

#### Scenario: Indicator does not strand after abort

- **GIVEN** an abort that cancels a compaction without emitting a compaction-failure event
- **WHEN** the abort completes
- **THEN** the `compacting` indicator SHALL NOT remain set

### Requirement: In-memory session restore SHALL be re-verified against the pinned runtime

The dashboard uses the runtime's in-memory session manager for its internal draft-agent path. The pinned runtime adds an API for restoring externally stored session entries. Because this surface is reached through runtime internals that are not exported and therefore cannot fail at build time, the change SHALL verify the in-memory session path against the pinned runtime at runtime, not by inspection alone, and SHALL record the result. Where the new restore API supersedes the dashboard's current construction, the dashboard SHALL adopt it; where it does not, the non-adoption SHALL be recorded with its reason.

#### Scenario: In-memory session path verified at runtime

- **WHEN** the dashboard's internal draft-agent path runs against the pinned runtime
- **THEN** it SHALL complete without a runtime symbol or shape error
- **AND** the verification SHALL be recorded as evidence, not assumed from a green unit-test run

#### Scenario: Restore API adoption decision is recorded

- **WHEN** the new external-entry restore API is evaluated
- **THEN** the change SHALL either adopt it or record why the existing construction is retained

### Requirement: The pinned runtime's TUI-only and non-consumed provider changes SHALL be recorded as documented no-ops

The pinned runtime ships TUI-only behavior (transcript navigation, working indicators, mouse and keybinding handling, image detection, and startup signal handling) and provider/catalog changes for providers and models the dashboard does not consume. The dashboard renders in its web client and SHALL NOT introduce TUI surfaces to consume TUI-only behavior. These SHALL be satisfied as documented no-ops, following the established precedent for prior TUI-only settings, and their absence SHALL NOT be treated as a gap.

#### Scenario: TUI-only behavior has no web-client surface

- **GIVEN** the dashboard renders in the web client and registers no pi TUI surfaces
- **WHEN** a TUI-only change is evaluated for adoption
- **THEN** the requirement SHALL be considered satisfied as a documented no-op
- **AND** no code SHALL land for it

#### Scenario: Provider change with no dashboard consumer is recorded

- **GIVEN** a provider or catalog change for a provider the dashboard does not route
- **WHEN** it is evaluated for adoption
- **THEN** it SHALL be recorded as audited with no dashboard consumer
- **AND** no task SHALL be created for it

### Requirement: Dropped and added runtime sub-dependencies SHALL be verified as unreferenced before the bump lands

The pinned runtime drops internal sub-packages and adds a replacement. The change SHALL verify by repo-wide search that no in-repo source, package manifest, or script references a dropped sub-package, and SHALL record the evidence. The dashboard SHALL import the runtime only through specifiers it already uses, and SHALL NOT take a new dependency on a runtime-internal sub-package.

#### Scenario: Dropped sub-packages are unreferenced

- **WHEN** the repo is searched for references to the dropped runtime sub-packages
- **THEN** there SHALL be zero references in source, manifests, and scripts
- **AND** the finding SHALL be recorded as evidence

#### Scenario: Import surface is unchanged

- **WHEN** the dashboard's runtime import sites are enumerated
- **THEN** they SHALL use only the specifiers already in use before the bump
- **AND** no newly published subpath SHALL be adopted by this change

### Requirement: The dashboard model-list filter SHALL NOT be replaced by `ctx.scopedModels` while it is a startup snapshot

The bridge SHALL keep filtering the published model list by re-applying the session's `enabledModels` patterns to the current catalogue on every push. `ctx.scopedModels` is resolved once at startup and pi does not export its pattern resolver, so it would hide in-scope models discovered after startup. This non-adoption SHALL be revisited when pi re-resolves the scope on catalogue refresh or exports its resolver.

#### Scenario: Late-discovered in-scope model is published
- **WHEN** `enabledModels` contains `myprovider/*` and `myprovider`'s models are discovered after session start
- **THEN** the next model-list push SHALL include those models

### Requirement: The dashboard thinking-level derivation SHALL NOT be replaced by pi-ai's

The bridge SHALL keep its single `supportedThinkingLevels` derivation (`model-selector`). pi-ai 1.0.0 `getSupportedThinkingLevels` is not equivalent: it offers `max` whenever the model's `thinkingLevelMap.max` is not `undefined`, with no runtime-capability gate, and returns `["off"]` for models without thinking metadata, where the dashboard omits the field. This non-adoption SHALL be revisited if pi-ai adds a runtime-capability gate.

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

### Requirement: Codemode image attachments SHALL render in the tool card

pi ≥ 1.0.0 codemode scripts attach images with `image()` (including `models.generateImages()` output): the model-issued `codemode` call's tool result carries base64 `{ type: "image", data, mimeType }` blocks. Live (`tool_execution_end`) and replayed sessions SHALL show those images on that call's tool card through the shared `image-block` accessors, and an over-ceiling image SHALL render as the existing truncated/unavailable slot, never break the message.

#### Scenario: Live codemode image
- **WHEN** a `codemode` `tool_execution_end` result contains text plus one PNG image block
- **THEN** the codemode tool card SHALL show the text and one image

#### Scenario: Replayed codemode image
- **WHEN** the same session is replayed from its JSONL
- **THEN** the tool card SHALL show the same image

### Requirement: A session whose file does not exist yet SHALL register normally

pi ≥ 0.99 (including 1.0.0) creates the session file when the first user message is sent. Session registration, state sync and sidecar metadata SHALL work for a session whose reported session-file path does not exist on disk yet, and SHALL pick up the file once it appears.

#### Scenario: Fresh session before first prompt
- **WHEN** a session is spawned and registers before any user message
- **THEN** it SHALL appear in the dashboard with its cwd and model
- **AND** no error SHALL be logged for the missing session file

### Requirement: pi 0.87–1.0 TUI-only and non-consumed changes SHALL be recorded as documented no-ops

The adoption record SHALL list, as having no dashboard surface: the `system` theme and OKHSL/`#rgb` theme colors, `fullscreenWheelScrollLines`, the startup header change, ChatGPT sign-in on the OpenAI provider, the GPT-6.1 Sol Codex default, HTML-export hidden-message toggles, pi's TypeScript 7 build and removal of `tsx`, `provider_stream_event`, llama.cpp and Jev classifier models, per-model image input limits, and the `builtin:<name>` naming of built-in extensions in RPC source info (no dashboard code parses `<inline:` / `<builtin:` names); and from 0.99.2–1.0.0: the fullscreen-by-default TUI (dashboard tmux sessions keep pi's default, no `tuiMode` override), `quietStartup: "header"`, leaner codemode descriptions and errors, Radius in `/login` (`radius` stays excluded from the registry), MCP OAuth hardening, `/reload` enabling newly added `defaultTools`, and `--provider` without `--model` failing (the dashboard never passes `--provider`).

#### Scenario: No-op list is present
- **WHEN** the change is archived
- **THEN** the feature-detection spec SHALL name each listed item as a no-op with the reason
