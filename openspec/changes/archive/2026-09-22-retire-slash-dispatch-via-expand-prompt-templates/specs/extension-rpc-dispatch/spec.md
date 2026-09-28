# extension-rpc-dispatch — delta

## ADDED Requirements

### Requirement: Capability retired

**DEPRECATED** — extension slash-command dispatch is in-process since change `retire-slash-dispatch-via-expand-prompt-templates`. Successor: `command-routing` "Extension slash command dispatch via sendUserMessage". The server SHALL keep a one-release tombstone arm for `dispatch_extension_command` that answers via `emitCommandFeedback(sessionId, command, "error", "bridge outdated — reload the session")` (persisted + broadcast) and logs a warning; the `DispatchExtensionCommandMessage` type stays `@deprecated` until the tombstone is removed.

#### Scenario: Un-reloaded bridge hits the tombstone
- **WHEN** a bridge that predates this change sends `dispatch_extension_command {sessionId, command:"/ctx-stats", requestId}`
- **THEN** the server SHALL persist and broadcast `command_feedback {command:"/ctx-stats", status:"error", message:"bridge outdated — reload the session"}`
- **AND** SHALL NOT write to any keeper socket
- **AND** a browser reattaching later SHALL replay the terminal event (no stuck "in progress" pill)

## REMOVED Requirements

### Requirement: Bridge dispatch_extension_command message
**Reason**: pi >= 0.84.2 `pi.sendUserMessage(text, { expandPromptTemplates: true })` dispatches extension commands in-process via core `AgentSession.prompt()`; the bridge no longer needs the server or the keeper to reach pi's `prompt()` entry point. The dashboard's enforced pi floor (0.85.1) guarantees the API in dashboard-spawned sessions; older peers are gated (see `command-routing` "Extension slash command dispatch via sendUserMessage").
**Migration**: The bridge calls `pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs })` and emits the terminal `command_feedback` itself.

### Requirement: Bridge headless detection
**Reason**: Its dispatch use is gone. `isHeadlessRpcSession()` itself STAYS in `bridge-context.ts` — it has a live caller (`bridge.ts` session registration `isHeadless:`).
**Migration**: Remove only the `slash-dispatch.ts` call; keep the function and its tests.

### Requirement: Server-side dispatch routing to keeper
**Reason**: No current-bridge producer of `dispatch_extension_command` remains.
**Migration**: Delete `packages/server/src/rpc-keeper/dispatch-router.ts` and the server's UDS write client (`headlessPidRegistry.writeRpc`, `keeperManager.writeRpc` — no other caller). Replace the `event-wiring.ts` arm with a one-release tombstone: on receipt emit `command_feedback {status:"error", message:"bridge outdated — reload the session"}` and log a warning. `DispatchExtensionCommandMessage` in `packages/shared/src/protocol.ts` stays `@deprecated` until the tombstone is removed.

### Requirement: Optimistic completion semantic
**Reason**: The server no longer emits `command_feedback` for extension commands (except the tombstone `error`).
**Migration**: The bridge emits `started` before `sendUserMessage`, `completed` immediately after a call that returned (handed to pi, fire-and-forget), `error` on a synchronous throw. Handler outcome is not observable by the bridge — the same limitation the optimistic semantic had.
