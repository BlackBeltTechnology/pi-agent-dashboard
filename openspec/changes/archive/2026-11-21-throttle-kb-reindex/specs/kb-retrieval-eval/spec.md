## MODIFIED Requirements

### Requirement: The built CLI artifact SHALL NOT lag its source
The `kb` bin and the `kb-extension` tool SHALL run the same engine.

#### Scenario: Stale dist is rejected
- **WHEN** the committed `packages/kb/engine-fingerprint.json` is missing, malformed, lacks `rowsHash`, or its `srcHash`/`tsconfigHash` no longer match the current source and tsconfig chain
- **THEN** the build or CI check SHALL fail
- **AND** the failure SHALL state that the `kb` bin and the extension would otherwise run different engines
