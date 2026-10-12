## ADDED Requirements

### Requirement: Runtime inspection skill carries verified launch recipes for both loaders

The `eng-disciplines` package SHALL ship a `node-inspect-debugger` skill whose launch guidance is correct for both TypeScript loaders in this repo: the Node-native strip loader that runs the dashboard server, and pi's jiti that runs the bridge extension inside a pi session.

#### Scenario: Native server launch recipe is present

- **WHEN** the skill body is read
- **THEN** it gives the server launch form `node --inspect-brk=<port> --import <native-ts-register.mjs URL> cli.ts`
- **AND** it explains how to locate the register module by package specifier via `createRequire` rather than a hard-coded path
- **AND** it states that strip mode preserves line and column positions, so no `--enable-source-maps` flag is needed

#### Scenario: jiti recipe is scoped to pi-hosted code

- **WHEN** the skill's jiti guidance is read
- **THEN** it scopes the jiti launch form (`--enable-source-maps --import <jiti register hook>`) to code that pi loads (the bridge extension and plugin bridges), not to the dashboard server
- **AND** it states that jiti transpiles line-preserving and registers compiled JS under the `.ts` URL, so `.ts` breakpoints bind directly
- **AND** it does NOT repeat the upstream claim that breakpoints hit a separate emitted JS file

#### Scenario: Pending-breakpoint nuance is documented

- **WHEN** the skill describes setting a breakpoint before the target script parses
- **THEN** it states the breakpoint returns empty `locations` at set-time but still resolves and hits

#### Scenario: When-to-use targets real repo surfaces

- **WHEN** the skill's "When to Use" section is read
- **THEN** it names at least the dashboard server, the restart orchestrator / PTY workers, WebSocket closure state, the Electron main process, and the bridge extension

## REMOVED Requirements

### Requirement: Runtime inspection skill carries a verified jiti launch recipe
**Reason**: The dashboard server no longer runs under jiti. The recipe now covers the native server loader and keeps jiti only for pi-hosted code.
**Migration**: See "Runtime inspection skill carries verified launch recipes for both loaders".
