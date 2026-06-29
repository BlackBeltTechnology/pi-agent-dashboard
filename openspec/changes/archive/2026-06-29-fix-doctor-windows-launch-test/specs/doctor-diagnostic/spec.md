# doctor-diagnostic — delta

## ADDED Requirements

### Requirement: Probe argv uses URL form for dynamic imports of filesystem paths
Any Doctor probe that constructs a `node -e "<script>"` argv whose `<script>` contains a dynamic `import "<spec>"` SHALL pass `<spec>` as a `file://` URL, never as a raw filesystem path. The URL conversion SHALL use `pathToFileURL(absPath).href` (Node built-in, `node:url`).

Rationale: on Windows, raw absolute paths begin with a drive-letter (`C:\`). Node's ESM resolver parses the import specifier as a URL and treats the drive letter as a scheme, rejecting with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. On POSIX the raw path `/Users/...` happens to work, but the URL form is universal and incurs zero behavioural change.

This requirement applies only to probe argv, not to runtime launch paths. The production server spawn (`packages/shared/src/server-launcher.ts` → `packages/shared/src/platform/node-spawn.ts`) already passes the entry as a positional argv (not a dynamic import in `-e`) and is therefore exempt.

#### Scenario: Windows probe builds file:// URL
- **WHEN** Doctor constructs a Server launch test on Windows with `testCli = "C:\\…\\cli.ts"`
- **THEN** the probe argv's `-e` script SHALL contain the substring `import "file:///C:/…/cli.ts"` (forward slashes, file scheme)
- **AND** SHALL NOT contain the substring `import "C:\\` (raw Windows path)

#### Scenario: POSIX probe builds file:// URL
- **WHEN** Doctor constructs a Server launch test on macOS/Linux with `testCli = "/Users/…/cli.ts"`
- **THEN** the probe argv's `-e` script SHALL contain the substring `import "file:///Users/…/cli.ts"` (file scheme prepended)
- **AND** SHALL NOT contain a raw absolute-path import

#### Scenario: Production launch path unaffected
- **WHEN** the Electron main process spawns the bundled server via `launchDashboardServer`
- **THEN** the entry SHALL be passed as a positional argv (e.g. `node --import <loader> /path/to/cli.ts`), not via `-e`
- **AND** this requirement SHALL NOT apply (the URL-vs-path distinction does not arise for positional argv)
