## MODIFIED Requirements

### Requirement: Resolve jiti register path from any installed source

The system SHALL provide jiti resolution that returns a `file://` URL to a jiti register hook suitable for Node's `--import` flag, independent of whether pi is installed.

`@blackbelt-technology/pi-dashboard-server` SHALL declare `jiti` as a direct runtime dependency so that a clean `npm install` of the dashboard places `jiti/` somewhere on Node's module-resolution path walking up from the bin wrapper. Resolution SHALL accept any of the following anchors and SHALL succeed when at least one yields a jiti install:

1. Managed pi install under `~/.pi-dashboard/node_modules/`.
2. Pi resolved via `which pi` on `PATH`.
3. Caller-supplied anchor (e.g. an Electron `cliPath`).
4. `process.argv[1]` (the running bin script) — this anchor SHALL find `jiti` shipped as a direct dep of `@blackbelt-technology/pi-dashboard-server` regardless of npm install layout (flat, scoped, hoisted, pnpm).

The candidate package list remains `jiti`, then legacy `@mariozechner/jiti`. The function SHALL derive the absolute path to `lib/jiti-register.mjs` from the resolved package.json and SHALL URL-wrap the path on Windows.

#### Scenario: Resolution from dashboard's own node_modules without pi installed

- **WHEN** `pi-dashboard` is launched from a clean `npm install -g @blackbelt-technology/pi-agent-dashboard` install
- **AND** pi is not installed anywhere on the system
- **THEN** the bin wrapper SHALL resolve jiti via the `process.argv[1]` anchor walking up to the dashboard's own `node_modules/jiti/`
- **AND** SHALL re-exec Node with `--import <jiti-register.mjs>` successfully

#### Scenario: Resolution against pi's module graph

- **WHEN** `resolveJiti()` is called from a process where pi is installed (managed, system, or as an anchor)
- **THEN** it SHALL return a `file://` URL pointing at pi's `node_modules/jiti/lib/jiti-register.mjs` (or the legacy `@mariozechner/jiti` location for older pi versions) if reached before the dashboard's own copy
- **AND** SHALL prefer the first anchor in the documented order

#### Scenario: No jiti found anywhere

- **WHEN** `resolveJiti()` is called and no candidate jiti package can be resolved from any anchor
- **THEN** the function SHALL return `null`
- **AND** the bin wrapper SHALL exit code 1 with a message stating jiti resolution failed unexpectedly given it is a declared dependency, hinting at a corrupted install and pointing at the issue tracker

#### Scenario: Metadata short-circuit does not require jiti

- **WHEN** `pi-dashboard --version`, `-v`, or `version` is invoked
- **THEN** the bin wrapper SHALL read `package.json` and print the version without resolving jiti
- **AND** SHALL exit code 0 even if no jiti is installed
