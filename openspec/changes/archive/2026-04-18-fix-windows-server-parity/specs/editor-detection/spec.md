## MODIFIED Requirements

### Requirement: Auto-detect code-server binary
The system SHALL detect the code-server binary by checking the following in order:
1. Config override: `editor.binary` in dashboard config
2. `code-server` on PATH (via platform-appropriate lookup: `where` on Windows, `which` on Unix)
3. `openvscode-server` on PATH (via platform-appropriate lookup)

Binary lookup SHALL use the unified `ToolResolver.which` helper (`packages/shared/src/tool-resolver.ts`), which handles the `where`/`which` split internally. The first match SHALL be used. Detection SHALL be performed once at server startup and cached, with re-detection available via API.

#### Scenario: code-server on PATH (Unix)
- **WHEN** `code-server` is found on PATH on macOS or Linux and no config override exists
- **THEN** the detection SHALL return `{ available: true, binary: "<absolute path>" }`

#### Scenario: code-server on PATH (Windows)
- **WHEN** `code-server` is found on PATH on Windows and no config override exists
- **THEN** the detection SHALL return `{ available: true, binary: "<absolute path>" }` using `where` for the lookup
- **AND** SHALL NOT silently fail because `which` is unavailable

#### Scenario: Config override
- **WHEN** `editor.binary` is set to an absolute path in config
- **THEN** the detection SHALL use that path regardless of PATH availability

#### Scenario: openvscode-server fallback
- **WHEN** `code-server` is not on PATH but `openvscode-server` is
- **THEN** the detection SHALL return `{ available: true, binary: "<absolute path>" }`

#### Scenario: Nothing found
- **WHEN** neither binary is found and no config override exists
- **THEN** the detection SHALL return `{ available: false }`
