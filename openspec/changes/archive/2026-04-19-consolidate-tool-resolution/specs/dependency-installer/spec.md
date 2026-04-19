## MODIFIED Requirements

### Requirement: Detect installed CLI tools
The dependency installer SHALL detect whether `pi`, `openspec`, and the dashboard package are available by delegating to `ToolRegistry`. `detectPi()`, `detectOpenSpec()`, `detectDashboardPackage()`, and `detectBridgeExtension()` SHALL become thin wrappers that call `registry.resolve(name)` and translate the `Resolution` into the `DetectionResult` shape used by the Electron wizard and `doctor.ts`.

#### Scenario: detectPi delegates to registry
- **WHEN** `detectPi()` is called
- **THEN** it SHALL invoke `registry.resolve("pi")`
- **AND** SHALL return `{ found: resolution.ok, path: resolution.path ?? undefined, source: resolution.source === "managed" ? "managed" : "system" }`
- **AND** SHALL NOT contain any direct call to `ToolResolver.which`, `where`, or `which`

#### Scenario: detectOpenSpec delegates to registry
- **WHEN** `detectOpenSpec()` is called
- **THEN** it SHALL invoke `registry.resolve("openspec")` and map the Resolution the same way as `detectPi()`

#### Scenario: detectDashboardPackage delegates to registry
- **WHEN** `detectDashboardPackage()` is called
- **THEN** it SHALL invoke `registry.resolve("pi-dashboard")` (registered as a `module` kind that probes managed + global npm)
- **AND** SHALL return the `DetectionResult` shape unchanged so wizard and doctor consumers are not impacted

#### Scenario: User overrides flow through detection
- **WHEN** the user has set an override for `"pi"` via the Tools settings UI
- **THEN** `detectPi()` SHALL return the overridden path with `source: "system"` (or a new `"override"` value once consumers are updated to surface it)
- **AND** the Electron wizard SHALL treat the tool as found

#### Scenario: Detection diagnostics surface via registry
- **WHEN** `detectPi()` returns `{ found: false }`
- **THEN** the caller MAY fetch `registry.resolve("pi")` directly to inspect `tried[]` for UI or log output
- **AND** the returned `DetectionResult` SHALL remain structurally backward-compatible with existing callers (no field removals)
