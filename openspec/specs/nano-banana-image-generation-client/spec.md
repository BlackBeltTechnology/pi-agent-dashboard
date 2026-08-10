# nano-banana-image-generation-client Specification

## Purpose
Provide a programmatic wrapper around the `@the-focus-ai/nano-banana` image-generation CLI. It resolves a Gemini API key from multiple sources, generates or edits single images, and runs bounded-concurrency batch jobs, reporting a structured result for each operation.

## Requirements

### Requirement: Gemini API Key Resolution
The client SHALL resolve a Gemini API key from an ordered set of sources and SHALL fail image generation when no key can be found.

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
- **WHEN** no key is resolved from any source
- **THEN** generation returns `ok: false`
- **AND** the error instructs the caller to set `GEMINI_API_KEY` in the environment, a gitignored `.env`, or pass `apiKey`/`--api-key`

### Requirement: Single Image Generation and Editing
The client SHALL generate a single image from a text prompt and SHALL edit an existing image when an input file is provided, invoking the underlying CLI with the corresponding arguments.

#### Scenario: Generate from prompt
- **WHEN** a prompt is provided without an input file
- **THEN** the CLI is invoked with the prompt as the first argument
- **AND** `--output`, `--model`, and `--flash` are appended only when the respective options are set

#### Scenario: Edit an existing image
- **WHEN** an input `file` is provided
- **THEN** the CLI receives `--file <path>` and treats the prompt as the edit instruction

#### Scenario: CLI invocation
- **WHEN** an image is generated
- **THEN** the underlying `@the-focus-ai/nano-banana` package is spawned via `npx -y` with the built argument vector
- **AND** the resolved key is passed as `GEMINI_API_KEY` in the child environment

#### Scenario: Output directory creation
- **WHEN** an `output` path is set
- **THEN** the parent directory of the resolved output path is created recursively before invocation

### Requirement: Single Generation Result and Failure Handling
The client SHALL report success only when the CLI exits successfully and any expected output file exists, and SHALL otherwise report a bounded error message.

#### Scenario: Successful generation
- **WHEN** the CLI exits with code 0
- **AND** either no output path was requested or the output file exists
- **THEN** the result is `ok: true` with the `output` path

#### Scenario: Failure with stderr
- **WHEN** the CLI exits non-zero or the expected output file is missing
- **THEN** the result is `ok: false`
- **AND** the error is the trimmed stderr tail truncated to 400 characters

#### Scenario: Failure without stderr
- **WHEN** the CLI fails and produces no stderr
- **THEN** the error falls back to `exit code <code> (key via <source>)`

### Requirement: Bounded-Concurrency Batch Generation
The client SHALL run many generation jobs with a bounded number of concurrent workers, aggregate per-job results, and optionally skip jobs whose output already exists.

#### Scenario: Concurrency limit
- **WHEN** a batch of jobs runs
- **THEN** no more than `concurrency` generations run at once
- **AND** `concurrency` defaults to 3 and is clamped to at least 1

#### Scenario: Skip existing outputs
- **WHEN** `force` is not set and a job's output file already exists
- **THEN** that job is not regenerated
- **AND** its result is `ok: true` with `skipped: true`

#### Scenario: Force regeneration
- **WHEN** `force` is set
- **THEN** every job is generated regardless of an existing output file

#### Scenario: Per-job progress and aggregation
- **WHEN** each job completes
- **THEN** an optional `onResult` callback is invoked with that job's result
- **AND** the batch returns one result per job, each carrying the job `name` and its `ok`/`output`/`error`/`skipped` fields
