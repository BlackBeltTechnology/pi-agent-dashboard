## ADDED Requirements

### Requirement: CLI bin entry uses the native TypeScript loader (no tsx fallback)
The `pi-dashboard` CLI entry point SHALL be a plain JavaScript file (`packages/server/bin/pi-dashboard.mjs`) that re-execs Node with `--import <loader-url> packages/server/src/cli.ts <args>`, where the loader URL SHALL be the shared package's `platform/native-ts-register.mjs` resolved by package specifier via `createRequire` anchored at the wrapper's own real path. The entry SHALL be passed as a raw path on every platform (the `server-launch` entry-wrap rule exempts the native loader: under any `--import` loader Node runs the main entry through `path.resolve()`, so a `file://` entry fails on Windows). The wrapper SHALL apply the entry-wrap rule owned by the `server-launch` capability. There SHALL be no jiti and no tsx path. Metadata invocations (`--version`, `-v`, `version`) are answered from `package.json` before any loader resolution. When the native register module cannot be resolved, the install is corrupted: the wrapper SHALL exit 1 with a stderr message that says so and suggests reinstalling the dashboard. `PI_DASHBOARD_TS_LOADER` SHALL NOT affect the wrapper: it neither warns nor rewrites the environment (the server process warns at boot, per `server-launch`).

#### Scenario: Direct CLI invocation
- **WHEN** a user runs `pi-dashboard status`
- **THEN** the wrapper SHALL exec `node --import <native-ts-register-url> packages/server/src/cli.ts status`, forwarding stdio and the child's exit code

#### Scenario: Legacy jiti selection is ignored
- **WHEN** a user runs `pi-dashboard status` with `PI_DASHBOARD_TS_LOADER=jiti`
- **THEN** the wrapper SHALL exec Node with the native register module, not jiti
- **AND** the wrapper SHALL NOT print a loader warning

#### Scenario: Native register module missing
- **WHEN** a user runs `pi-dashboard status` and `@blackbelt-technology/pi-dashboard-shared/platform/native-ts-register.mjs` does not resolve from the wrapper's install
- **THEN** the wrapper SHALL print a stderr message stating the install may be corrupted and suggesting `npm install -g @blackbelt-technology/pi-agent-dashboard`, then exit 1
- **AND** SHALL NOT attempt to resolve jiti, `tsx` or any other TypeScript loader

### Requirement: Doctor checks only the native TypeScript loader
No Doctor surface SHALL execute `where tsx` / `which tsx`, resolve a `tsx` package, or report tsx as a TypeScript loader. This covers both Electron Doctor (`packages/electron/src/lib/doctor.ts`) and the shared checks it and the server's doctor route delegate to (`packages/shared/src/doctor-core.ts`). The server boots only on the Node-native loader, so neither tsx nor jiti can satisfy the check. The "TypeScript loader" row SHALL check only the Node-native register module and SHALL NOT probe for jiti.

#### Scenario: Doctor output omits tsx
- **WHEN** Doctor runs against a clean install
- **THEN** no diagnostic row mentions tsx
- **AND** the server-launch-test row passes when `node` + the native register module are present
- **AND** the row SHALL NOT report "No jiti loader" when pi or jiti is absent

#### Scenario: Missing native register module is an error even with jiti or tsx installed
- **WHEN** the native register module does not resolve from the managed install or the bundled tree
- **AND** jiti or tsx is installed (managed, bundled, or on `PATH`)
- **THEN** the "TypeScript loader" row SHALL report status `error` with code `doctor.ts_loader_not_found`
- **AND** the row and its remediation text SHALL NOT mention tsx or jiti

#### Scenario: Native loader reports ok
- **WHEN** the native register module resolves
- **THEN** the "TypeScript loader" row SHALL report status `ok` naming the native register module's location

## REMOVED Requirements

### Requirement: CLI bin entry resolves jiti at runtime (no tsx fallback)
**Reason**: The wrapper no longer selects or resolves jiti; it always uses the Node-native loader.
**Migration**: See "CLI bin entry uses the native TypeScript loader (no tsx fallback)". `PI_DASHBOARD_TS_LOADER` is ignored with a warning.

### Requirement: Doctor does not probe for tsx
**Reason**: Its jiti-mode scenarios no longer apply. The tsx prohibition carries over unchanged.
**Migration**: See "Doctor checks only the native TypeScript loader", which keeps the no-tsx rule and drops the jiti row.
