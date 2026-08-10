# video-production-env Specification

## Purpose

Resolve the Veo/Gemini API key used by the video-production package from an ordered set of sources, returning both the key value (or `undefined`) and a human-readable description of where it came from.

## Requirements

### Requirement: API Key Source Precedence

The system SHALL resolve the API key from candidate sources in a fixed precedence order and return the first non-empty value found, along with a source label describing its origin.

The precedence order SHALL be:
1. explicit CLI key argument
2. process environment variables
3. project-local `.env` files (base directory and up to two parent directories)
4. package-global `.env` file

#### Scenario: CLI key takes highest precedence

- **WHEN** an explicit CLI key is supplied
- **THEN** the system SHALL return that key with source `--api-key flag`
- **AND** SHALL NOT consult process environment or any `.env` file

#### Scenario: Process environment used when no CLI key

- **WHEN** no CLI key is supplied
- **AND** a matching variable exists in the process environment
- **THEN** the system SHALL return that value with source `env:<NAME>` where `<NAME>` is the matched variable name
- **AND** SHALL NOT consult any `.env` file

#### Scenario: Project `.env` used before package `.env`

- **WHEN** no CLI key and no matching process environment variable exist
- **AND** a matching key exists in a project-local `.env`
- **THEN** the system SHALL return that value before consulting the package-global `.env`

### Requirement: Accepted Key Names

The system SHALL accept the key names `VEO_API_KEY`, `GEMINI_API_KEY`, and `GOOGLE_API_KEY`, checked in that priority order within any single source.

#### Scenario: VEO_API_KEY preferred over other names

- **WHEN** a single source contains more than one of `VEO_API_KEY`, `GEMINI_API_KEY`, or `GOOGLE_API_KEY`
- **THEN** the system SHALL return `VEO_API_KEY` in preference to `GEMINI_API_KEY`, and `GEMINI_API_KEY` in preference to `GOOGLE_API_KEY`

#### Scenario: Fallback key names honored

- **WHEN** a source contains `GEMINI_API_KEY` or `GOOGLE_API_KEY` but not `VEO_API_KEY`
- **THEN** the system SHALL return the highest-priority name present in that source

### Requirement: Project and Package `.env` Search

The system SHALL search for a project-local `.env` in the base directory, its parent, and its grandparent (nearest first, without duplicate directories). If no key is found and the package directory differs from the base directory, the system SHALL then read the package-global `.env`.

#### Scenario: Nearest project `.env` wins

- **WHEN** no CLI key or process environment key exists
- **AND** multiple `.env` files up the directory chain contain matching keys
- **THEN** the system SHALL return the key from the nearest directory first
- **AND** SHALL report the source as the full `.env` path with the matched key name in parentheses

#### Scenario: Package `.env` consulted only when distinct

- **WHEN** the resolved package directory equals the base directory
- **THEN** the system SHALL NOT perform a separate package-global `.env` read

#### Scenario: Package `.env` fallback

- **WHEN** no key is found in the CLI argument, process environment, or any project-local `.env`
- **AND** the package directory differs from the base directory
- **AND** the package-global `.env` contains a matching key
- **THEN** the system SHALL return that value with the package `.env` path and matched key name as the source

### Requirement: `.env` Parsing

The system SHALL parse `.env` files as `KEY=VALUE` lines, ignoring blank lines, comment lines beginning with `#`, and lines without `=`. It SHALL strip a leading `export ` prefix and remove a single pair of matching surrounding single or double quotes from the value.

#### Scenario: Comments and blanks ignored

- **WHEN** a `.env` file contains blank lines or lines starting with `#`
- **THEN** the system SHALL ignore those lines when extracting keys

#### Scenario: Export prefix and quotes stripped

- **WHEN** a `.env` line is `export VEO_API_KEY="abc"`
- **THEN** the system SHALL treat the key as `VEO_API_KEY` and the value as `abc` without the `export ` prefix or surrounding quotes

#### Scenario: Unreadable `.env` treated as empty

- **WHEN** a `.env` file is missing or cannot be read in a searched directory
- **THEN** the system SHALL treat that directory as containing no keys and continue searching

### Requirement: No-Key-Found Result

The system SHALL return an undefined key with a descriptive source when no source yields a value.

#### Scenario: No key available anywhere

- **WHEN** no CLI key, process environment variable, project `.env`, or package `.env` provides a matching key
- **THEN** the system SHALL return an undefined key value with source `not found`
