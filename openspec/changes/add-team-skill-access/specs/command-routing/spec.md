## MODIFIED Requirements

### Requirement: Command routing order
The command handler SHALL process `send_prompt` text in this exact order:

1. Check for `!!` prefix → silent bash execution
2. Check for `!` prefix → bash execution with LLM send
3. Check for `/compact` → compact routing
4. Check for `/quit` or `/exit` → shutdown
5. Check for `/reload` → extension reload
6. Check for `/new` → spawn new session in same cwd
7. Check for `/model provider/id` → model switch via `setModel` callback
8. Check for `/` prefix matching a known **user-defined flow name** (from `getFlowsList()`) → emit `flow:run` event
9. Check for `/` prefix matching a known **extension command** (`source: "extension"` in `pi.getCommands()`, excluding `DASHBOARD_NATIVE_COMMANDS` and `__`-prefixed names; evaluated inside `tryDispatchExtensionCommand`, which returns `false` if `getCommands()` throws) → dispatch in-process via `pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs })`
10. Check for `/` prefix → fall through to template expansion + `pi.sendUserMessage()` (handles skills, prompt templates, unrecognized slashes)
11. Default (no `/` prefix) → `pi.sendUserMessage(text)` (existing passthrough behavior)

**Team-confined sessions** (the process carries `PI_EXT_TEAM_TOOLS`): before step 1 the handler SHALL apply the shared `parseSkillCommand` rule. A `/skill:<name>` (single or multi-line) SHALL be expanded only when `<name>` is in the session's effective skill set (`PI_EXT_TEAM_SKILLS`), from that skill's own `SKILL.md`. Otherwise it SHALL be refused with `command_feedback` and `prompt_received { fresh: false }`, and never queued. For all other text, only step 3 (`/compact`) and step 11 (passthrough, sent with prompt-template expansion disabled and without disk or registry expansion) SHALL apply. Steps 1–2 and 4–10 SHALL NOT run in a team-confined session, whatever the input's line structure.

Note: pi-flows management commands (`/flows`, `/flows:new`, `/flows:edit`, `/flows:delete`) are registered by the pi-flows extension via `pi.registerCommand` and are therefore handled by step 9 (`/roles` is in `DASHBOARD_NATIVE_COMMANDS` and handled by the bridge). The kebab-menu UI continues to invoke `flows:new-request` / `flows:edit-request` / `flow:run` / `flow:delete-request` directly via the `flow_management` WebSocket message handler in `bridge.ts` — that path is independent of typed-text command routing and is not covered by this requirement.

#### Scenario: Routing precedence — bang beats slash
- **WHEN** `send_prompt` text is `!!echo /ctx-stats`
- **THEN** the handler SHALL execute `echo /ctx-stats` as a silent bash command
- **AND** SHALL NOT invoke any slash routing branch

#### Scenario: Routing precedence — user-defined flow run beats extension dispatch
- **WHEN** `send_prompt` text is `/deploy-prod` AND `deploy-prod` is a user-defined flow name returned by `getFlowsList()` AND ALSO appears in `pi.getCommands()`
- **THEN** the handler SHALL emit `flow:run { flowName: "deploy-prod" }` via `pi.events.emit(...)` (step 8 wins over step 9)
- **AND** SHALL NOT call `pi.sendUserMessage(...)` with `expandPromptTemplates: true` for this text

#### Scenario: Routing precedence — typed `/flows:new` rides extension dispatch
- **WHEN** `send_prompt` text is `/flows:new` AND `getFlowsList()` does NOT contain a user-defined flow named `flows:new` AND `pi.getCommands()` contains `{ name: "flows:new", source: "extension" }` (registered by pi-flows)
- **THEN** step 8 SHALL NOT match (no user-defined flow)
- **AND** step 9 SHALL fire: `pi.sendUserMessage("/flows:new", { expandPromptTemplates: true, deliverAs: "followUp" })`
- **AND** step 10 SHALL NOT execute for this text

#### Scenario: Extension dispatch beats fall-through
- **WHEN** `send_prompt` text is `/ctx-stats` AND `ctx-stats` is an extension command AND no earlier step matches
- **THEN** step 9 fires (in-process dispatch)
- **AND** step 10's fall-through to template expansion SHALL NOT execute

#### Scenario: Team session skips extension dispatch and exec templates
- **WHEN** a team-confined session receives `/ctx-stats` (a registered extension command), `/x` and `/x\nargs` where `x` is an `executable: bash` template in the cwd, and `!id`
- **THEN** no command is dispatched, no bash runs, no text is sent with `expandPromptTemplates: true`, and each input is either dropped with `prompt_received { fresh: false }` or (multi-line) sent unexpanded

