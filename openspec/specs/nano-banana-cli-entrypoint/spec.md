# nano-banana-cli-entrypoint Specification

## Purpose
The `pi-nano-banana` CLI parses a text prompt and optional flags from the command line, then dispatches to the image-generation client to generate or edit a Gemini image. It reports success or failure to the console and sets a process exit code accordingly.

## Requirements

### Requirement: Argument Parsing
The CLI SHALL parse a single positional prompt plus optional flags from the process arguments, treating the first non-flag argument as the prompt.

#### Scenario: Positional prompt
- **WHEN** the CLI is invoked with a non-flag argument (e.g. `pi-nano-banana "a red logo"`)
- **THEN** that argument is used as the prompt
- **AND** any later non-flag arguments are ignored (only the first sets the prompt)

#### Scenario: Optional flags parsed
- **WHEN** the CLI is invoked with flags among `--file <path>`, `--output <path>` / `-o <path>`, `--model <id>`, `--flash`, `--api-key <key>`
- **THEN** each flag's following token is captured as its value, `--flash` is captured as a boolean, and the values are passed to the generation client
- **AND** unrecognized flags (tokens starting with `-`) are ignored and never treated as the prompt

### Requirement: Prompt Requirement and Usage
The CLI SHALL require a prompt and SHALL print usage guidance and fail when no prompt is supplied.

#### Scenario: Missing prompt
- **WHEN** the CLI is invoked with no positional prompt (empty args or only flags)
- **THEN** it prints to stderr: `usage: pi-nano-banana "<prompt>" [--file in.png] [--output out.png] [--model id] [--flash] [--api-key KEY]`
- **AND** it exits with code `1`

### Requirement: Dispatch to Generation
The CLI SHALL invoke the image-generation client with the parsed prompt, file, output, model, flash, and api-key values.

#### Scenario: Generate from prompt
- **WHEN** a prompt is provided without `--file`
- **THEN** the client is invoked with the prompt (and any output/model/flash/api-key options) to generate a new image

#### Scenario: Edit existing image
- **WHEN** a prompt is provided together with `--file <path>`
- **THEN** the client is invoked with the input image path so the prompt is applied as an edit to that image

### Requirement: Result Reporting and Exit Codes
The CLI SHALL report the generation result to the console and set the exit code based on success or failure.

#### Scenario: Successful generation
- **WHEN** the generation client returns a successful result
- **THEN** the CLI prints `✓ image generated` to stdout, appending `: <output>` when an output path was resolved
- **AND** it exits with code `0`

#### Scenario: Failed generation
- **WHEN** the generation client returns a failed result with an error message
- **THEN** the CLI prints `✗ generation failed: <error>` to stderr
- **AND** it exits with code `1`

#### Scenario: Missing API key
- **WHEN** no Gemini API key can be resolved from `--api-key`, environment, or a `.env` file
- **THEN** the generation result fails with an error instructing the user to set `GEMINI_API_KEY` or pass `--api-key`
- **AND** the CLI reports the failure and exits with code `1`
