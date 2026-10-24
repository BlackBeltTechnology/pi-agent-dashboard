# Spec Delta

## Purpose

Makes an imported Claude Code plugin behave inside a pi session the way its authors expect. Covers skills, plugin path variables, slash commands, MCP servers and command hooks, translated onto pi's own mechanisms, with at most one active instance per plugin.

## ADDED Requirements

### Requirement: One active instance per plugin per session
When the same plugin is installed both globally and locally for the session's project, only the local install SHALL contribute skills, commands, MCP servers and hooks to the session. The global install SHALL contribute none of these, and its details SHALL show it as overridden by the local install. Subagent sessions SHALL NOT share this state with their parent session.

#### Scenario: Local overrides global
- **WHEN** plugin `x` is installed globally and locally, and a session starts in that project
- **THEN** `x`'s skills, commands, MCP servers and hooks are each registered once, from the local install

#### Scenario: Subagent session in the same process
- **WHEN** a session with plugin `x` active spawns a subagent session in the same process
- **THEN** the subagent session registers `x`'s components for itself, and the parent session's registrations are unchanged

### Requirement: Plugin registration is fail-closed and hooks come first
An active plugin's hooks SHALL be registered before its skills, MCP servers and commands. If registering any part fails, the plugin SHALL register none of the later parts, and the user SHALL be notified once, naming the plugin. A plugin SHALL never have commands or MCP servers active while its hooks failed to register.

#### Scenario: Hook registration fails
- **WHEN** a plugin's hook configuration cannot be registered
- **THEN** none of its skills, MCP servers or commands are registered, and the user is notified naming the plugin

### Requirement: Imported skills are available in sessions
The skills of an active imported plugin SHALL be listed to the agent like any other pi skill, and SHALL be invocable with `/skill:<name>`.

#### Scenario: Skill listed
- **WHEN** plugin `x` with skill `pdf-tools` is active and a session starts
- **THEN** the agent's skill list contains `pdf-tools` with its description

### Requirement: Plugin path variables resolve per plugin
`${CLAUDE_PLUGIN_ROOT}` SHALL resolve to the importing plugin's own root, and `${CLAUDE_SKILL_DIR}` to the skill's own directory. They SHALL resolve in:
- plugin files the agent reads with the read tool;
- explicitly invoked skills;
- expanded commands;
- MCP server configuration;
- hook and inline-command child processes.

Two imported plugins SHALL each see their own root.

#### Scenario: Skill read by the agent
- **WHEN** the agent reads an imported `SKILL.md` that contains `${CLAUDE_PLUGIN_ROOT}/scripts/run.sh`
- **THEN** the content the agent receives contains the absolute path of that plugin's `scripts/run.sh`

#### Scenario: Explicit skill invocation
- **WHEN** the user runs `/skill:pdf-tools` in the terminal for an imported skill that references `${CLAUDE_SKILL_DIR}`
- **THEN** the loaded instructions contain that skill directory's absolute path

#### Scenario: Explicit skill invocation from the dashboard
- **WHEN** the user sends `/skill:pdf-tools` from the dashboard
- **THEN** the instructions the agent receives contain that skill directory's absolute path

#### Scenario: Two plugins, two roots
- **WHEN** plugins `a` and `b` both reference `${CLAUDE_PLUGIN_ROOT}`
- **THEN** content from `a` resolves to `a`'s root and content from `b` resolves to `b`'s root

#### Scenario: Unrelated file untouched
- **WHEN** the agent reads a project file that contains the literal text `${CLAUDE_PLUGIN_ROOT}`
- **THEN** the text is returned unchanged

### Requirement: Imported commands are slash commands
Each command of an active imported plugin SHALL be available as `/<plugin>:<command>`. It SHALL also be available as `/<command>` when no other active imported plugin in the session has a command of that name. The command's description SHALL include its argument hint.

#### Scenario: Command listed
- **WHEN** a plugin `x` with `commands/review.md` is active and no other active imported plugin has `review`
- **THEN** both `/x:review` and `/review` are available, with the description and argument hint from its frontmatter

