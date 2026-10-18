## MODIFIED Requirements

### Requirement: Command routing in send_prompt handler
The bridge extension's command handler SHALL parse `send_prompt` text for `!`, `!!`, and `/` prefixes and route them to the appropriate pi APIs instead of always calling `sendUserMessage()`.

Routing order:
1. `!!<cmd>` → silent bash via `pi.exec()`, forward `bash_output` event
2. `!<cmd>` → bash via `pi.exec()`, forward `bash_output` event + send to LLM
3. `/compact [args]` → `ctx.compact()` with optional custom instructions
4. `/` prefixed → `session.prompt(text)` for extension commands, skills, templates
5. Default → `pi.sendUserMessage(text, { deliverAs })`, `deliverAs` defaulting to `"followUp"`

In a team-confined session (the process carries `PI_EXT_TEAM_TOOLS`), the routing SHALL follow the team carve-out of `command-routing` "Command routing order": steps 1, 2 and 4 SHALL NOT run, `/skill:` is handled only for effective skills, and other `/` text is sent unexpanded or dropped.

#### Scenario: Bang command routed to exec
- **WHEN** `send_prompt` arrives with text `!npm test`
- **THEN** the handler SHALL call `pi.exec()` with the command, NOT `sendUserMessage()`

#### Scenario: Compact routed to ctx.compact
- **WHEN** `send_prompt` arrives with text `/compact`
- **THEN** the handler SHALL call `ctx.compact()`, NOT `sendUserMessage()`

#### Scenario: Regular text unchanged
- **WHEN** `send_prompt` arrives with text `explain this function`
- **THEN** the handler SHALL call `sendUserMessage("explain this function", { deliverAs: "followUp" })` as before

The command handler SHALL also handle `kill_process` messages by calling `killProcessByPgid(pgid)` from the process-scanner module.

#### Scenario: Kill process command received
- **WHEN** the command handler receives a `kill_process` message with a valid PGID
- **THEN** it SHALL call `killProcessByPgid(pgid)` and log the result

#### Scenario: Kill process for wrong session ignored
- **WHEN** the command handler receives a `kill_process` message with a sessionId that does not match the current session
- **THEN** it SHALL ignore the message

#### Scenario: Bang command refused in a team session
- **WHEN** a team-confined session receives `send_prompt` with text `!id`
- **THEN** the handler SHALL NOT call `pi.exec()` or `sendUserMessage()`, and SHALL emit `prompt_received { fresh: false }`

