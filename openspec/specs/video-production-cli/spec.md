# video-production-cli Specification

## Purpose

The `pi-veo` CLI parses command-line arguments into a subcommand plus flags and dispatches to one of four subcommands over a Veo shot package: `parse` (dry-run inspector), `plan` (resolve and print the render plan without API calls), `render` (render shots to mp4 via the Veo API), and `storyboard` (generate first-frame sketches). It reports human-readable or JSON output to stdout, errors to stderr, and communicates outcome through process exit codes.

## Requirements

### Requirement: Subcommand dispatch

The CLI SHALL treat the first positional argument as the subcommand and route the remaining arguments to the matching handler. The recognized subcommands are `parse`, `plan`, `render`, and `storyboard`.

#### Scenario: Parse subcommand runs the inspector

- WHEN the CLI is invoked with `parse <target>`
- THEN it inspects the shot package and prints a report without calling the Veo API or requiring an API key

#### Scenario: Plan subcommand prints the render plan as a dry run

- WHEN the CLI is invoked with `plan <target>`
- THEN it internally sets the `dry-run` behavior and prints the resolved render plan without making API calls

#### Scenario: Render subcommand renders shots

- WHEN the CLI is invoked with `render <target>`
- THEN it resolves the render plan and, unless `--dry-run` is set, calls the Veo API to render shots to mp4

#### Scenario: Storyboard subcommand generates sketches

- WHEN the CLI is invoked with `storyboard <target>`
- THEN it generates first-frame sketch PNGs for the package's sketch prompts

#### Scenario: Unknown subcommand prints usage and fails

- WHEN the CLI is invoked with a subcommand that is not `parse`, `plan`, `render`, or `storyboard`
- THEN it prints a usage message listing the four subcommands to stderr
- AND it exits with code 1

### Requirement: Flag parsing

The CLI SHALL parse arguments into positionals, list flags, value flags, and boolean flags. Arguments not beginning with `--` are positionals. `--shots` and `--only` are list flags that consume all following arguments until the next `--` flag. `--model`, `--resolution`, `--out`, `--parallel`, `--poll`, `--workers`, and `--api-key` are value flags consuming exactly the next argument. Any other `--` argument is a boolean flag.

#### Scenario: List flag consumes multiple values

- WHEN an argument list contains `--shots 01 03A` followed by another `--` flag or the end of arguments
- THEN both `01` and `03A` are collected as the `shots` list

#### Scenario: Value flag consumes one argument

- WHEN an argument list contains `--model fast`
- THEN `fast` is stored as the value of the `model` flag

#### Scenario: Boolean flag is a presence toggle

- WHEN an argument list contains `--dry-run`
- THEN the `dry-run` flag is recorded as present with no consumed value

### Requirement: Required target

Every subcommand SHALL require a `<target>` positional argument identifying a project dir, video_production dir, or shots dir.

#### Scenario: Missing target aborts

- WHEN a subcommand is invoked with no positional target
- THEN it prints `error: missing <target>` guidance to stderr
- AND it exits with code 1

### Requirement: Exit-code and reporting semantics

The CLI SHALL exit 0 on success and exit 1 when a subcommand reports problems or errors. Reports and progress go to stdout; error and problem messages go to stderr.

#### Scenario: Parse reports problems and fails

- WHEN `parse` inspects a package in which one or more shots lack a Full Veo prompt block
- THEN the report is printed to stdout
- AND the CLI exits with code 1

#### Scenario: Parse succeeds when all shots have prompts

- WHEN `parse` inspects a package where every shot has a prompt
- THEN the report is printed
- AND the CLI exits with code 0

#### Scenario: Parse emits JSON when requested

- WHEN `parse <target> --json` is invoked
- THEN the report is printed as indented JSON instead of the human-readable table

#### Scenario: Render aborts on shots missing a prompt block

- WHEN `render` resolves a plan in which some shots have no Full Veo prompt block
- THEN it prints an error listing those shots to stderr
- AND it exits with code 1

#### Scenario: Render reports errors from the render loop

- WHEN `render` executes and one or more shots finish with an error status
- THEN the CLI exits with code 1

#### Scenario: Storyboard reports per-shot outcomes and fails on any failure

- WHEN `storyboard` generates sketches and at least one result is not ok
- THEN each result is reported to stdout as skipped, succeeded, or failed
- AND the CLI exits with code 1

#### Scenario: Uncaught error is reported and fails

- WHEN any subcommand throws an unhandled error
- THEN the CLI prints `error: <message>` to stderr
- AND it exits with code 1

### Requirement: Render plan and dry-run

The `render` subcommand SHALL print the resolved plan (package dir, output dir, model, API-key state, and shot count) before rendering, and SHALL make no API calls when `--dry-run` is set (as `plan` always does).

#### Scenario: Dry run lists intended renders without calling the API

- WHEN `render <target> --dry-run` or `plan <target>` is invoked
- THEN it prints a `would render` line per shot with the shot name, output path, seed, aspect ratio, resolution, and first-frame source
- AND it prints that no API calls were made
- AND it exits with code 0
