## MODIFIED Requirements

### Requirement: CLI bin entry resolves jiti at runtime (no tsx fallback)
The `pi-dashboard` CLI entry point SHALL be a plain JavaScript file (`packages/server/bin/pi-dashboard.mjs`) that selects a TypeScript loader at runtime per the `server-launch` loader-selection requirement and re-execs Node with `--import <loader-url> packages/server/src/cli.ts <args>`. With the default native loader, the loader URL SHALL be the shared package's `platform/native-ts-register.mjs` resolved by package specifier via `createRequire` anchored at the wrapper's own real path. The entry SHALL be passed as a raw path on every platform, for both loaders (the `server-launch` entry-wrap rule exempts jiti and the native loader: under any `--import` loader Node runs the main entry through `path.resolve()`, so a `file://` entry fails on Windows). With `PI_DASHBOARD_TS_LOADER=jiti`, resolution SHALL use `createRequire` anchored at the wrapper's own real path and try the jiti packages listed in `ToolResolver`'s `JITI_PACKAGES`, in order. The wrapper SHALL apply the entry-wrap rule owned by the `server-launch` capability. There SHALL be no tsx fallback path. Metadata invocations (`--version`, `-v`, `version`) are answered from `package.json` before any loader resolution. When jiti is selected, jiti is a direct dependency of the server package, so a miss SHALL be treated as a corrupted install: the wrapper SHALL exit 1 with a stderr message that says so and suggests reinstalling the dashboard.

#### Scenario: Direct CLI invocation with default loader
- **WHEN** a user runs `pi-dashboard status` with `PI_DASHBOARD_TS_LOADER` unset
- **THEN** the wrapper SHALL exec `node --import <native-ts-register-url> packages/server/src/cli.ts status`, forwarding stdio and the child's exit code

#### Scenario: Direct CLI invocation with pi available
- **WHEN** a user runs `pi-dashboard status` with `PI_DASHBOARD_TS_LOADER=jiti` and pi reachable on the module graph
- **THEN** the wrapper SHALL resolve jiti and exec `node --import <jiti-url> packages/server/src/cli.ts status`, forwarding stdio and the child's exit code

#### Scenario: Direct CLI invocation without pi
- **WHEN** a user runs `pi-dashboard status` with `PI_DASHBOARD_TS_LOADER=jiti` and no listed jiti package resolves from the wrapper's install
- **THEN** the wrapper SHALL print a stderr message beginning `pi-dashboard: cannot find jiti.`, stating the install may be corrupted and suggesting `npm install -g @blackbelt-technology/pi-agent-dashboard`, then exit 1
- **AND** SHALL NOT attempt to resolve `tsx` or any other TypeScript loader

### Requirement: Canonical Node ESM-loader argv helpers
`packages/shared/src/platform/node-spawn.ts` SHALL expose the canonical helpers for `node --import <loader> <entry>` spawns:
- `toFileUrl(pathOrUrl)` SHALL perform no I/O and SHALL be idempotent. It SHALL wrap Windows drive-letter paths correctly on any host OS, so the Windows contract can be unit-tested on Linux and macOS. Relative inputs are resolved against the process cwd.
- `isTsxLoader(loader)` SHALL return `true` when the loader path or URL contains a `tsx/` directory segment.
- `isJitiLoader(loader)` SHALL return `true` when the loader path or URL contains a `jiti/` directory segment.
- `isNativeTsLoader(loader)` SHALL return `true` when the loader path or URL ends with the segment pair `platform/native-ts-register.mjs`, accepting either `/` or `\\` separators.
- `buildNodeImportArgvParts({ loader, entry, args?, platform? })` SHALL be the single pure builder of the `--import` argv shape. It SHALL always URL-wrap the loader. It SHALL wrap the entry exactly when `shouldUrlWrapEntry(loader, platform)` says so. The `server-launch` capability owns that entry-wrap rule; this requirement does not restate it.
- `spawnNodeScript(opts)` SHALL build its argv through `buildNodeImportArgvParts` when a loader is given.

#### Scenario: toFileUrl is idempotent on file:// URLs
- **WHEN** `toFileUrl("file:///C:/foo.ts")` is called
- **THEN** the helper SHALL return `"file:///C:/foo.ts"` unchanged

#### Scenario: toFileUrl wraps Windows drive-letter paths on any host
- **WHEN** `toFileUrl("B:\\Dev\\cli.ts")` or `toFileUrl("B:/Dev/cli.ts")` is called on Linux, macOS, or Windows
- **THEN** the helper SHALL return `"file:///B:/Dev/cli.ts"`

#### Scenario: toFileUrl wraps POSIX absolute paths
- **WHEN** `toFileUrl("/usr/local/bin/cli.js")` is called on any host
- **THEN** the helper SHALL return `"file:///usr/local/bin/cli.js"`

#### Scenario: Loader identity helpers
- **WHEN** `isTsxLoader` / `isJitiLoader` are called with a path or URL containing a `tsx/` or a `jiti/` segment respectively (e.g. `C:\x\node_modules\tsx\dist\esm\index.mjs`, `file:///.../node_modules/jiti/lib/jiti-register.mjs`)
- **THEN** the matching helper SHALL return `true` and the other SHALL return `false`

#### Scenario: Native loader identity
- **WHEN** `isNativeTsLoader` is called with `file:///.../pi-dashboard-shared/src/platform/native-ts-register.mjs`
- **THEN** it SHALL return `true` AND `isJitiLoader` / `isTsxLoader` SHALL return `false`
- **AND WHEN** it is called with the raw Windows path `C:\\x\\pi-dashboard-shared\\src\\platform\\native-ts-register.mjs`
- **THEN** it SHALL return `true`
- **AND WHEN** it is called with `/x/other-pkg/native-ts-register.mjs`
- **THEN** it SHALL return `false`

#### Scenario: Loader position is always a file:// URL
- **WHEN** `buildNodeImportArgvParts` is called with a raw loader path on any `platform`, including a Windows drive letter that collides with URL-scheme parsing (e.g. `B:\...\jiti-register.mjs`)
- **THEN** argv position 1 SHALL equal `toFileUrl(loader)`
- **AND** the spawned Node process SHALL NOT fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME`

#### Scenario: Entry position follows shouldUrlWrapEntry
- **WHEN** `buildNodeImportArgvParts({ loader, entry, args, platform })` is called
- **THEN** the result SHALL equal `["--import", toFileUrl(loader), shouldUrlWrapEntry(loader, platform) ? toFileUrl(entry) : entry, ...args]`

### Requirement: Doctor does not probe for tsx
Electron Doctor (`packages/electron/src/lib/doctor.ts`) SHALL NOT execute `where tsx` / `which tsx` and SHALL NOT report a "No tsx binary" detail string. Doctor's "Server launch test" reduces to checking `node` + the selected TypeScript loader (the Node-native register module by default; pi's jiti when `PI_DASHBOARD_TS_LOADER=jiti`).

#### Scenario: Doctor output omits tsx
- **WHEN** Doctor runs against a clean install
- **THEN** no diagnostic row mentions tsx
- **AND** the server-launch-test row passes when `node` + the selected loader are present
- **AND** with the default native loader the row SHALL NOT report "No jiti loader" when pi is absent
