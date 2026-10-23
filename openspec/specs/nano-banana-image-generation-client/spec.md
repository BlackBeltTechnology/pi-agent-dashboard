# nano-banana-image-generation-client Specification

## Purpose
Provide a programmatic wrapper around the `@the-focus-ai/nano-banana` image-generation CLI. It resolves a Gemini API key from multiple sources, generates or edits single images, and runs bounded-concurrency batch jobs, reporting a structured result for each operation.

## Requirements

### Requirement: Gemini API Key Resolution
On the Gemini backend (the default; see `nano-banana-pi-backend`) the client SHALL resolve a Gemini API key from an ordered set of sources and SHALL fail image generation when no key can be found. The pi backend SHALL NOT resolve a Gemini key.

#### Scenario: Explicit key takes precedence
- **WHEN** an explicit key is passed (e.g. `--api-key` / `cliKey`)
- **THEN** that key is used
- **AND** the reported source is `--api-key flag`

#### Scenario: Environment variable fallback
- **WHEN** no explicit key is given and the environment contains `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- **THEN** the first matching variable in that order is used
- **AND** the reported source is `env:<NAME>`

#### Scenario: Project-local .env fallback
- **WHEN** no explicit or environment key exists
- **THEN** a `.env` file is searched in the base directory and up to two parent directories, nearest first, for `GEMINI_API_KEY` then `GOOGLE_API_KEY`
- **AND** the first match is used with source `<dir>/.env (<NAME>)`

#### Scenario: Package-global .env fallback
- **WHEN** no explicit, environment, or project-local key exists
- **THEN** the package directory `.env` is searched last for `GEMINI_API_KEY` then `GOOGLE_API_KEY`

#### Scenario: No key found
- **WHEN** no key is resolved from any source on the Gemini backend
- **THEN** generation returns `ok: false`
- **AND** the error instructs the caller to set `GEMINI_API_KEY` in the environment, a gitignored `.env`, or pass `apiKey`/`--api-key`, and mentions the opt-in alternative `backend: "pi"` (CLI `--backend pi` / `NANO_BANANA_BACKEND=pi`) with an OpenRouter credential in pi
- **AND** pi SHALL NOT be imported

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

### Requirement: Single Generation Result and Failure Handling
On the Gemini backend the client SHALL report success only when the CLI exits successfully and any expected output file exists, and SHALL otherwise report a bounded error message. Pi-backend results and failures follow `nano-banana-pi-backend`. On either backend the client SHALL resolve, never reject, for generation failures.

#### Scenario: Successful generation
- **WHEN** the CLI exits with code 0 on the Gemini backend
- **AND** either no output path was requested or the output file exists
- **THEN** the result is `ok: true` with the `output` path and `backend: "gemini"`

#### Scenario: Failure with stderr
- **WHEN** the CLI exits non-zero or the expected output file is missing
- **THEN** the result is `ok: false`
- **AND** the error is the trimmed stderr tail truncated to 400 characters

#### Scenario: Failure without stderr
- **WHEN** the CLI fails and produces no stderr
- **THEN** the error falls back to `exit code <code> (key via <source>)`
- **AND** every result of a generation that ran on this backend, success or failure, carries `backend: "gemini"`

### Requirement: Bounded-Concurrency Batch Generation
The client SHALL run many generation jobs with a bounded number of concurrent workers, aggregate per-job results, and optionally skip jobs whose output already exists. The backend is resolved once per batch (see `nano-banana-pi-backend`).

#### Scenario: Concurrency limit
- **WHEN** a batch of jobs runs
- **THEN** no more than `concurrency` generations run at once
- **AND** `concurrency` defaults to 3 and is clamped to at least 1

#### Scenario: Skip existing outputs
- **WHEN** `force` is not set and a job's output file already exists
- **THEN** that job is not regenerated
- **AND** its result is `ok: true` with `skipped: true` and no `backend`

#### Scenario: Force regeneration
- **WHEN** `force` is set
- **THEN** every job is generated regardless of an existing output file

#### Scenario: Per-job progress and aggregation
- **WHEN** each job completes
- **THEN** an optional `onResult` callback is invoked with that job's result
- **AND** the batch returns one result per job, each carrying the job `name` and its `ok`/`output`/`error`/`skipped` fields, plus `backend` for jobs that ran

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
