# agent-session-context-injection Specification

## Purpose
Bridge injects a per-turn fragment into the agent's system prompt naming the active pi session (`sessionId`, `cwd`) and, when set, the dashboard-attached OpenSpec change with the path to its artifacts. Closes the gap where the agent had no structured awareness of its own session or the attached change.

## Requirements

### Requirement: BridgeContext carries attachedChange state

`BridgeContext` SHALL include a mutable field `attachedChange: string | null` (initial value `null`). The field SHALL be the single in-memory source of truth read by the `before_agent_start` handler.

#### Scenario: Initial state on bridge construction

- **WHEN** a bridge `BridgeContext` is constructed via `createBridgeContext`
- **THEN** `bc.attachedChange === null`

#### Scenario: Updated by inbound `attach_proposal_changed`

- **WHEN** the bridge's connection layer receives `{ type: "attach_proposal_changed", sessionId: <bc.sessionId>, attachedChange: "X" }`
- **THEN** `bc.attachedChange === "X"`

#### Scenario: Cleared by `attach_proposal_changed` with null

- **WHEN** `bc.attachedChange === "X"` and the bridge receives `{ type: "attach_proposal_changed", sessionId: <bc.sessionId>, attachedChange: null }`
- **THEN** `bc.attachedChange === null`

#### Scenario: Ignores messages for other sessions

- **WHEN** `bc.sessionId === "S1"` and an `attach_proposal_changed` arrives with `sessionId: "S2"`
- **THEN** `bc.attachedChange` SHALL NOT change

### Requirement: New `attach_proposal_changed` server-to-extension protocol message

The shared protocol SHALL define a new variant `AttachProposalChangedExtensionMessage` of `ServerToExtensionMessage`:

```typescript
interface AttachProposalChangedExtensionMessage {
  type: "attach_proposal_changed";
  sessionId: string;
  attachedChange: string | null;
}
```

`ServerToExtensionMessage` SHALL be extended to include this variant. No other protocol messages SHALL be modified.

#### Scenario: Message variant is part of ServerToExtensionMessage union

- **WHEN** TypeScript compiles `packages/shared/src/protocol.ts`
- **THEN** `ServerToExtensionMessage` SHALL accept a value with `type: "attach_proposal_changed"`, `sessionId: string`, `attachedChange: string | null`

#### Scenario: Older bridges silently ignore unknown message type

- **WHEN** an older bridge connected to a newer server receives `{ type: "attach_proposal_changed", ... }`
- **THEN** the bridge SHALL log-and-drop without crashing (existing default-branch behaviour in connection layer)

### Requirement: `AGENTS.override.md` shadows directory context instead of appending

pi 0.84.1 recognizes `AGENTS.override.md` as a per-directory context override that REPLACES the context files for that directory rather than adding to them. pi's own loader owns injection into the agent (`dist/core/resource-loader.js` lists the override first among its candidates and returns on first match), so the dashboard SHALL NOT reimplement that resolution.

Where the dashboard keeps its OWN notion of which files are context files — the kb agents-chain walk, the kb index doc-typing, and the kb extension's context-file name set — it SHALL treat an `AGENTS.override.md` as shadowing its siblings in the same directory, so the same logical repository scope is not surfaced twice. Ancestor inheritance SHALL be unaffected: only the overridden directory is replaced.

#### Scenario: Override shadows the sibling AGENTS.md

- **WHEN** a directory contains both `AGENTS.override.md` and `AGENTS.md`
- **THEN** only the override's content SHALL be treated as that directory's context
- **AND** the sibling `AGENTS.md` SHALL NOT also be applied for that directory

#### Scenario: No override leaves inheritance untouched

- **WHEN** a directory contains no `AGENTS.override.md`
- **THEN** normal `AGENTS.md` ancestor inheritance SHALL apply unchanged

#### Scenario: Override shadows CLAUDE.md too

- **WHEN** a directory contains both `AGENTS.override.md` and `CLAUDE.md` and CLAUDE-file support is enabled
- **THEN** only the override SHALL be treated as that directory's context

#### Scenario: Override is doc-typed as a context file

- **WHEN** the kb indexer assigns a doc type to `AGENTS.override.md`
- **THEN** it SHALL be typed as an `agents` context file, not as an ordinary `doc`

#### Scenario: Pi owns injection; no dashboard feature-detection branch

- **WHEN** the running pi predates `AGENTS.override.md` support
- **THEN** that pi simply never loads such a file and normal `AGENTS.md` inheritance applies
- **AND** the dashboard SHALL NOT carry a version- or shape-gated fallback branch for it

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

### Requirement: A manual Retry turn receives the per-turn system-prompt contributions

With pi ≥ 1.2.0, the turn started by the bridge's Retry dispatch (`pi.sendMessage({ customType: "pi-dashboard:retry", display: false }, { triggerTurn: true })`) SHALL run every `before_agent_start` handler, with `event.messageType === "custom"`. The dashboard handlers SHALL NOT skip such runs: the dashboard session-context injector SHALL write its `dashboard_session` section for the Retry turn exactly as for a user-prompted turn. The handlers SHALL NOT read `event.prompt`, which is absent on custom-message runs.

#### Scenario: Retry turn carries the dashboard session-context fragment
- **GIVEN** a bridged session with an attached OpenSpec change
- **WHEN** `before_agent_start` fires with `messageType: "custom"` and no `prompt` for a `pi-dashboard:retry` turn
- **THEN** the injector SHALL write a `dashboard_session` section containing the sessionId and the attached change, and SHALL return no `systemPrompt`

#### Scenario: Custom-message event without prompt does not throw
- **WHEN** a `before_agent_start` event with `messageType: "custom"`, a `message` and no `prompt` or `images` reaches the bridge
- **THEN** every bridge `before_agent_start` handler SHALL complete without throwing
- **AND** the pass-through forwarder SHALL forward the event

#### Scenario: Team guard filters skills on a Retry turn too
- **GIVEN** a team session whose policy grants one skill
- **WHEN** `before_agent_start` fires with `messageType: "custom"` for a Retry turn
- **THEN** the team-guard handler SHALL build a fresh grant filter for that start and leave only the granted skill in `systemPromptOptions.skills`
