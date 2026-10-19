## REMOVED Requirements

### Requirement: Bridge injects per-turn dashboard session context into system prompt

**Reason**: Returning a splice-replaced `systemPrompt` sets pi's `forceSystemPrompt`, which freezes a mid-chain snapshot and silently drops structured contributions (tool guidelines, prompt guidelines, sections) from later handlers, e.g. the roles plugin's Agent guideline. The `Current working directory:` anchor it spliced on no longer exists in pi's structured rendering.

**Migration**: Replaced by "Bridge contributes per-turn dashboard session context as a structured prompt section" below. Fragment content (delimiter, sessionId/cwd line, attached-change line) is unchanged; it now arrives as the `dashboard_session` section instead of trailing text.

## ADDED Requirements

### Requirement: Bridge contributes per-turn dashboard session context as a structured prompt section

The bridge extension SHALL register a `pi.on("before_agent_start", ...)` handler that, on every turn, writes the dashboard-session-context fragment into the structured system-prompt options as the custom section named `dashboard_session` (`event.systemPromptOptions.sections.dashboard_session`). The handler SHALL NOT return a `systemPrompt` value and SHALL NOT set `forceSystemPrompt`, so structured contributions made by other extensions in the same turn (sections, tool guidelines, prompt guidelines), whether their handlers run before or after this one, remain present in the system prompt sent to the provider. pi renders the section as `<dashboard_session>` … `</dashboard_session>` after its own `cwd` section; the handler SHALL NOT remove or rewrite pi's `cwd` section.

The fragment SHALL begin with the literal delimiter line `── pi-dashboard session context ──` so it is distinguishable from user content and from the rest of the system prompt, and SHALL NOT carry a leading or trailing blank line.

The fragment SHALL always include exactly one line of the form:

```
You are pi session `<sessionId>` running in `<cwd>`.
```

where `<sessionId>` is `bc.sessionId` (the bridge-owned dashboard session id; pi exposes no `pi.sessionId`) and `<cwd>` is `event.systemPromptOptions.cwd`.

When `BridgeContext.attachedChange` is a non-empty string, the fragment SHALL include exactly one additional line of the form:

```
Attached OpenSpec change: `<change-name>`. See `openspec/changes/<change-name>/{proposal,design,tasks}.md`.
```

When `BridgeContext.attachedChange` is `null`, `undefined`, or the empty string, the attached-change line SHALL be omitted entirely. The change name SHALL be reduced to a single safe token (newlines, backticks and control characters stripped) before interpolation.

When `event.systemPromptOptions` is absent or not an object, the handler SHALL contribute nothing for that turn and SHALL NOT throw.

#### Scenario: No attached change — section carries only the sessionId/cwd line

- **WHEN** `before_agent_start` fires and `BridgeContext.attachedChange` is `null`
- **AND** `bc.sessionId === "abc-123"` and `event.systemPromptOptions.cwd === "/Users/robson/Project/pi-agent-dashboard"`
- **THEN** `event.systemPromptOptions.sections.dashboard_session` SHALL equal `"── pi-dashboard session context ──\nYou are pi session `abc-123` running in `/Users/robson/Project/pi-agent-dashboard`."`
- **AND** no `Attached OpenSpec change:` line SHALL appear
- **AND** the handler SHALL return no `systemPrompt`

#### Scenario: Attached change — both lines included

- **WHEN** `before_agent_start` fires and `BridgeContext.attachedChange === "wire-plugin-registry-into-shell"`
- **THEN** the `dashboard_session` section SHALL contain the `You are pi session` line followed by `Attached OpenSpec change: \`wire-plugin-registry-into-shell\`. See \`openspec/changes/wire-plugin-registry-into-shell/{proposal,design,tasks}.md\`.`

#### Scenario: Detach reflected on next turn — line removed silently

- **WHEN** turn N fires with `BridgeContext.attachedChange === "X"` (line included)
- **AND** before turn N+1 the server pushes `attach_proposal_changed { attachedChange: null }`
- **AND** the bridge updates `BridgeContext.attachedChange = null`
- **AND** turn N+1's `before_agent_start` fires
- **THEN** turn N+1's `dashboard_session` section SHALL omit the `Attached OpenSpec change:` line entirely
- **AND** no synthetic message SHALL be injected announcing the detach

#### Scenario: Later structured contributions survive

- **WHEN** the dashboard injector handler runs, and a handler registered after it in the same turn appends a bullet to `systemPromptOptions.toolGuidelines.Agent`
- **AND** the `Agent` tool is active
- **THEN** the system prompt sent to the provider SHALL contain both the `dashboard_session` section and that Agent guideline bullet

#### Scenario: pi-owned sections reach the provider

- **WHEN** the dashboard injector handler fires and the structured options also carry a section pi or another extension contributes (e.g. `mcp_servers`, listing MCP servers to load via `tool_search`)
- **THEN** the system prompt sent to the provider SHALL contain that section alongside `dashboard_session`

#### Scenario: pi's cwd section is preserved

- **WHEN** the dashboard injector handler fires
- **THEN** the rendered system prompt SHALL still contain pi's own `cwd` section unchanged
- **AND** the `dashboard_session` section SHALL appear after it

#### Scenario: Reload does not duplicate the fragment

- **WHEN** the bridge is reloaded mid-session and both the stale and current handler generations fire in one turn
- **THEN** the rendered system prompt SHALL contain exactly one `── pi-dashboard session context ──` delimiter

#### Scenario: Missing structured options

- **WHEN** `before_agent_start` fires with no `systemPromptOptions` object
- **THEN** the handler SHALL return without contributing and without throwing

#### Scenario: Injection persists across session reseating on fork/resume

- **WHEN** pi reseats the session via fork or resume (same `pi` instance; the bridge extension updates the tracked `sessionId` in `session_start`)
- **THEN** the already-registered `before_agent_start` handler SHALL still fire on subsequent turns (no re-registration required)
- **AND** it SHALL build the fragment from the NEW session's `sessionId`/`attachedChange`, read live via the getter
