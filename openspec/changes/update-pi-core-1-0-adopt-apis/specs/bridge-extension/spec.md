## ADDED Requirements

### Requirement: Slash dispatch helper dispatches in-process without a pi version gate
The `tryDispatchExtensionCommand(pi, text, sessionId, sink, delivery?)` helper in `packages/extension/src/slash-dispatch.ts` SHALL:

1. Return `false` (no feedback emitted) when `isExtensionSlashCommand(text, pi.getCommands())` is false, or when `pi.getCommands()` throws (stale ctx) — the caller proceeds with the existing passthrough.
2. Otherwise emit `command_feedback {status:"started"}`; then call `pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs: delivery ?? "followUp" })` and emit `{status:"completed"}`, or `{status:"error", message}` if the call throws synchronously.
3. Return `true` whenever it emitted `started`.

The helper SHALL NOT accept a `connection` parameter, SHALL NOT feature-detect `pi.dispatchCommand`, and SHALL NOT emit `dispatch_extension_command`. Both call sites (`bridge.ts::sessionPrompt`, `command-handler.ts` slash else-arm) SHALL pass the requested `delivery` when known.

#### Scenario: In-process dispatch
- **GIVEN** `text` is `/ctx-stats`, `ctx-stats` is in `pi.getCommands()` with `source: "extension"`
- **WHEN** `tryDispatchExtensionCommand(pi, text, sessionId, sink, "followUp")` is called
- **THEN** `pi.sendUserMessage("/ctx-stats", { expandPromptTemplates: true, deliverAs: "followUp" })` SHALL be invoked
- **AND** sink SHALL receive `command_feedback {status:"started"}` then `{status:"completed"}`
- **AND** the helper SHALL return `true`

#### Scenario: Steer delivery forwarded
- **WHEN** called with `delivery: "steer"`
- **THEN** `pi.sendUserMessage` SHALL receive `deliverAs: "steer"`

#### Scenario: Synchronous throw
- **GIVEN** `pi.sendUserMessage` throws
- **WHEN** the helper is called with an extension command
- **THEN** sink SHALL receive `started` then `error` with the thrown message, and no `completed`

#### Scenario: Non-extension command unaffected
- **GIVEN** `text` is `/skill:foo` (source: "skill") OR `/totally-unknown` (no match)
- **WHEN** the helper is called
- **THEN** it SHALL return `false` and sink SHALL receive no `command_feedback`

#### Scenario: No version read
- **WHEN** the helper dispatches any extension command
- **THEN** it SHALL NOT read the running pi's version

## MODIFIED Requirements

### Requirement: Server stores and broadcasts reported pi version

The bridge SHALL report the version of the pi process it runs inside, read by walking up from that process's entry point (`process.argv[1]`) to the nearest pi-coding-agent manifest, never by resolving the package by name. On receipt of `pi_version_update`, the server SHALL store `version` as `DashboardSession.piVersion` for that session and broadcast a session update to subscribed browsers, mirroring the `git_info_update` handling. Older bridges that never send the message SHALL leave `piVersion` undefined; its presence drives the read-only display in the session header and the below-floor warning (`pi-core-version-check`).

#### Scenario: Stored and broadcast
- **WHEN** the server receives `{ type: "pi_version_update", sessionId, version: "0.80.2" }`
- **THEN** the session record's `piVersion` SHALL become `"0.80.2"`
- **AND** a session-updated broadcast carrying `{ piVersion: "0.80.2" }` SHALL be sent to that session's browser subscribers

## REMOVED Requirements

### Requirement: Slash dispatch helper dispatches in-process

**Reason**: The 0.84.2 version gate is unreachable at the 1.0.0 floor.

**Migration**: See "Slash dispatch helper dispatches in-process without a pi version gate".
