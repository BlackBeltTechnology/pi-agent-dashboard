## Purpose

Makes untested source visible: a coverage run that counts every source file in scope, including files no test loads, so the headline number cannot exclude the code that matters most.

## ADDED Requirements

### Requirement: Coverage run counts unloaded source files
`npm run test:coverage` SHALL run the vitest suite with v8 coverage over every file matching `packages/*/src/**/*.{ts,tsx}` except `__tests__/`, `test-support/` and `*.d.ts`, and SHALL report a file that no test loads at 0% rather than omitting it. The run SHALL execute under the same isolated `HOME` and per-run `--localstorage-file` wrapper as `npm test`. Electron (`packages/electron/`), `scripts/`, `tests/` and `.pi/` are outside the coverage scope and the config SHALL state so in a comment.

#### Scenario: Unloaded entry point appears at zero
- **WHEN** `npm run test:coverage` completes and a source file in scope (e.g. an extension entry point) is imported by no test
- **THEN** the summary SHALL list that file with 0% lines, functions and branches
- **AND** the package total SHALL include its lines in the denominator

#### Scenario: Report survives a failing test
- **WHEN** at least one test fails during `npm run test:coverage`
- **THEN** the coverage report SHALL still be written
- **AND** the process exit code SHALL still be non-zero

#### Scenario: Wrapper protects the real home
- **WHEN** `npm run test:coverage` starts
- **THEN** `process.env.HOME` SHALL be an ephemeral directory under the OS temp dir, and the globalSetup tripwire SHALL pass
