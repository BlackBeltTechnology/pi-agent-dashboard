## ADDED Requirements

### Requirement: Frontmatter directive enables executable mode

A prompt template MAY declare `executable: bash` in its YAML frontmatter to opt into the executable-mode pipeline. When present, the bridge SHALL render the body as bash via `pi.exec("sh", ["-c", body, "--", ...args])`, emit a `bash_output` event with `data.source: "slash-exec"`, and SHALL NOT call the LLM.

#### Scenario: Template with executable: bash skips the LLM

- **GIVEN** a prompt template `~/.pi/skills/foo/commands/bar.md` with frontmatter `executable: bash`
- **WHEN** a user types `/foo:bar`
- **THEN** the bridge SHALL execute the template body as bash, emit a `bash_output` event, and SHALL NOT call `pi.sendUserMessage` or otherwise invoke the LLM.

#### Scenario: Template without executable frontmatter routes to LLM

- **GIVEN** a prompt template without `executable` frontmatter
- **WHEN** a user types the matching slash command
- **THEN** the bridge SHALL expand the template and call `pi.sendUserMessage` (LLM pipeline) exactly as today.

#### Scenario: Unsupported executable value falls back to LLM

- **GIVEN** a prompt template with frontmatter `executable: node`
- **WHEN** a user types the matching slash command
- **THEN** the bridge SHALL treat the template as LLM-bound (since v1 only supports `bash`), preserving forward compatibility.

### Requirement: excludeFromContext defaults to true for executable templates

A template carrying `executable: bash` SHALL default to `excludeFromContext: true` (the output is not appended to LLM context, mirroring `!!` semantics). Authors MAY override with `excludeFromContext: false` to capture the output for follow-up reasoning.

#### Scenario: Default behaviour mirrors !! semantics

- **GIVEN** a template with `executable: bash` and no `excludeFromContext` field
- **WHEN** the user invokes the command
- **THEN** the bridge SHALL emit `bash_output` only and SHALL NOT also call `pi.sendUserMessage` with the result.

#### Scenario: Author opts in to LLM follow-up

- **GIVEN** a template with `executable: bash` and `excludeFromContext: false`
- **WHEN** the user invokes the command
- **THEN** the bridge SHALL emit `bash_output` AND call `pi.sendUserMessage` with the same content (mirroring `!` semantics).

### Requirement: Positional argument substitution

Arguments supplied after the slash command SHALL be passed as positional shell parameters (`$1`, `$2`, ...) inside the bash body. The bridge SHALL invoke `pi.exec("sh", ["-c", body, "--", ...args])` where `args` is the user-supplied argument string split on whitespace and filtered for empty tokens.

#### Scenario: Single positional arg

- **GIVEN** a template body `echo "id=$1"` and the user types `/foo:bar abc123`
- **THEN** the rendered output SHALL be `id=abc123`.

#### Scenario: Multiple positional args

- **GIVEN** a template body `echo "$1 $2"` and the user types `/foo:bar one two`
- **THEN** the rendered output SHALL be `one two`.

#### Scenario: No args

- **GIVEN** a template body that does not reference any positional parameter and the user types `/foo:bar`
- **THEN** the body SHALL execute with `$#` equal to 0.

### Requirement: Dashboard env vars injected for ergonomics

The bridge SHALL inject `PI_DASHBOARD_PORT` and `PI_DASHBOARD_BASE` environment variables into the exec environment for executable-mode templates. `PI_DASHBOARD_PORT` SHALL be read from `~/.pi/dashboard/config.json` (defaulting to `8000` when absent or unparseable). `PI_DASHBOARD_BASE` SHALL equal `http://localhost:$PI_DASHBOARD_PORT`.

#### Scenario: Templates can use $PI_DASHBOARD_BASE without setup

- **GIVEN** a template body containing `curl -s "$PI_DASHBOARD_BASE/api/health"` and the user types the matching slash command
- **THEN** the curl SHALL hit the running dashboard's health endpoint without the template having to grep `~/.pi/dashboard/config.json` first.

### Requirement: bash_output event carries slash-exec source field

The `bash_output` event payload SHALL include an optional `source` field set to the literal string `"slash-exec"` when the event originates from an executable-mode slash template. The field SHALL be absent for `!` / `!!` bash invocations, preserving backward compatibility for older clients.

#### Scenario: Source field present for slash-exec

- **GIVEN** an executable-mode template runs and emits `bash_output`
- **THEN** the event's `data` object SHALL contain `source: "slash-exec"`.

#### Scenario: Source field absent for ! and !!

- **GIVEN** the user types `!echo hi` or `!!echo bye`
- **THEN** the emitted `bash_output` event's `data` object SHALL NOT contain a `source` field, OR the field SHALL have a value other than `"slash-exec"`.

### Requirement: Frontmatter parser is forward-compatible

The frontmatter parser SHALL ignore unknown keys (no error, no abort) so future versions can add fields like `format:`, `description:`, or `priority:` without breaking older bridges. Malformed YAML in the frontmatter block SHALL cause the template to fall back to LLM mode (treat the template as having no frontmatter) rather than throw.

#### Scenario: Unknown key is ignored

- **GIVEN** a template with frontmatter `executable: bash\nfutureField: 42`
- **WHEN** the parser reads it
- **THEN** the template SHALL be treated as `kind: "exec"` and `futureField` SHALL be ignored without error.

#### Scenario: Malformed frontmatter falls back gracefully

- **GIVEN** a template whose frontmatter block is unclosed (`---\nexecutable: bash\n` without trailing `---`)
- **WHEN** the parser reads it
- **THEN** the template SHALL fall back to LLM mode and the bridge SHALL NOT throw.
