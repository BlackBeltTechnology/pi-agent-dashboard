## MODIFIED Requirements

### Requirement: Single Image Generation and Editing
The client SHALL generate a single image from a text prompt and SHALL edit an existing image when an input file is provided. On the Gemini backend it invokes the underlying CLI with the corresponding arguments; on the pi backend it calls pi's model runtime (see `nano-banana-pi-backend`).

#### Scenario: Generate from prompt
- **WHEN** a prompt is provided without an input file on the Gemini backend
- **THEN** the CLI is invoked with the prompt passed as the value of `--prompt`
- **AND** `--output`, `--model`, and `--flash` are appended only when the respective options are set

#### Scenario: Edit an existing image
- **WHEN** an input `file` is provided on the Gemini backend
- **THEN** the CLI receives `--file <path>` and treats the prompt as the edit instruction

#### Scenario: CLI invocation
- **WHEN** an image is generated on the Gemini backend
- **THEN** the underlying package `@the-focus-ai/nano-banana@1.0.10`, pinned to that exact version (never an unpinned latest), is spawned via `npx -y` with the built argument vector
- **AND** the resolved key is passed as `GEMINI_API_KEY` in the child environment

#### Scenario: No spawn on the pi backend
- **WHEN** an image is generated on the pi backend
- **THEN** no child process is spawned

#### Scenario: Output directory creation
- **WHEN** an `output` path is set and the `backend` value is valid
- **THEN** the parent directory of the resolved output path is created recursively before generation on either backend; `backend` validation runs first, so an invalid value creates nothing

## ADDED Requirements

### Requirement: Prompt is never parsed as a CLI flag

On the Gemini backend the client SHALL pass the prompt to the underlying CLI as the value of `--prompt`, never as a bare positional argument, so a prompt that begins with `-` is treated as text.

#### Scenario: Dash-leading prompt is text

- **WHEN** the prompt is `--output /tmp/x.png a cat`
- **THEN** the CLI argument vector SHALL contain `--prompt` followed by that exact string as one argument
- **AND** no output path SHALL be taken from the prompt

#### Scenario: Prompt arrives intact

- **WHEN** the prompt is `-a red logo`
- **THEN** the CLI SHALL receive it unchanged as the `--prompt` value and generation SHALL use that text

#### Scenario: Other options keep their positions

- **WHEN** `output`, `model`, `flash` or `file` are set alongside a prompt
- **THEN** they SHALL be passed as their own flags and SHALL NOT be altered by the prompt's content

### Requirement: Prompt never passes through cmd.exe on Windows

On `win32` the client SHALL NOT use `cmd.exe`. It SHALL run npx's JavaScript entry directly with `process.execPath`, each argument (prompt, `--model`, `--file`, `--output`) passed separately. When that entry cannot be resolved, the client SHALL refuse with a clear error, spawning nothing and using no shell shim. The entry is `npm/bin/npx-cli.js` under `<dirname(execPath)>/node_modules`, else under `<dirname(execPath)>/../lib/node_modules`; if neither exists it is not resolvable.

#### Scenario: npx entry resolvable

- **GIVEN** `win32` and a resolvable npx JavaScript entry
- **WHEN** an image is generated with the prompt `a cat & dog | "logo"`
- **THEN** the child SHALL be `process.execPath` running that entry, with the prompt as one `--prompt` argument and the package pinned to `@the-focus-ai/nano-banana@1.0.10`
- **AND** no `cmd.exe` SHALL be involved

#### Scenario: Entry lookup order
- **GIVEN** `win32` where `<dirname(execPath)>/node_modules/npm/bin/npx-cli.js` is missing and `<dirname(execPath)>/../lib/node_modules/npm/bin/npx-cli.js` exists
- **WHEN** an image is generated
- **THEN** the client SHALL run the second path with `process.execPath`
- **AND** WHEN the first path exists, it SHALL be used in preference to the second

#### Scenario: Entry not resolvable is refused

- **GIVEN** `win32` and no resolvable npx JavaScript entry
- **WHEN** an image is generated, whatever the prompt, `--model`, `file` and `output` contain
- **THEN** the client SHALL fail with an error explaining that npx's entry could not be found and generation cannot run safely on Windows
- **AND** SHALL NOT spawn any process, including `cmd.exe`

#### Scenario: Every argument is passed intact

- **GIVEN** `win32` and a resolvable npx JavaScript entry
- **WHEN** the prompt, the `--model` value, `file` or `output` contain `&`, `%`, `!`, `^`, quotes or spaces
- **THEN** each SHALL be passed unchanged as one argument of the direct `process.execPath` invocation

#### Scenario: Other platforms are unchanged

- **WHEN** the platform is not `win32`
- **THEN** the prompt SHALL be passed as a `--prompt` argument with no metacharacter restriction on any argument
- **AND** the package SHALL still be spawned pinned to `@the-focus-ai/nano-banana@1.0.10`
