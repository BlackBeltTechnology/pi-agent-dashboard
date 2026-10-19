## MODIFIED Requirements

### Requirement: Bridge SHALL make the openspec CLI resolvable in-session

The bridge extension SHALL ensure that, for any pi session it runs in, the
`openspec` CLI is resolvable by bare name from the session's shell environment,
without editing the generated `openspec-*` skills and without requiring a global
install. It SHALL achieve this by placing an `openspec` executable in a dedicated
directory and prepending that directory to the session process's `PATH` so that
`getShellEnv()` (which reads live `process.env`) hands it to every bash child.

#### Scenario: Bare openspec resolves after bridge init on a CLI-less machine

- **WHEN** the bridge initializes in a session on a machine with no `openspec` on
  the pre-existing PATH
- **THEN** a subsequent bash command running `openspec --version` SHALL resolve and
  execute the pinned CLI
- **AND** the generated `openspec-apply-change` skill's bare `openspec` calls SHALL
  succeed rather than degrade to hand-editing artifacts

#### Scenario: Shim resolves to the pinned CLI, offline

- **WHEN** the shim's `openspec` is invoked
- **THEN** it SHALL execute the `@fission-ai/openspec` resolved for the extension
  at the single-source version (see `openspec-cli-version-single-source`; `1.14.3`),
  lockfile-resolved, requiring no network fetch and no `npx`-latest download
- **AND** `openspec --version` SHALL report the single-source version (`1.14.3`)
