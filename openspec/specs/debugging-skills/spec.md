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

### Requirement: Runtime inspection skill carries a verified jiti launch recipe

The `eng-disciplines` package SHALL ship a `node-inspect-debugger` skill whose launch guidance is correct for this repo's jiti-based TypeScript loader.

#### Scenario: jiti launch recipe is present and sourcemap-flag'd

- **WHEN** the skill body is read
- **THEN** it gives the launch form `node --inspect-brk=<port> --enable-source-maps --import <jiti register hook> cli.ts`
- **AND** it explains how to locate the jiti register hook via `createRequire` rather than a hard-coded path

#### Scenario: The emitted-JS pitfall is corrected for jiti

- **WHEN** the skill's pitfalls section is read
- **THEN** it states that jiti transpiles line-preserving and registers compiled JS under the `.ts` URL
- **AND** it states that `.ts` breakpoints bind directly, including `sb('cli.ts', N)` in the plain `node inspect` REPL
- **AND** it does NOT repeat the upstream claim that breakpoints hit a separate emitted JS file

#### Scenario: Pending-breakpoint nuance is documented

- **WHEN** the skill describes setting a breakpoint before the target script parses
- **THEN** it states the breakpoint returns empty `locations` at set-time but still resolves and hits

#### Scenario: When-to-use targets real repo surfaces

- **WHEN** the skill's "When to Use" section is read
- **THEN** it names at least the jiti server, the restart orchestrator / PTY workers, WebSocket closure state, the Electron main process, and the bridge extension

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

