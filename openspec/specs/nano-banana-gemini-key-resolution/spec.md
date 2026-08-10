# nano-banana-gemini-key-resolution Specification

## Purpose
Resolve the Gemini API key from an ordered set of sources so callers can authenticate without hardcoding secrets. The first non-empty source in precedence order wins, and the chosen source is reported back for transparency.

## Requirements

### Requirement: Ordered key resolution precedence
The resolver SHALL select the API key from the first source that yields a non-empty value, following a fixed precedence order: an explicitly supplied key, then process environment variables, then a project-local `.env` file, then a package-global `.env` file.

#### Scenario: Explicit key overrides all other sources
- **WHEN** an explicit key is supplied (e.g. via the `--api-key` CLI flag)
- **THEN** that key is returned
- **AND** no environment variables or `.env` files are consulted

#### Scenario: Environment variable used when no explicit key
- **WHEN** no explicit key is supplied but `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set in the process environment
- **THEN** the environment value is returned
- **AND** `GEMINI_API_KEY` takes priority over `GOOGLE_API_KEY` when both are set

#### Scenario: Project-local `.env` used when environment is unset
- **WHEN** no explicit key and no environment variable is present, but a project-local `.env` file defines a supported key
- **THEN** the value from that `.env` file is returned

#### Scenario: Package-global `.env` used as final fallback
- **WHEN** no explicit key, environment variable, or project-local `.env` value is found, but a `.env` file adjacent to the package defines a supported key
- **THEN** the value from the package-global `.env` file is returned
- **AND** the package-global `.env` is skipped when it resolves to the same location already searched as project-local

### Requirement: Supported key names
The resolver SHALL accept the key under either of two recognized names, checking `GEMINI_API_KEY` before `GOOGLE_API_KEY` within any single source.

#### Scenario: Preferred name wins within one source
- **WHEN** a single source (environment or a `.env` file) defines both `GEMINI_API_KEY` and `GOOGLE_API_KEY`
- **THEN** the value of `GEMINI_API_KEY` is returned

#### Scenario: Alternate name accepted
- **WHEN** a source defines only `GOOGLE_API_KEY`
- **THEN** the value of `GOOGLE_API_KEY` is returned

### Requirement: Project-local `.env` discovery
The resolver SHALL search for a project-local `.env` starting from the base directory (defaulting to the current working directory) and continuing upward through its parent and grandparent directories, nearest first, without searching the same directory twice.

#### Scenario: Nearest directory takes precedence
- **WHEN** both the base directory and a parent directory contain a `.env` with a supported key
- **THEN** the value from the base directory `.env` is returned

#### Scenario: Key inherited from an ancestor directory
- **WHEN** the base directory has no `.env` value but a parent or grandparent directory `.env` defines a supported key
- **THEN** the value from the nearest ancestor `.env` is returned

### Requirement: `.env` file parsing
The resolver SHALL interpret a `.env` file as newline-separated `KEY=VALUE` entries, ignoring blank lines and comment lines, tolerating an `export` prefix, and stripping a single matching pair of surrounding single or double quotes from the value. Missing or unreadable `.env` files SHALL be treated as containing no keys.

#### Scenario: Comments, blanks, and export prefix
- **WHEN** a `.env` file contains blank lines, lines beginning with `#`, and an entry written as `export GEMINI_API_KEY=abc`
- **THEN** the blank and comment lines are ignored
- **AND** the key `GEMINI_API_KEY` resolves to the value `abc`

#### Scenario: Quoted values are unwrapped
- **WHEN** a `.env` entry wraps its value in matching single or double quotes
- **THEN** the surrounding quotes are removed from the returned value

#### Scenario: Absent `.env` file is not an error
- **WHEN** a searched directory has no `.env` file or the file cannot be read
- **THEN** that directory contributes no key and resolution continues with remaining sources

### Requirement: Resolved source reporting
The resolver SHALL return, alongside the key, a human-readable description identifying which source provided it, and SHALL indicate when no key was found.

#### Scenario: Source identifies the origin
- **WHEN** a key is resolved from an environment variable
- **THEN** the reported source names that environment variable
- **AND** when resolved from a `.env` file, the reported source names the file path and the key name used

#### Scenario: No key available
- **WHEN** no explicit key, environment variable, or `.env` file yields a supported key
- **THEN** the resolver returns no key
- **AND** reports the source as not found