#### Scenario: Command while the agent is busy
- **WHEN** the user runs an imported command while the agent is still responding, in a session connected to the dashboard
- **THEN** the expanded message appears in the session's follow-up queue after earlier entries, and is delivered once the agent settles

#### Scenario: Command while busy without the dashboard
- **WHEN** the user runs an imported command while the agent is responding, in a session without the dashboard bridge
- **THEN** the command is not run, and the user is notified to run it when the agent is idle

#### Scenario: Two plugins with the same command
- **WHEN** active imported plugins `x` and `y` both have a `review` command
- **THEN** `/x:review` and `/y:review` are available, and `/review` is not registered by either

### Requirement: Command expansion matches Claude semantics without argument injection
Invoking an imported command SHALL do the following, then send the expanded text as the user's message:
- replace each `` !`cmd` `` in the command's own body with the command's standard output, run in the session working directory with a timeout;
- replace each `@path` in the body with that file's content;
- replace `$ARGUMENTS` with all arguments and `$1..$n` with positional arguments, as literal text.

Text supplied as arguments SHALL never be executed or inlined.

#### Scenario: Arguments and inline bash
- **WHEN** a command body is ``Fix issue $1. Status: !`git status --short` `` and the user runs `/fix 42`
- **THEN** the sent message contains `Fix issue 42.` followed by the output of `git status --short`

#### Scenario: Shell syntax in arguments stays literal
- **WHEN** the user runs ``/fix !`rm -rf ~` @/etc/passwd``
- **THEN** no command is executed and no file is inlined, and the sent message contains that argument text literally

#### Scenario: Inline command fails
- **WHEN** an inline `` !`cmd` `` in the body exits non-zero or times out
- **THEN** its placeholder is replaced with a marked error note including the exit status, and the message is still sent

#### Scenario: File reference outside allowed roots
- **WHEN** a command body references a file whose real path is outside the session directory and the plugin root, including through a symbolic link
- **THEN** the reference is not inlined, and a note states that the path is outside the allowed roots

### Requirement: Plugin output entering the agent's context is capped
Output from a plugin's hooks or inline command shell that is added to the agent's context SHALL be limited to 50,000 characters per hook run or inline command. Longer output SHALL be truncated to that length and followed by a note stating that it was truncated and naming the plugin.

#### Scenario: Output at the cap
- **WHEN** a `SessionStart` hook prints exactly 50,000 characters
- **THEN** all 50,000 characters reach the agent's context, and no truncation note is added

#### Scenario: Output over the cap
- **WHEN** an inline `` !`cmd` `` in a command body prints 50,001 characters
- **THEN** the expanded message contains the first 50,000 characters followed by a truncation note naming the plugin

### Requirement: Imported MCP servers connect in sessions
The MCP servers of an active imported plugin SHALL connect in the session. They may be declared in `.mcp.json` (either as a flat map of servers or under `mcpServers`) or inline in the plugin's manifest. Their names SHALL be prefixed by the plugin name. Environment variable references SHALL be expanded from the session environment, with defaults honoured. A server configured directly in pi's MCP configuration with the same final name SHALL take precedence.

#### Scenario: HTTP server
- **WHEN** plugin `x` declares an MCP server with `type: "http"` and a URL
- **THEN** the session connects to that URL as an MCP server named after `x` and the server

#### Scenario: Flat .mcp.json
- **WHEN** plugin `x`'s `.mcp.json` is `{"docs": {"command": "npx", "args": ["docs-mcp"]}}`
- **THEN** the session lists an MCP server named after both `x` and `docs`, and its tools are callable

#### Scenario: Missing environment variable
- **WHEN** a server's configuration references `${TFE_TOKEN}` without a default and the variable is unset
- **THEN** that server is not connected, and a warning names the plugin, the server, and `TFE_TOKEN`

#### Scenario: Plugin deactivated
- **WHEN** plugin `x` is removed and connected sessions reload
- **THEN** `x`'s MCP servers are no longer connected

