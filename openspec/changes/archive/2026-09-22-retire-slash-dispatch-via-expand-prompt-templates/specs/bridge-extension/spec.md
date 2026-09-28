# bridge-extension — delta

## ADDED Requirements

### Requirement: Slash dispatch helper dispatches in-process
The `tryDispatchExtensionCommand(pi, text, sessionId, sink, delivery?)` helper in `packages/extension/src/slash-dispatch.ts` SHALL:

1. Return `false` (no feedback emitted) when `isExtensionSlashCommand(text, pi.getCommands())` is false, or when `pi.getCommands()` throws (stale ctx) — the caller proceeds with the existing passthrough.
2. Otherwise emit `command_feedback {status:"started"}`; then, if the running pi's version (injectable reader; default walks up from `process.argv[1]`, never throws) parses below `0.84.2`, emit `{status:"error", message:"Extension slash commands from the dashboard require pi 0.84.2+"}`; else call `pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs: delivery ?? "followUp" })` and emit `{status:"completed"}`, or `{status:"error", message}` if the call throws synchronously.
3. Return `true` whenever it emitted `started`.

The helper SHALL NOT accept a `connection` parameter, SHALL NOT feature-detect `pi.dispatchCommand`, and SHALL NOT emit `dispatch_extension_command`. Both call sites (`bridge.ts::sessionPrompt`, `command-handler.ts` slash else-arm) SHALL pass the requested `delivery` when known.

#### Scenario: In-process dispatch
- **GIVEN** `text` is `/ctx-stats`, `ctx-stats` is in `pi.getCommands()` with `source: "extension"`, pi version `0.86.1`
- **WHEN** `tryDispatchExtensionCommand(pi, text, sessionId, sink, "followUp")` is called
- **THEN** `pi.sendUserMessage("/ctx-stats", { expandPromptTemplates: true, deliverAs: "followUp" })` SHALL be invoked
- **AND** sink SHALL receive `command_feedback {status:"started"}` then `{status:"completed"}`
- **AND** the helper SHALL return `true`

#### Scenario: Steer delivery forwarded
- **WHEN** called with `delivery: "steer"`
- **THEN** `pi.sendUserMessage` SHALL receive `deliverAs: "steer"`

#### Scenario: Old pi gate
- **GIVEN** pi version `0.84.1`
- **WHEN** the helper is called with an extension command
- **THEN** sink SHALL receive `started` then `error` containing "requires pi 0.84.2+"
- **AND** `pi.sendUserMessage` SHALL NOT be called
- **AND** the helper SHALL return `true`

#### Scenario: Synchronous throw
- **GIVEN** `pi.sendUserMessage` throws
- **WHEN** the helper is called with an extension command
- **THEN** sink SHALL receive `started` then `error` with the thrown message, and no `completed`

#### Scenario: Non-extension command unaffected
- **GIVEN** `text` is `/skill:foo` (source: "skill") OR `/totally-unknown` (no match)
- **WHEN** the helper is called
- **THEN** it SHALL return `false` and sink SHALL receive no `command_feedback`

## REMOVED Requirements

### Requirement: Slash dispatch helper applies three-way decision
**Reason**: Replaced by "Slash dispatch helper dispatches in-process" — pi >= 0.84.2 `sendUserMessage({ expandPromptTemplates: true })` makes Paths B/C/D unnecessary.
**Migration**: Rewrite `slash-dispatch.ts` per the ADDED requirement; rewrite the Path B/C/D assertions and drop the `describe("hasDispatchCommand")` block in `bridge-slash-command-routing.test.ts` (no separate `slash-dispatch.test.ts` exists).

### Requirement: Bridge wires connection into slash-dispatch helper call sites
**Reason**: The helper no longer sends anything to the server; the `connection` parameter is removed.
**Migration**: Both call sites drop the `connection` argument and pass `delivery` instead.
