# rpc-keeper-sidecar — delta

## MODIFIED Requirements

### Requirement: JSON-line forward protocol (fire-and-forget)
The keeper's UDS / named-pipe protocol SHALL be JSON-lines: every newline-delimited string received on the socket SHALL be appended with `\n` (if missing) and written verbatim to pi's stdin. The keeper SHALL NOT parse, validate, or modify the JSON content of incoming lines. The keeper SHALL NOT respond to writes — the socket is write-only from the dashboard server's perspective; keeper acknowledgement is implicit (write succeeds → line forwarded).

The keeper SHALL accept multiple concurrent connections on its socket. The keeper SHALL NOT serialize writes from different connections beyond what the underlying pi stdin pipe enforces.

Pi's RPC events flow back to the dashboard via the bridge extension's WebSocket connection (existing path), NOT via the keeper. The keeper SHALL NOT capture or forward pi's stdout.

As of `retire-slash-dispatch-via-expand-prompt-templates`, extension slash-command dispatch no longer uses this channel: the bridge dispatches in-process via `pi.sendUserMessage(text, { expandPromptTemplates: true })`. The channel remains for any other server-originated RPC line and as the durable owner of pi's stdin across dashboard restarts. Keeper behaviour is unchanged.

#### Scenario: Server writes a prompt RPC line
- **WHEN** the dashboard server connects to the session's UDS / named pipe and writes `{"type":"prompt","message":"hello","id":"abc"}\n`
- **THEN** the keeper SHALL write the same line (with trailing `\n` if not present) to pi's stdin
- **AND** the keeper SHALL NOT respond on the socket

#### Scenario: Keeper does not capture pi stdout
- **WHEN** pi's RPC mode emits events on its stdout
- **THEN** those events SHALL flow over the bridge WS connection (existing path)
- **AND** the keeper SHALL NOT read pi's stdout
- **AND** the keeper SHALL NOT forward pi's stdout to any UDS / named-pipe client

#### Scenario: Extension slash commands no longer traverse the keeper
- **WHEN** a dashboard user sends `/ctx-stats` to a headless session
- **THEN** no RPC line SHALL be written to the keeper socket for it
- **AND** the command SHALL still execute (dispatched in-process by the bridge)
