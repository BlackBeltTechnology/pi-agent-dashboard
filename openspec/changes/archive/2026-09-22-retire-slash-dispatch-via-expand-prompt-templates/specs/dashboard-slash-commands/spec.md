# dashboard-slash-commands — delta

## MODIFIED Requirements

### Requirement: Routing precedence relative to extension dispatch

The exec-mode dispatch (template with `executable: bash`) SHALL run AFTER pi-extension-command dispatch (`source: "extension"` in `pi.getCommands()`, dispatched in-process via `pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs })` per `command-routing` spec) and BEFORE the fallback to `pi.sendUserMessage` for skills, prompt templates, and unrecognised slashes. Extension commands and exec-mode templates are different mechanisms (JS handlers vs `.md` files with frontmatter) but their NAMES can collide; on a collision the extension command wins, and this ordering is the contract that decides it.

#### Scenario: Extension command takes precedence over exec template with same name

- **GIVEN** a pi extension registers a command `foo` via `pi.registerCommand` AND a file `dashboard-foo.md` exists with `executable: bash` frontmatter
- **WHEN** a user types `/foo`
- **THEN** the bridge SHALL dispatch via `pi.sendUserMessage("/foo", { expandPromptTemplates: true, deliverAs })` (extension dispatch wins)
- **AND** SHALL NOT execute the template body as bash.

#### Scenario: Exec template takes precedence over LLM fallback

- **GIVEN** a file `dashboard-server-health.md` exists with `executable: bash` frontmatter AND no extension command named `dashboard-server-health` is registered
- **WHEN** a user types `/dashboard:server-health`
- **THEN** the bridge SHALL execute the template body as bash and emit `bash_output`
