## ADDED Requirements

### Requirement: MCP spawn_session does not auto-trust a folder dashboard trust does not cover

A session started by `spawn_session` SHALL load the folder's trust-requiring `.pi/` resources only when pi's trust store records trust for it or dashboard trust covers it (pinned folder, folder inside a workspace folder, covered access grant or YOLO root). The tool result SHALL NOT claim the folder is trusted. ACP sessions run an external agent with no pi process or bridge, so this rule does not apply to them.

#### Scenario: MCP spawn into an unpinned clone does not load its .pi/extensions
- **GIVEN** `/w/clone` holds `.pi/extensions/x.ts`, is not pinned, is outside every workspace folder and has no pi trust entry
- **WHEN** an agent token calls `spawn_session {cwd:"/w/clone"}`
- **THEN** the spawned session SHALL NOT load `x.ts`

#### Scenario: Spawn into a pinned workspace still works
- **GIVEN** `/w/app` is pinned and holds `.pi/skills/s/SKILL.md`
- **WHEN** a control client calls `spawn_session {cwd:"/w/app"}`
- **THEN** the spawned session SHALL be trusted through dashboard trust and SHALL load the skill

#### Scenario: No spawn road auto-trusts an unpinned folder
- **GIVEN** `/w/clone` is unpinned, outside every workspace folder, holds `.pi/extensions/x.ts` and has no pi trust entry
- **WHEN** a session is spawned there by an automation, a goal, `/new`, a worktree spawn, a subfolder spawn, REST or WS
- **THEN** none of those sessions SHALL load `x.ts`

#### Scenario: Spawn tool text is unchanged
- **WHEN** `spawn_session` returns or is described
- **THEN** its result text and tool description SHALL be those of the build before this change
