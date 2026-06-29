# dashboard-slash-commands Specification

## Purpose
TBD - created by archiving change add-dashboard-slash-commands. Update Purpose after archive.
## Requirements
### Requirement: Namespace and naming grammar

All dashboard slash commands SHALL be invoked under the `/dashboard:` namespace. Command names SHALL follow the grammar `<resource>-<verb>[-<modifier>]` where `<resource>` is a singular noun naming a resource family, `<verb>` is the action, and `<modifier>` is an optional qualifier such as `-all`, `-active`, or `-here`. The seven resource families are: `server`, `session`, `proposal`, `flow`, `git`, `peer`, `pin`.

#### Scenario: Resource families produce predictable command names

- **GIVEN** the user wants to list pi sessions
- **WHEN** they type a slash command
- **THEN** the command is `/dashboard:session-list` (resource = `session`, verb = `list`); the command file on disk is `dashboard-session-list.md`.

#### Scenario: Modifier qualifies a verb without ambiguity

- **GIVEN** the user wants to list only active sessions
- **WHEN** they type the slash command
- **THEN** the command is `/dashboard:session-list-active` (modifier `-active` qualifies `list`).

#### Scenario: Singular resource form

- **WHEN** a command is named for the `session` resource family
- **THEN** the resource segment SHALL be `session` (singular), not `sessions` (plural).

### Requirement: Initial command set with classification

The initial command set SHALL contain at least 30 commands across the seven resource families, partitioned into LLM-free and LLM-bound classes per the rule defined in design.md. LLM-free commands SHALL include at minimum: `server-health`, `server-config`, `server-tunnel-status`, `session-list`, `session-list-active`, `session-list-here`, `session-info`, `session-diff`, `proposal-archive`, `git-branches`, `peer-list`, `peer-scan`, `pin-list`. LLM-bound commands SHALL include at minimum: `session-tell`, `session-abort`, `session-abort-all`, `session-kill`, `session-rename`, `session-hide`, `session-unhide`, `session-spawn`, `session-resume`, `session-fork`, `session-model`, `session-thinking`, `proposal-attach`, `proposal-detach`, `flow-abort`, `flow-auto`, `git-init`, `git-stash-pop`, `server-tunnel-on`, `server-tunnel-off`.

#### Scenario: Read-only operations are LLM-free

- **GIVEN** the LLM-free command `dashboard-session-list.md`
- **WHEN** a user types `/dashboard:session-list`
- **THEN** the command SHALL execute via the bash pipeline without invoking the LLM, and the output SHALL render in chat.

#### Scenario: Operations requiring judgment are LLM-bound

- **GIVEN** the LLM-bound command `dashboard-session-abort-all.md`
- **WHEN** a user types `/dashboard:session-abort-all`
- **THEN** the command SHALL expand its template into a user message that the LLM interprets to decide which sessions to abort.

### Requirement: Discoverability footer for LLM-free commands

When an `executable: bash` slash command produces output, the chat client SHALL render a footer beneath the output reading exactly `ℹ ran locally — LLM not invoked` (or visually equivalent). The footer SHALL NOT appear for `bash_output` events from `!` or `!!` commands.

#### Scenario: Footer signals LLM-free execution

- **GIVEN** a user types `/dashboard:server-health` (an `executable: bash` template)
- **WHEN** the bash output is rendered in chat
- **THEN** a footer reading `ℹ ran locally — LLM not invoked` SHALL appear directly beneath the output block.

#### Scenario: No footer for ! commands

- **GIVEN** a user types `!echo hi`
- **WHEN** the bash output is rendered in chat
- **THEN** no `ℹ ran locally` footer SHALL appear.

#### Scenario: No footer for !! commands

- **GIVEN** a user types `!!echo bye`
- **WHEN** the bash output is rendered in chat
- **THEN** no `ℹ ran locally` footer SHALL appear.

### Requirement: Templates ship with the existing skill

Every dashboard slash command template SHALL ship inside `.pi/skills/pi-dashboard/commands/` in the dashboard repository. The skill's `SKILL.md` SHALL advertise the namespace and reference the commands directory. Templates SHALL NOT be installed into `~/.pi/prompts/` by default.

#### Scenario: Commands directory exists in skill bundle

- **GIVEN** the dashboard repo is checked out
- **WHEN** an inspector lists `.pi/skills/pi-dashboard/commands/`
- **THEN** the directory SHALL contain at least 30 markdown files matching `dashboard-*.md`.

### Requirement: Backward compatibility with existing slash commands

Existing slash command templates without `executable` frontmatter SHALL continue to expand into LLM user messages exactly as today. The new `slash-exec` pipeline SHALL be opt-in per template.

#### Scenario: Pre-existing template routes to LLM unchanged

- **GIVEN** a slash template without `executable` frontmatter (e.g. `/opsx:continue`)
- **WHEN** a user invokes it
- **THEN** the bridge SHALL expand the template and call `pi.sendUserMessage` (LLM-bound), with no behavioural change from before this change.

### Requirement: Routing precedence relative to extension dispatch

The exec-mode dispatch (template with `executable: bash`) SHALL run AFTER pi-extension-command dispatch (`source: "extension"` in `pi.getCommands()`, dispatched via `pi.dispatchCommand` per `command-routing` spec) and BEFORE the fallback to `pi.sendUserMessage` for skills, prompt templates, and unrecognised slashes. Extension commands and exec-mode templates are disjoint by construction (extension commands are JS handlers; exec-mode templates are `.md` files with frontmatter), so this ordering is documentary; it pins the contract for future readers.

#### Scenario: Extension command takes precedence over exec template with same name

- **GIVEN** a pi extension registers a command `foo` via `pi.registerCommand` AND a file `dashboard-foo.md` exists with `executable: bash` frontmatter
- **WHEN** a user types `/foo`
- **THEN** the bridge SHALL dispatch via `pi.dispatchCommand("/foo", ...)` (extension dispatch wins)
- **AND** SHALL NOT execute the template body as bash.

#### Scenario: Exec template takes precedence over LLM fallback

- **GIVEN** a file `dashboard-server-health.md` exists with `executable: bash` frontmatter AND no extension command named `dashboard-server-health` is registered
- **WHEN** a user types `/dashboard:server-health`
- **THEN** the bridge SHALL execute the template body as bash and emit `bash_output`
- **AND** SHALL NOT call `pi.sendUserMessage` for this input.