### Requirement: Claude hook events run plugin command hooks
For an active plugin, command hooks SHALL run for exactly these Claude events:
- `SessionStart`: per start, resume, clear or compaction, matched on source; never on reload;
- `UserPromptSubmit`: once per user-submitted prompt (terminal, RPC or dashboard), including imported commands; never for other extension messages;
- `PreToolUse`, `PostToolUse`, `PostToolUseFailure`: per tool call, matched on Claude tool name;
- `Stop`, `StopFailure`: once per prompt, when the agent finishes.

#### Scenario: PostToolUse hook runs after a tool
- **WHEN** a plugin declares a `PostToolUse` hook matching `Write` and the agent writes a file
- **THEN** the hook command runs once after the write completes

#### Scenario: Stop runs once per prompt
- **WHEN** a plugin declares a `Stop` hook and the agent answers one prompt that involved an internal retry
- **THEN** the hook runs exactly once

#### Scenario: SessionStart matched by source
- **WHEN** a plugin declares a `SessionStart` hook with matcher `resume` and the user resumes a session
- **THEN** the hook runs, and it does not run when a fresh session starts

#### Scenario: Dashboard prompt triggers prompt hooks
- **WHEN** the user sends a prompt from the dashboard and a `UserPromptSubmit` hook exists
- **THEN** the hook runs once for that prompt

#### Scenario: Extension message does not trigger prompt hooks
- **WHEN** another extension sends a message to the agent, and a `UserPromptSubmit` hook exists
- **THEN** the hook does not run

#### Scenario: Context for a queued prompt
- **WHEN** a `UserPromptSubmit` hook returns additional context for a prompt that is queued while the agent is busy
- **THEN** the prompt is queued unchanged, the context is not attached, and a warning names the hook

#### Scenario: Reload does not re-run SessionStart
- **WHEN** a package install reloads a connected session
- **THEN** no `SessionStart` hook runs for that reload

#### Scenario: Expanded command does not re-fire prompt hooks
- **WHEN** the user runs an imported command and a `UserPromptSubmit` hook exists
- **THEN** the hook runs once, for the user's submitted command, and not again for the expanded text

#### Scenario: Unsupported event never runs
- **WHEN** a plugin declares a `PermissionRequest` hook
- **THEN** the hook never runs in any session

### Requirement: Hooks receive Claude-shaped input
A hook SHALL receive a JSON object on standard input with the session id, the transcript path, the working directory and the event name. Tool events SHALL also include the tool name and tool input, and the tool response when available. Tool names and tool inputs SHALL use Claude's names and field shapes where a mapping exists.

#### Scenario: Edit translated for a hook
- **WHEN** the agent edits `src/a.ts`, replacing `x` with `y`, and a `PreToolUse` hook matches `Edit`
- **THEN** the hook receives `tool_name` `Edit` and `tool_input` with `file_path` `src/a.ts`, `old_string` `x`, `new_string` `y`

#### Scenario: Multiple edits in one call
- **WHEN** one edit call carries three replacements and a `PreToolUse` hook matches `Edit`
- **THEN** the hook runs three times, once per replacement

#### Scenario: Tool without a Claude equivalent
- **WHEN** the agent calls a tool with no Claude equivalent
- **THEN** hooks whose matcher names only Claude tools do not run for it

#### Scenario: Hook without matcher
- **WHEN** a `PreToolUse` hook declares no matcher and the agent calls any tool
- **THEN** the hook runs for that call

### Requirement: Blocking hooks prevent the action
A `PreToolUse` hook that exits with status 2, outputs a block decision, crashes, or times out SHALL prevent the tool call. Its reason SHALL be shown to the agent. When one tool call causes several hook runs, any blocking run SHALL block the whole call. A `UserPromptSubmit` hook that exits with status 2 SHALL prevent the prompt, and its reason SHALL be shown to the user.

#### Scenario: Pre-tool block
- **WHEN** a `PreToolUse` hook matching `Bash` exits with status 2 and stderr `rm is forbidden`
- **THEN** the bash call does not execute, and the agent sees `rm is forbidden` as the reason

