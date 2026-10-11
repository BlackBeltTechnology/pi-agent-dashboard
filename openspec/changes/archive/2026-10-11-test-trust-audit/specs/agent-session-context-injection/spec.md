## MODIFIED Requirements

### Requirement: Bridge injects per-turn dashboard session context into system prompt

The bridge extension SHALL register a `pi.on("before_agent_start", ...)` handler that returns `{ systemPrompt }` containing a splice-replaced copy of `event.systemPrompt` on every turn. The handler SHALL locate the LAST occurrence of the literal anchor `\nCurrent working directory: ` in `event.systemPrompt` and replace from that anchor through end-of-string with the dashboard-session-context fragment. The fragment carries `cwd` itself, so the dropped `Current working directory:` line loses no information. All `event.systemPrompt` content BEFORE the anchor SHALL be preserved verbatim, so the handler composes with pi's body and with other extensions' system-prompt contributions. When the anchor is absent, the handler SHALL fall back to appending the fragment after a single blank-line separator (`\n\n`).

The fragment SHALL be enclosed in clearly-marked delimiters so it is distinguishable from user content and from the rest of the system prompt. The opening delimiter SHALL be the literal line `── pi-dashboard session context ──`. The fragment SHALL NOT carry a trailing blank line; the caller controls separators (a leading `\n` on splice, `\n\n` on fallback append).

The fragment SHALL always include exactly one line of the form:

```
You are pi session `<sessionId>` running in `<cwd>`.
```

where `<sessionId>` is `bc.sessionId` (the bridge-owned dashboard session id; pi exposes no `pi.sessionId`) and `<cwd>` is `event.systemPromptOptions.cwd`.

When `BridgeContext.attachedChange` is a non-empty string, the fragment SHALL include exactly one additional line of the form:

```
Attached OpenSpec change: `<change-name>`. See `openspec/changes/<change-name>/{proposal,design,tasks}.md`.
```

When `BridgeContext.attachedChange` is `null`, `undefined`, or the empty string, the attached-change line SHALL be omitted entirely.

#### Scenario: No attached change — splices over trailing cwd line, only sessionId/cwd line included

- **WHEN** `before_agent_start` fires and `BridgeContext.attachedChange` is `null`
- **AND** `bc.sessionId === "abc-123"` and `event.systemPromptOptions.cwd === "/Users/robson/Project/pi-agent-dashboard"`
- **AND** `event.systemPrompt` ends with `"…Current date: 2026-06-27\nCurrent working directory: /Users/robson/Project/pi-agent-dashboard"`
- **THEN** the handler SHALL return `{ systemPrompt }` where everything up to and including `"…Current date: 2026-06-27"` is retained verbatim, the original `Current working directory:` line is dropped, and the result ends with `"\n── pi-dashboard session context ──\nYou are pi session `abc-123` running in `/Users/robson/Project/pi-agent-dashboard`."`
- **AND** no `Attached OpenSpec change:` line SHALL appear

#### Scenario: Attached change — both lines included

- **WHEN** `before_agent_start` fires and `BridgeContext.attachedChange === "wire-plugin-registry-into-shell"`
- **THEN** the spliced-in fragment SHALL contain the `You are pi session` line followed by `Attached OpenSpec change: \`wire-plugin-registry-into-shell\`. See \`openspec/changes/wire-plugin-registry-into-shell/{proposal,design,tasks}.md\`.`

#### Scenario: Detach reflected on next turn — line removed silently

- **WHEN** turn N fires with `BridgeContext.attachedChange === "X"` (line included)
- **AND** before turn N+1 the server pushes `attach_proposal_changed { attachedChange: null }`
- **AND** the bridge updates `BridgeContext.attachedChange = null`
- **AND** turn N+1's `before_agent_start` fires
- **THEN** turn N+1's fragment SHALL omit the `Attached OpenSpec change:` line entirely
- **AND** no synthetic message SHALL be injected announcing the detach

#### Scenario: Splice preserves content before the anchor

- **WHEN** `event.systemPrompt` contains the anchor `\nCurrent working directory: ` and arbitrary content before it (pi's body plus any earlier extensions' contributions)
- **AND** the dashboard injector handler fires
- **THEN** the returned `systemPrompt` SHALL retain all content before the anchor verbatim
- **AND** everything from the anchor through end-of-string SHALL be replaced by the dashboard fragment

#### Scenario: Multiple anchors — only the last is replaced

- **WHEN** `event.systemPrompt` contains the anchor `\nCurrent working directory: ` more than once
- **THEN** the handler SHALL splice only at the LAST occurrence, leaving earlier occurrences untouched

#### Scenario: Fallback append when anchor absent

- **WHEN** `event.systemPrompt` does NOT contain the anchor `\nCurrent working directory: ` (future pi versions or third-party SP overrides)
- **AND** the dashboard injector handler fires
- **THEN** the returned `systemPrompt` SHALL equal the full prior `event.systemPrompt` followed by `\n\n` and the dashboard fragment

#### Scenario: Injection persists across session reseating on fork/resume

- **WHEN** pi reseats the session via fork or resume (same `pi` instance; the bridge extension updates the tracked `sessionId` in `session_start`)
- **THEN** the already-registered `before_agent_start` handler SHALL still fire on subsequent turns (no re-registration required)
- **AND** it SHALL build the fragment from the NEW session's `sessionId`/`attachedChange`, read live via the getter
