## MODIFIED Requirements

### Requirement: Skill command intercepts and injects SKILL.md
When a `/skill:<name>` command is sent from the dashboard, the bridge extension's `sessionPrompt` handler SHALL detect the skill command pattern, look up the skill's SKILL.md path from `pi.getCommands()`, read the file content, and send it as a user message so the LLM receives the skill context. If the skill is not found, the command SHALL be sent as-is (fallback to current behavior). In a team-confined session this requirement SHALL NOT apply: `sessionPrompt` is unreachable there, the bridge SHALL NOT consult `pi.getCommands()` for skills, and SHALL expand `/skill:<name>` only for the session's effective skills from their own `SKILL.md`, refusing any other `/skill:` instead of sending it as-is.

#### Scenario: Known skill command injects SKILL.md content
- **WHEN** the user sends `/skill:openspec-explore` from the dashboard
- **THEN** the bridge looks up "skill:openspec-explore" in `pi.getCommands()`
- **AND** reads the SKILL.md file at the command's `path` field
- **AND** sends the SKILL.md content as a user message to the LLM

#### Scenario: Unknown skill falls back to plain message
- **WHEN** the user sends `/skill:nonexistent` from the dashboard
- **AND** no matching command with `source: "skill"` exists
- **THEN** the text is sent as a regular user message (current behavior)

#### Scenario: Skill command with additional text
- **WHEN** the user sends `/skill:openspec-explore some additional context`
- **THEN** the SKILL.md content is sent followed by the additional context text

#### Scenario: Team session never falls back to the registry
- **WHEN** a team-confined session whose effective skills are `[review]` receives `/skill:openspec-explore`, which `pi.getCommands()` lists
- **THEN** the registry is not consulted, no skill text is read or sent, and the user sees "skill not available"

### Requirement: Command routing in send_prompt handler
The bridge extension's command handler SHALL parse `send_prompt` text for `!`, `!!`, and `/` prefixes and route them to the appropriate pi APIs instead of always calling `sendUserMessage()`.

Routing order:
1. `!!<cmd>` → silent bash via `pi.exec()`, forward `bash_output` event
2. `!<cmd>` → bash via `pi.exec()`, forward `bash_output` event + send to LLM
3. `/compact [args]` → `ctx.compact()` with optional custom instructions
4. `/` prefixed → `session.prompt(text)` for extension commands, skills, templates
5. Default → `pi.sendUserMessage(text)`

In a team-confined session (the process carries `PI_EXT_TEAM_TOOLS`), the routing SHALL follow the team carve-out of `command-routing` "Command routing order": steps 1, 2 and 4 SHALL NOT run, `/skill:` is handled only for effective skills, and other `/` text is sent unexpanded or dropped.

#### Scenario: Bang command routed to exec
- **WHEN** `send_prompt` arrives with text `!npm test`
- **THEN** the handler SHALL call `pi.exec()` with the command, NOT `sendUserMessage()`

#### Scenario: Compact routed to ctx.compact
- **WHEN** `send_prompt` arrives with text `/compact`
- **THEN** the handler SHALL call `ctx.compact()`, NOT `sendUserMessage()`

#### Scenario: Regular text unchanged
- **WHEN** `send_prompt` arrives with text `explain this function`
- **THEN** the handler SHALL call `sendUserMessage("explain this function")` as before

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