#### Scenario: Pre-tool hook times out
- **WHEN** a `PreToolUse` hook exceeds its timeout
- **THEN** the tool call is blocked with a timeout reason

#### Scenario: Hook interpreter missing
- **WHEN** a `PreToolUse` hook runs `python3 …`, `python3` is not installed, and a matching tool is called
- **THEN** the call is blocked with a reason naming the missing interpreter and the plugin, and the user is notified once per session that the plugin is degraded

#### Scenario: One of three edit runs blocks
- **WHEN** a `PreToolUse` hook runs for each of three replacements in one edit call and blocks the second
- **THEN** none of the three replacements is applied

#### Scenario: Prompt blocked
- **WHEN** a `UserPromptSubmit` hook exits with status 2 and stderr `no secrets`
- **THEN** the prompt is not sent to the agent, and the user is shown `no secrets`

### Requirement: Non-blocking hook outcomes
Additional context returned by `SessionStart`, `UserPromptSubmit` or `PostToolUse` hooks SHALL be given to the agent as context, without changing the user's visible message. A failure of a hook for any other event SHALL leave the action unchanged and SHALL report a warning. A block decision from a `Stop` hook SHALL be ignored with a reported warning.

#### Scenario: Post-tool hook crashes
- **WHEN** a `PostToolUse` hook exits with a non-zero status other than 2
- **THEN** the tool result is unchanged, and a warning naming the hook is reported

#### Scenario: Session start context
- **WHEN** a `SessionStart` hook prints `Project uses pnpm`
- **THEN** the agent's first turn includes `Project uses pnpm` as context, and the user's message text is unchanged

#### Scenario: Stop block ignored
- **WHEN** a `Stop` hook outputs a block decision
- **THEN** the agent run still ends, and a warning states that stop-blocking is unsupported

### Requirement: Hook updated input maps back or blocks
When `PreToolUse` hooks return updated tool input, the tool call SHALL use it only when every update for that call maps back to the pi tool's input without conflict. Otherwise the call SHALL be blocked, with a reason saying the update could not be applied.

#### Scenario: Updated command applied
- **WHEN** a `PreToolUse` hook on `Bash` returns updated input with a different `command`
- **THEN** the bash call executes the updated command

#### Scenario: Conflicting updates
- **WHEN** two hook runs for the same call return different updates for the same field
- **THEN** the call is blocked with a reason stating that the updates conflict

### Requirement: Plugin environment is provided to child processes
Hook commands, inline command bash, and plugin MCP stdio servers SHALL receive these environment variables:
- `CLAUDE_PLUGIN_ROOT`;
- `CLAUDE_PROJECT_DIR`;
- `CLAUDE_PLUGIN_DATA`, a persistent per-plugin directory in the dashboard's store;
- `CLAUDE_ENV_FILE`, for `SessionStart` hooks.

#### Scenario: Plugin data persists
- **WHEN** a hook writes a file under `$CLAUDE_PLUGIN_DATA` and the user starts a new session
- **THEN** the file is still present for the same plugin

### Requirement: Session environment file reaches later commands
Variables that `SessionStart` hooks write to `CLAUDE_ENV_FILE` SHALL be present for the same session's later hook processes, inline-command processes, and bash tool commands. For bash tool commands, the plugin's `PreToolUse` hooks SHALL evaluate the command as the agent issued it, before the variables are applied.

#### Scenario: Env file carries forward
- **WHEN** a `SessionStart` hook appends `export FOO=1` to `$CLAUDE_ENV_FILE`
- **THEN** a later `PostToolUse` hook in the same session sees `FOO=1`

#### Scenario: Env file reaches the bash tool
- **WHEN** a `SessionStart` hook appends `export FOO=1` to `$CLAUDE_ENV_FILE` and the agent runs `echo $FOO` with the bash tool
- **THEN** the output is `1`

#### Scenario: Guard hook sees the original command
- **WHEN** a `SessionStart` hook wrote `$CLAUDE_ENV_FILE`, a `PreToolUse` hook blocks commands matching `^rm`, and the agent runs `rm x`
- **THEN** the hook receives the command `rm x` and blocks it
