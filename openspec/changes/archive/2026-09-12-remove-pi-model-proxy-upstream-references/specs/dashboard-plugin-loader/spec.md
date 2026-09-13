## MODIFIED Requirements

### Requirement: Plugin manifests SHALL support an optional `requires` field for declarative requirements

The `PluginManifest` type SHALL accept an optional `requires?: PluginRequirements` field, where `PluginRequirements` declares three optional string arrays: `piExtensions` (pi extension package identifiers), `binaries` (executables that must resolve on PATH), and `services` (named service probes from a closed built-in registry). The manifest validator SHALL reject duplicate, empty, or whitespace-only entries in any of the three arrays.

The closed built-in service-probe registry SHALL ship with exactly one entry: `model-proxy`. It SHALL be satisfied iff the dashboard's own model proxy routes were mounted at server boot (`modelProxy.enabled` as read at startup — the same boot-frozen value that gates `/v1/*` registration; a config change after boot takes effect at restart, for the probe and the routes alike); it SHALL NOT perform network I/O and SHALL NOT probe the upstream `@blackbelt-technology/pi-model-proxy` extension. The former name `pi-model-proxy` is NOT an alias and SHALL be reported as an unknown service name. Plugins SHALL NOT register additional service-probe names.

#### Scenario: Valid requires field accepted

- **WHEN** a plugin declares `requires: { piExtensions: ["@blackbelt-technology/pi-dashboard-subagents"], services: ["model-proxy"] }`
- **THEN** the validator SHALL accept the manifest.

#### Scenario: Empty string entries rejected

- **WHEN** a plugin declares `requires: { binaries: [""] }`
- **THEN** the validator SHALL throw `ManifestValidationError`.

#### Scenario: model-proxy service satisfied by dashboard config
- **WHEN** a plugin declares `requires: { services: ["model-proxy"] }` and the server booted with `modelProxy.enabled: true`
- **THEN** the probe runtime SHALL record `{ name: "model-proxy", satisfied: true }` without issuing any HTTP request.

#### Scenario: model-proxy probe never reports unwired in a running server
- **WHEN** a plugin manifest or a recommended-extensions entry declares `requires: { services: ["model-proxy"] }` and its requirements are read via `GET /api/health` (plugin `requirements`), the post-install refresh, or `GET /api/packages/recommended`
- **THEN** the recorded service entry SHALL be `satisfied: true` or `satisfied: false` with a proxy-state reason; it SHALL NOT carry `error: "probe not wired"`.

#### Scenario: model-proxy service unsatisfied when disabled
- **WHEN** a plugin declares `requires: { services: ["model-proxy"] }` and the server booted with `modelProxy.enabled: false`
- **THEN** the probe runtime SHALL record `{ name: "model-proxy", satisfied: false, error: <reason> }` and `missingRequirements` SHALL include `"model-proxy"`.

#### Scenario: Unknown service name rejected at probe time but not at validate time

- **WHEN** a plugin declares `requires: { services: ["unknown-service"] }` and that name is not registered in the built-in service-probe registry
- **THEN** the validator SHALL accept the manifest (string shape is valid), and the probe runtime SHALL record the service as `{ name: "unknown-service", satisfied: false, error: "unknown service name" }`.

### Requirement: PluginStatus SHALL include requirements and missingRequirements

`PluginStatus` SHALL include optional `requirements?: PluginRequirementReport` and `missingRequirements?: string[]`. The plugin status store SHALL accept and emit both fields. The `/api/health.plugins[]` payload SHALL expose them.

`PluginRequirementReport` SHALL include three arrays: `piExtensions: { name: string; satisfied: boolean }[]`, `binaries: { name: string; satisfied: boolean; resolvedPath?: string }[]`, `services: { name: string; satisfied: boolean; error?: string }[]`.

The flat `missingRequirements` SHALL list the `name` of every unsatisfied entry across all three categories. When every requirement is satisfied or the plugin declares no `requires`, `missingRequirements` SHALL be `[]` (not undefined).

#### Scenario: Mixed-satisfaction report

- **WHEN** plugin `subagents` declares `requires: { piExtensions: ["@blackbelt-technology/pi-dashboard-subagents"], services: ["model-proxy"] }`, `@blackbelt-technology/pi-dashboard-subagents` is installed, and the dashboard model proxy is disabled
- **THEN** `/api/health.plugins[]` SHALL include `subagents` with `requirements.piExtensions = [{ name: "@blackbelt-technology/pi-dashboard-subagents", satisfied: true }]`, `requirements.services = [{ name: "model-proxy", satisfied: false, error: <reason> }]`, and `missingRequirements = ["model-proxy"]`.
