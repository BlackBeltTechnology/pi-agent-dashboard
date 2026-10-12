# debugging-skills Specification

## Purpose
Root-cause debugging and runtime-inspection skills for the eng-disciplines package: a phased `systematic-debugging` discipline and a jiti-aware `node-inspect-debugger` skill (with a dependency-free CDP helper), discoverable via the standard pi skill loader with no per-machine setup.

## Requirements

### Requirement: Root-cause debugging discipline is discoverable as a skill

The `eng-disciplines` package SHALL ship a `systematic-debugging` skill that a pi session discovers via the standard skill loader and that enforces a phased root-cause process before a fix is attempted.

#### Scenario: Skill is discovered without setup

- **WHEN** a contributor starts a pi session against this repo
- **THEN** `systematic-debugging` appears in the available-skills listing
- **AND** invoking it loads the full SKILL.md body
- **AND** no per-machine install step is required

#### Scenario: Rule of Three hands off to doubt-driven-review

- **WHEN** the skill body is read
- **THEN** it states that after three failed fixes the agent STOPS and questions the architecture
- **AND** it names the existing `doubt-driven-review` skill as the handoff for that architectural cross-examination

#### Scenario: Feedback loop example matches repo convention

- **WHEN** the skill's "tight feedback loop" guidance is read
- **THEN** the example uses this repo's documented test-capture convention (`npm test 2>&1 | tee /tmp/pi-test.log` then grep)
- **AND** it does not reference Hermes-only tooling

### Requirement: A TypeScript CDP helper attaches and dumps a paused frame

The `node-inspect-debugger` skill SHALL include a TypeScript helper script that attaches to a paused Node target and prints the paused frame's local and closure variables, without adding a runtime dependency to the root package.

#### Scenario: Helper is TypeScript and dependency-free by default

- **WHEN** an auditor inspects `packages/eng-disciplines/.pi/skills/node-inspect-debugger/scripts/cdp-inspect.ts`
- **THEN** the file is TypeScript
- **AND** it uses Node's global `WebSocket` (no `chrome-remote-interface` runtime dependency in the root `package.json`)

#### Scenario: Helper dumps live locals at a .ts breakpoint

- **WHEN** a Node target is launched with `--inspect-brk` through the jiti register hook
- **AND** `npx tsx cdp-inspect.ts <port> <ts-url> <line>` is run against a line inside a function
- **THEN** the helper prints `PAUSED at <file>:<line>`
- **AND** it prints one line per local/closure variable in the paused frame with its value

### Requirement: Both skills are registered and attributed

The package manifest SHALL register both skills, and third-party provenance SHALL be recorded.

#### Scenario: Skills registered in package manifest

- **WHEN** `packages/eng-disciplines/package.json` is read
- **THEN** `pi.skills[]` contains `".pi/skills/systematic-debugging"` and `".pi/skills/node-inspect-debugger"`

#### Scenario: Hermes derivation attributed

- **WHEN** `packages/eng-disciplines/NOTICE` is read
- **THEN** it attributes both skills to NousResearch/hermes-agent under MIT
- **AND** the attribution follows the same pattern as the existing Addy-Osmani derivation

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
