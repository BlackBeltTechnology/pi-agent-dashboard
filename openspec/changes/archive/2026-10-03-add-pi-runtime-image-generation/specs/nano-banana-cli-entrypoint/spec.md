## MODIFIED Requirements

### Requirement: Argument Parsing
The CLI SHALL parse a single positional prompt plus optional flags from the process arguments, treating the first non-flag argument as the prompt.

#### Scenario: Positional prompt
- **WHEN** the CLI is invoked with a non-flag argument (e.g. `pi-nano-banana "a red logo"`)
- **THEN** that argument is used as the prompt
- **AND** any later non-flag arguments are ignored (only the first sets the prompt)

#### Scenario: Optional flags parsed
- **WHEN** the CLI is invoked with flags among `--file <path>`, `--output <path>` / `-o <path>`, `--model <id>`, `--flash`, `--api-key <key>`, `--backend <gemini|pi>`
- **THEN** each flag's following token is captured as its value, `--flash` is captured as a boolean, and the values are passed to the generation client
- **AND** unrecognized flags (tokens starting with `-`) are ignored and never treated as the prompt

#### Scenario: Invalid backend
- **WHEN** `--backend` is given a value other than `gemini` or `pi`, or is the last token with no value
- **THEN** the CLI prints the usage line to stderr and exits with code `1`

#### Scenario: Backend from the environment
- **WHEN** no `--backend` flag is given and `NANO_BANANA_BACKEND` is ` PI ` in the CLI's environment
- **THEN** the CLI selects `pi` (the value is trimmed and lower-cased)

#### Scenario: Invalid backend in the environment
- **WHEN** no `--backend` flag is given and `NANO_BANANA_BACKEND` is `openai`
- **THEN** the CLI prints `✗ NANO_BANANA_BACKEND must be gemini or pi` to stderr and exits with code `1` without generating

### Requirement: Prompt Requirement and Usage
The CLI SHALL require a prompt and SHALL print usage guidance and fail when no prompt is supplied.

#### Scenario: Missing prompt
- **WHEN** the CLI is invoked with no positional prompt (empty args or only flags)
- **THEN** it prints to stderr: `usage: pi-nano-banana "<prompt>" [--file in.png] [--output out.png] [--model id] [--flash] [--api-key KEY] [--backend gemini|pi]`
- **AND** it exits with code `1`

### Requirement: Dispatch to Generation
The CLI SHALL invoke the image-generation client with the parsed prompt, file, output, model, flash, api-key and backend values. The CLI resolves the backend as `--backend`, else `NANO_BANANA_BACKEND` from its own process environment (trimmed, lower-cased), else `gemini`, and always passes it explicitly; the client never reads that variable.

#### Scenario: Generate from prompt
- **WHEN** a prompt is provided without `--file`
- **THEN** the client is invoked with the prompt (and any output/model/flash/api-key/backend options) to generate a new image

#### Scenario: Edit existing image
- **WHEN** a prompt is provided together with `--file <path>`
- **THEN** the client is invoked with the input image path so the prompt is applied as an edit to that image

#### Scenario: Backend passed through
- **WHEN** the CLI is invoked with `--backend pi`
- **THEN** the client is invoked with `backend: "pi"`

### Requirement: Result Reporting and Exit Codes
The CLI SHALL report the generation result to the console and set the exit code based on success or failure.

#### Scenario: Successful generation
- **WHEN** the generation client returns a successful result
- **THEN** the CLI prints `✓ image generated` to stdout, appending `: <output>` when an output path was resolved
- **AND** when the result's backend is `pi` it appends ` (pi · <model>)`, and when `usage` is present ` · ~$<cost> est.` with `<cost>` = `usage.cost.total` formatted to 2 significant digits (e.g. `0.00041`); it appends nothing more when `usage` is absent
- **AND** it exits with code `0`; on the pi backend it exits explicitly only after the stdout write has flushed (so neither a retained handle after the SDK import nor `process.exit` truncation can occur), while the Gemini backend keeps today's exit behaviour

#### Scenario: Failed generation
- **WHEN** the generation client returns a failed result with an error message
- **THEN** the CLI prints `✗ generation failed: <error>` to stderr, with ` (pi)` inserted after `failed` when the result's backend is `pi`
- **AND** it exits with code `1`

#### Scenario: Missing API key
- **WHEN** no Gemini API key can be resolved from `--api-key`, environment, or a `.env` file on the Gemini backend
- **THEN** the generation result fails with an error instructing the user to set `GEMINI_API_KEY` or pass `--api-key`, mentioning `--backend pi` / `NANO_BANANA_BACKEND=pi` as the opt-in alternative
- **AND** the CLI reports the failure and exits with code `1`
