## MODIFIED Requirements

### Requirement: Extracted LaunchSource health-checks jiti reachability before returning
The `extracted` LaunchSource resolution path SHALL verify that the bundled CLI tree is usable before returning. Specifically, `extractLaunchSource` SHALL compute `healthy = existsSync(cliPath) && resolveJitiFromAnchor(cliPath) !== null` after the version-marker check and SHALL run the bundle extraction + `installStandalone` block when `healthy` is `false`, even if the `.version` marker matches `currentVersion`. The current behavior — relying on the marker alone — is insufficient because the marker can be stale relative to the actual node_modules tree (partial extraction, antivirus quarantine, manual wipe, npm reconciliation prune).

#### Scenario: Marker matches and jiti reachable — skip extraction
- **WHEN** `extractLaunchSource` runs against a managed dir whose `.version` marker matches `bundledMinVersion` AND `cliPath` exists AND `resolveJitiFromAnchor(cliPath)` returns a non-null URL
- **THEN** the function SHALL skip extraction (`didExtract: false`)
- **AND** the returned `LaunchSource` SHALL be `{ kind: "extracted", cliPath, cwd: managedDir, didExtract: false }`

#### Scenario: Marker matches but cliPath missing — re-extract
- **WHEN** `extractLaunchSource` runs against a managed dir whose `.version` marker matches `bundledMinVersion` BUT `cliPath` does not exist on disk
- **THEN** the function SHALL run `extractBundle` followed by `installStandalone` (the same block triggered by `needsExtraction`)
- **AND** the returned `LaunchSource` SHALL reflect that re-extraction occurred

#### Scenario: Marker matches and cliPath exists but jiti unreachable — re-extract
- **WHEN** `extractLaunchSource` runs against a managed dir whose `.version` marker matches AND `cliPath` exists BUT `resolveJitiFromAnchor(cliPath)` returns `null`
- **THEN** the function SHALL run `extractBundle` followed by `installStandalone`
- **AND** SHALL log a single warn line `[launch-source] extracted source unhealthy (jiti missing); forcing re-extract` before doing so

#### Scenario: Marker mismatch — re-extract regardless of health
- **WHEN** `extractLaunchSource` runs against a managed dir whose `.version` marker does NOT match `bundledMinVersion`
- **THEN** the function SHALL run `extractBundle` + `installStandalone` (existing behavior — health check is additive, not subtractive)

#### Scenario: Health probe accepts injected dependencies for testing
- **WHEN** `extractedSourceIsHealthy(cliPath, deps?)` is called from a unit test with `deps = { existsSync, resolveJitiFromAnchor }` mocked
- **THEN** the helper SHALL use the injected functions and SHALL NOT touch the real filesystem or invoke the real jiti resolver

#### Scenario: Health probe is defensive against thrown errors
- **WHEN** an injected `existsSync` or `resolveJitiFromAnchor` throws
- **THEN** `extractedSourceIsHealthy` SHALL return `false` (treating thrown errors as unhealthy)
