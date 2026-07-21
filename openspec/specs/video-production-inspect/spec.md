# video-production-inspect Specification

## Purpose

Provide a dry-run inspector that parses a shot package and reports what WOULD be rendered — per-shot seed, aspect ratio, resolution, prompt word count, and first-frame image state — plus missing-prompt problems, without requiring an API key or the rendering SDK. This lets a user validate extraction correctness before spending render credits.

## Requirements

### Requirement: Key-Independent Package Inspection

The system SHALL parse a shot package and produce a structured report without requiring an API key or the rendering SDK to be present.

#### Scenario: Inspecting with no key configured

- **WHEN** a package is inspected and no rendering key can be resolved
- **THEN** the report SHALL still be produced from the parsed shots
- **AND** the key state SHALL be reported as `MISSING — set one before rendering`

#### Scenario: Inspecting with a key configured

- **WHEN** a package is inspected and a rendering key is resolved
- **THEN** the key state SHALL be reported as `FOUND (<source>)`, naming the source the key was resolved from

#### Scenario: Reporting package base directory and shot count

- **WHEN** a package is inspected
- **THEN** the report SHALL include the resolved base directory of the package
- **AND** the report SHALL include the total number of shots parsed

### Requirement: Per-Shot Report Fields

For each shot in the package, the system SHALL report the shot's identity and render parameters derived directly from the parsed shot.

#### Scenario: Reporting shot render parameters

- **WHEN** a shot is inspected
- **THEN** the shot report SHALL include the shot name, title, seed, aspect ratio, and resolution
- **AND** the shot report SHALL include the enhance-prompt flag and the seamless-to-next flag

#### Scenario: Counting prompt words

- **WHEN** a shot has a prompt
- **THEN** the shot report SHALL count the prompt words as the number of whitespace-separated non-empty tokens
- **AND** WHEN a shot has no prompt, the prompt word count SHALL be `0`

#### Scenario: Reporting image state

- **WHEN** a shot is inspected
- **THEN** the shot report SHALL include whether a first-frame image is present and the reference image list
- **AND** the shot report SHALL record whether the shot has a prompt and whether it has a negative prompt

### Requirement: Missing-Prompt Problem Detection

The system SHALL detect shots that lack a parseable Full Veo prompt block and collect them as problems.

#### Scenario: Shot missing a prompt is flagged as a problem

- **WHEN** a shot has no prompt
- **THEN** its name SHALL be added to the report's problems list

#### Scenario: Shot with a prompt is not a problem

- **WHEN** a shot has a prompt
- **THEN** its name SHALL NOT appear in the report's problems list

### Requirement: Human-Readable Table Formatting

The system SHALL render an inspection report as a human-readable table matching the original tool's output.

#### Scenario: Formatting the package header

- **WHEN** a report is formatted
- **THEN** the output SHALL begin with a `Package :` line, an `API key :` line, and a `Shots   :` count line

#### Scenario: Formatting a shot row

- **WHEN** a shot is formatted
- **THEN** its row SHALL show the padded name, `seed=`, aspect ratio, padded resolution, `prompt=<n>w`, `first=` with the basename of the first-frame image (or `—` when absent), and `ref=` with the basenames of reference images (or `—` when none)
- **AND** the shot title SHALL be printed on the following line

#### Scenario: Formatting shot flags

- **WHEN** a shot lacks a prompt, lacks a negative prompt, or flows seamlessly into the next
- **THEN** the row SHALL append a bracketed flag list containing `NO-PROMPT`, `no-negative`, and/or `seamless→next` as applicable

#### Scenario: Formatting the has-problems outcome

- **WHEN** the report has one or more problems
- **THEN** the output SHALL end with a warning line stating the count of shots that had no parseable Full Veo prompt

#### Scenario: Formatting the clean-package outcome

- **WHEN** the report has no problems
- **THEN** the output SHALL end with `✓ All shots have a Full Veo prompt block.`
