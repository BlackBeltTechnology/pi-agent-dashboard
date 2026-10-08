## MODIFIED Requirements

### Requirement: Bridge anchors jiti loader resolution at the active earendil pi cli

When the jiti loader is selected for the dashboard server it auto-starts (`PI_DASHBOARD_TS_LOADER=jiti`; the default is the Node-native loader per `server-launch`, which needs no jiti resolution), the bridge extension SHALL resolve pi's TypeScript loader (jiti) by anchoring `createRequire` at `process.argv[1]` (the active pi cli's entry point) and probing the following package names in order:

1. `jiti` — the un-namespaced upstream package shipped by `@earendil-works/pi-coding-agent`.
2. `@mariozechner/jiti` — the namespaced jiti package, retained as a loader fallback. It is a separate package from the dropped `@mariozechner/pi-coding-agent` fork.

The bridge SHALL NOT probe `@oh-my-pi/jiti`. If neither name resolves, the bridge SHALL surface the error message "Cannot find pi's TypeScript loader (jiti). Is `@earendil-works/pi-coding-agent` installed?" — naming only `@earendil-works/pi-coding-agent`, never `@mariozechner/pi-coding-agent` or `@oh-my-pi`.

#### Scenario: Earendil pi resolves bare jiti

- **WHEN** the bridge runs inside `@earendil-works/pi-coding-agent`'s Node.js process
- **THEN** `createRequire(piCli).resolve("jiti/package.json")` succeeds
- **AND** `@mariozechner/jiti` is never probed

#### Scenario: Namespaced jiti fallback

- **WHEN** the bare `jiti` package is not resolvable from the active pi cli and `@mariozechner/jiti` is
- **THEN** the bare-jiti probe fails fast
- **AND** `createRequire(piCli).resolve("@mariozechner/jiti/package.json")` succeeds

#### Scenario: Error message names only the earendil pi package

- **WHEN** neither jiti name resolves (e.g., pi is not installed)
- **THEN** the thrown error message SHALL name `@earendil-works/pi-coding-agent`
- **AND** SHALL NOT mention `@mariozechner/pi-coding-agent` or `@oh-my-pi/pi-coding-agent`
