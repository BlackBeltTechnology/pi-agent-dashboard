## ADDED Requirements

### Requirement: pi 1.5.1–1.6.0 changes SHALL be recorded as adopted, not consumed, or no-ops

The adoption record SHALL classify every pi 1.5.1–1.6.0 change that reaches a dashboard surface as adopted, audited but not consumed, or a documented no-op, and SHALL give the reason for each. The scenarios below list the items.

#### Scenario: Adopted items are recorded
- **WHEN** the change is archived
- **THEN** the record SHALL name as adopted the floor raise to 1.6.0 (`pi-core-version-check`, `provider-auth-server`)
- **AND** the `cacheWarming` default `"idle"` and its new description (1.5.1)
- **AND** the bridge shutdown fallback moved from 500 ms to an `unref()`'d 5 s in an extracted module (`bridge-shutdown.ts`), because since 1.5.1 pi exits cleanly on its own when idle and its `dispose()` waits for in-progress credential writes (`bridge-extension`)
- **AND** the residual risks: Windows `taskkill /F` stops, SIGKILL 2 s after SIGTERM, an idle interactive dispose ended by the ladder's SIGTERM, a headless ladder outlasting the fallback, and an unlinked keeper-hosted pi SIGKILLed by its keeper

#### Scenario: Audited items are recorded with reasons
- **WHEN** the change is archived
- **THEN** the record SHALL name as audited but not consumed `registerMarkdownTransformer` `messageTypes` / `MarkdownMessageType` (the dashboard registers no Markdown transformer)
- **AND** `ctx.ui.custom()` overlays honouring `blocked` (no dashboard caller)
- **AND** pi-ai's `./session-resources`, `./lazy-bedrock-provider` and `./lazy-oauth` subpaths (no consumer; OAuth providers are read through pi-coding-agent, `provider-auth-server`)
- **AND** `AgentSessionRuntime.takeUnreportedDiagnostics()` (the dashboard hosts no `AgentSessionRuntime`)
- **AND** the `pi auth login|logout` shell commands (the dashboard has its own provider-auth flow)
- **AND** `ModelRuntime.settleCredentialWrites()` on the server's and `nano-banana`'s runtimes (needs an exit barrier; split out to `settle-server-credential-writes-on-exit`)
- **AND** `models.json` `compat.promptCacheKeyMode` / `compat.requiresNonNullAssistantContent` (the dashboard mirrors no `compat` keys)

#### Scenario: Documented no-ops are recorded with reasons
- **WHEN** the change is archived
- **THEN** the record SHALL list as no-ops: pi-tui `render()` returning `readonly string[]` (the dashboard's only TUI component builds a fresh array and nothing mutates render output)
- **AND** reload during a streaming response or a compaction throwing "Wait for the current response to finish before reloading." (the bridge already reports a throwing reload as a `/reload` error; `npm run reload` leaves busy sessions on old code)
- **AND** delivered image-only steer / follow-up messages leaving pi's pending queue (unblocks the follow-up drain's `hasPendingMessages()` gate)
- **AND** runtime disposal waiting for active tool aborts (covered by the 5 s fallback)
- **AND** RPC `new_session` / `switch_session` / `fork` / `clone` running `session_start` once and streaming its events (the server reads no pi RPC stdout events and sends none of those commands)
- **AND** `AgentSession.reload()` emitting `session_start` for SDK hosts bound with `bindExtensions({})` (the dashboard's only SDK use is a one-shot `createAgentSession` that never reloads)
- **AND** `pi.events` handler errors and startup diagnostics reported as extension errors or stderr diagnostics (not consumed)
- **AND** the Continue / Fork / Cancel prompt for a session whose folder is gone (the dashboard refuses such spawns with `cwd_missing`)
- **AND** `find` / `grep` path patterns relative to the search path (no dashboard caller passes one)
- **AND** RPC shutdown no longer interrupted by stdin EOF or a single signal (the ladder sends one SIGTERM, then SIGKILL)
- **AND** `pi.exec` reporting 128 + signal for a signal-terminated command (the bridge forwards `code` verbatim, `bash-execution`)
- **AND** transcript-content fixes delivered through the generic event path (Esc-aborted batch results, MCP tools surviving resume, very long bash output lines, `!`/`!!` truncation notice, `/copy` skipping aborted messages)
- **AND** changes inside pi with no dashboard code: default model moves (no product code hard-codes a pi default model id), Qwen Token Plan gateways and retired ids, Anthropic message threads, the OpenAI reasoning-drop notice, provider retries, grep context lines, `"tools": []` omission, the llama.cpp default port, prompt-template argument quoting, MCP transport and sign-in fixes, steering image resizing, and TUI / Mermaid / Kitty fixes
- **AND** pi's default system prompt and the mirrored trust files, byte-identical between 1.5.0 and 1.6.0
