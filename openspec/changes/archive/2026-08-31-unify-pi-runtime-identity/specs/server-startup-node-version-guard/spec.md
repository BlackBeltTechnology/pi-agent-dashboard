# server-startup-node-version-guard Delta

## MODIFIED Requirements

### Requirement: Engines-range message references bundled-Node remediation

`buildEnginesRangeMessage(version: string): string` SHALL always include the nvm and brew
remediation hints. The managed-Node hint (`PATH="$HOME/.pi-dashboard/node/bin` prepend) SHALL be
included only when a managed Node runtime is actually installed under `<managedDir>/node/` — on
machines without one the hint is dead advice and SHALL be omitted. The managed-dir mention remains
advisory text plus an existence probe, not a write; the file stays allowlisted in
`packages/shared/src/__tests__/no-managed-dir-reference.test.ts` under change
`eliminate-electron-runtime-install` (R3), with the allowlist rationale updated to cover the
existence probe.

#### Scenario: Message lists three install paths

- **WHEN** the engines-range message is built on a machine where `<managedDir>/node/` contains a
  managed runtime
- **THEN** the returned string SHALL contain the substrings `nvm install`,
  `PATH="$HOME/.pi-dashboard/node/bin`, and `brew install node`

#### Scenario: Message omits managed hint without a managed Node

- **WHEN** the engines-range message is built on a machine with no managed runtime under
  `<managedDir>/node/`
- **THEN** the returned string SHALL contain `nvm install` and `brew install node`
- **AND** SHALL NOT contain the substring `.pi-dashboard`
