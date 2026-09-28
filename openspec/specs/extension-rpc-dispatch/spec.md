# extension-rpc-dispatch Specification

## Purpose
**DEPRECATED** — retired by change `retire-slash-dispatch-via-expand-prompt-templates`. Extension slash commands now dispatch IN-PROCESS: `pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs })` behind a pi >= 0.84.2 gate, in every session kind. Successor capability: `command-routing` "Extension slash command dispatch via sendUserMessage". What remains here is the one-release server TOMBSTONE for `dispatch_extension_command` — persist + broadcast a terminal `error` plus a warning, so an un-reloaded bridge's chat pill converges instead of hanging — and the `@deprecated` `DispatchExtensionCommandMessage` type. Retired surface: bridge emission, `isHeadlessRpcSession`-gated dispatch, keeper-sidecar routing, and the optimistic-completion semantic.

## Requirements

### Requirement: Capability retired

**DEPRECATED** — extension slash-command dispatch is in-process since change `retire-slash-dispatch-via-expand-prompt-templates`. Successor: `command-routing` "Extension slash command dispatch via sendUserMessage". The server SHALL keep a one-release tombstone arm for `dispatch_extension_command` that answers via `emitCommandFeedback(sessionId, command, "error", "bridge outdated — reload the session")` (persisted + broadcast) and logs a warning; the `DispatchExtensionCommandMessage` type stays `@deprecated` until the tombstone is removed.

#### Scenario: Un-reloaded bridge hits the tombstone
- **WHEN** a bridge that predates this change sends `dispatch_extension_command {sessionId, command:"/ctx-stats", requestId}`
- **THEN** the server SHALL persist and broadcast `command_feedback {command:"/ctx-stats", status:"error", message:"bridge outdated — reload the session"}`
- **AND** SHALL NOT write to any keeper socket
- **AND** a browser reattaching later SHALL replay the terminal event (no stuck "in progress" pill)
