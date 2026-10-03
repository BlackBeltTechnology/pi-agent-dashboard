## ADDED Requirements

### Requirement: Canonical Node ESM-loader argv helpers
`packages/shared/src/platform/node-spawn.ts` SHALL expose the canonical helpers for `node --import <loader> <entry>` spawns:
- `toFileUrl(pathOrUrl)` SHALL perform no I/O and SHALL be idempotent. It SHALL wrap Windows drive-letter paths correctly on any host OS, so the Windows contract can be unit-tested on Linux and macOS. Relative inputs are resolved against the process cwd.
- `isTsxLoader(loader)` SHALL return `true` when the loader path or URL contains a `tsx/` directory segment.
- `isJitiLoader(loader)` SHALL return `true` when the loader path or URL contains a `jiti/` directory segment.
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

#### Scenario: Loader position is always a file:// URL
- **WHEN** `buildNodeImportArgvParts` is called with a raw loader path on any `platform`, including a Windows drive letter that collides with URL-scheme parsing (e.g. `B:\...\jiti-register.mjs`)
- **THEN** argv position 1 SHALL equal `toFileUrl(loader)`
- **AND** the spawned Node process SHALL NOT fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME`

#### Scenario: Entry position follows shouldUrlWrapEntry
- **WHEN** `buildNodeImportArgvParts({ loader, entry, args, platform })` is called
- **THEN** the result SHALL equal `["--import", toFileUrl(loader), shouldUrlWrapEntry(loader, platform) ? toFileUrl(entry) : entry, ...args]`

### Requirement: Startup fails hard when pi cannot be resolved
pi, openspec and tsx are regular dependencies of the server package. During foreground startup the server SHALL therefore resolve `pi` through the tool registry. When the resolve fails, the server SHALL throw a hard error. The error SHALL name a corrupted `node_modules/` tree, list the resolution strategies tried, and suggest reinstalling the dashboard or the Electron app. There SHALL be no degraded mode and no runtime install.

#### Scenario: pi resolves at startup
- **WHEN** the server starts and the tool registry resolves `pi`
- **THEN** the server SHALL log `[bootstrap] ready (pi resolved via <source>)` and continue startup

#### Scenario: pi unresolvable at startup
- **WHEN** the server starts and the tool registry cannot resolve `pi`
- **THEN** startup SHALL throw an error whose message contains `corrupted node_modules/ tree` and the tried strategies
- **AND** the server SHALL NOT attempt any package install

## MODIFIED Requirements

### Requirement: CI detects raw paths passed to Node ESM loader
The test suite SHALL include a lint-style check (`packages/shared/src/__tests__/no-raw-node-import.test.ts`) that scans the `packages/` source tree for argv literals in which `"--import"` or `"--loader"` is followed by a loader or entry position that is neither a `file:` string literal nor a `toFileUrl(...)` / `pathToFileURL(...).href` call. The scan covers each package's `src/` tree and skips `__tests__` directories. Violations SHALL fail CI with a message identifying file and line number. Exemptions inside the scanned tree SHALL be limited to:
- a file allowlist containing only `packages/shared/src/platform/node-spawn.ts` and `packages/shared/src/server-launcher.ts`, the files that own argv construction;
- a per-line `ban:raw-node-import-ok` opt-out marker.

No function name SHALL be allowlisted. New spawn sites SHALL build argv through `buildNodeImportArgvParts` / `spawnNodeScript`, which apply the entry-wrap rule owned by the `server-launch` capability.

#### Scenario: Lint passes on the current codebase
- **WHEN** `npm test` is run after the migration
- **THEN** the lint test SHALL report zero violations

#### Scenario: Lint detects a staged violation fixture
- **GIVEN** a test fixture containing `spawn(process.execPath, ["--import", loader, rawPath])` where `rawPath` is not wrapped and the loader is not tsx
- **WHEN** the lint scanner runs against the fixture
- **THEN** the scanner SHALL report the fixture's file and line number as a violation

### Requirement: CLI bin entry resolves jiti at runtime (no tsx fallback)
The `pi-dashboard` CLI entry point SHALL be a plain JavaScript file (`packages/server/bin/pi-dashboard.mjs`) that resolves jiti at runtime and re-execs Node with `--import <jiti-url> packages/server/src/cli.ts <args>`. Resolution SHALL use `createRequire` anchored at the wrapper's own real path and try the jiti packages listed in `ToolResolver`'s `JITI_PACKAGES`, in order. The wrapper SHALL apply the entry-wrap rule owned by the `server-launch` capability, so a jiti loader gets a raw entry path. There SHALL be no tsx fallback path. Metadata invocations (`--version`, `-v`, `version`) are answered from `package.json` before jiti resolution. For every other invocation, jiti is a direct dependency of the server package, so a miss SHALL be treated as a corrupted install: the wrapper SHALL exit 1 with a stderr message that says so and suggests reinstalling the dashboard.

#### Scenario: Direct CLI invocation with pi available
- **WHEN** a user runs `pi-dashboard status` from a shell with pi reachable on the module graph
- **THEN** the wrapper SHALL resolve jiti and exec `node --import <jiti-url> packages/server/src/cli.ts status`, forwarding stdio and the child's exit code

#### Scenario: Direct CLI invocation without pi
- **WHEN** a user runs `pi-dashboard status` and no listed jiti package resolves from the wrapper's install
- **THEN** the wrapper SHALL print a stderr message beginning `pi-dashboard: cannot find jiti.`, stating the install may be corrupted and suggesting `npm install -g @blackbelt-technology/pi-agent-dashboard`, then exit 1
- **AND** SHALL NOT attempt to resolve `tsx` or any other TypeScript loader

## REMOVED Requirements

### Requirement: Centralized helper for Node ESM-loader argv construction
**Reason**: Its scenarios asserted that `spawnNodeScript` URL-wraps the entry for every non-tsx loader, and used a `@mariozechner/jiti` example path. The code passes jiti entries raw on every OS and URL-wraps other loaders on Windows only.
**Migration**: Replaced by "Canonical Node ESM-loader argv helpers" (ADDED above). The entry-wrap rule itself is owned by `server-launch` "Single shared dashboard-server spawn primitive".

### Requirement: TypeScript loader passed as file:// URL
**Reason**: It asserted that a jiti loader gets a `file://` URL entry, which the code contradicts: `shouldUrlWrapEntry` returns `false` for jiti on every platform. Its scenarios named `resolveJitiImport()` and `resolveJitiFromAnchor()`, which were subsumed into `ToolResolver.resolveJiti`, and a `cmdStart` tsx fallback that no longer exists.
**Migration**: The loader-always-URL and Windows drive-letter guarantees move to "Canonical Node ESM-loader argv helpers" (ADDED above). The entry-wrap rule is owned by `server-launch`. See change `eliminate-electron-runtime-install`.

### Requirement: Bootstrap install lists exclude tsx
**Reason**: Every install list it pinned is gone: `cli.ts` / `server.ts` seeding, `dependency-installer.ts`, `power-user-install.ts`, `bootstrap-install.ts`. Nothing installs packages into `~/.pi-dashboard/node_modules/` anymore. Its fallback scenario also named the legacy `@mariozechner/pi-coding-agent` fork.
**Migration**: None. Change `eliminate-electron-runtime-install` deleted the runtime install. `tsx` is now a regular server dependency in the bundled tree.
