# electron-cdp-debug-activation Specification

## Purpose

Decide whether the Electron main process enables Chromium's Chrome DevTools Protocol (CDP) debug surface, and on which TCP port, based on process argv and environment. The debug surface is opt-in and disabled by default; both a CLI flag and an environment variable can activate it, with the CLI flag taking precedence.

## Requirements

### Requirement: CDP activation from CLI flag and environment variable

The system SHALL resolve CDP activation from the `--debug-cdp` CLI flag and the `PI_DEBUG_CDP` environment variable, defaulting to disabled when neither requests activation, and SHALL prefer the CLI flag over the environment variable when both are present.

#### Scenario: Disabled by default

- **WHEN** neither the `--debug-cdp` flag is present in argv nor `PI_DEBUG_CDP` is set in the environment
- **THEN** CDP activation is disabled
- **AND** no port is reported

#### Scenario: Enabled by bare CLI flag on default port

- **WHEN** argv contains the bare `--debug-cdp` flag with no value
- **THEN** CDP activation is enabled
- **AND** the port is the default port `9222`

#### Scenario: Enabled by environment variable truthy value on default port

- **WHEN** `PI_DEBUG_CDP` is set to a truthy value `1` or `true` (case-insensitive, surrounding whitespace ignored)
- **THEN** CDP activation is enabled
- **AND** the port is the default port `9222`

#### Scenario: Disabled by explicit falsy environment value

- **WHEN** `PI_DEBUG_CDP` is set to an empty string, `0`, or `false` (case-insensitive, surrounding whitespace ignored)
- **THEN** CDP activation is disabled
- **AND** no port is reported

#### Scenario: CLI flag overrides environment variable

- **WHEN** the `--debug-cdp` flag is present in argv and `PI_DEBUG_CDP` is also set in the environment
- **THEN** the CLI flag determines the outcome and the environment variable is ignored

### Requirement: Explicit port selection and validation

The system SHALL accept an explicit port supplied via `--debug-cdp=<port>` or `PI_DEBUG_CDP=<port>`, accepting only integer values in the range `1` to `65535`, and SHALL fall back to the default port `9222` while remaining enabled when the supplied port value is missing or invalid.

#### Scenario: Valid explicit port via CLI flag

- **WHEN** argv contains `--debug-cdp=<port>` where `<port>` is an integer in `[1, 65535]`
- **THEN** CDP activation is enabled
- **AND** the port is the supplied `<port>`

#### Scenario: Valid explicit port via environment variable

- **WHEN** `PI_DEBUG_CDP` is set to an integer value in `[1, 65535]` (surrounding whitespace ignored)
- **THEN** CDP activation is enabled
- **AND** the port is the supplied value

#### Scenario: Invalid CLI port falls back to default port

- **WHEN** argv contains `--debug-cdp=<value>` where `<value>` is not an integer, is `0`, or is outside `[1, 65535]`
- **THEN** CDP activation is enabled
- **AND** the port is the default port `9222`

#### Scenario: Invalid environment port falls back to default port

- **WHEN** `PI_DEBUG_CDP` is set to a value that is neither a recognized truthy/falsy token nor a valid integer in `[1, 65535]`
- **THEN** CDP activation is enabled
- **AND** the port is the default port `9222`
