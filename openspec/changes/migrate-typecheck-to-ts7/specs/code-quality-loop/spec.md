## MODIFIED Requirements

### Requirement: Deterministic quality oracle script

The project SHALL provide a `quality:changed` npm script that runs
`biome check --changed --error-on-warnings --write`, then the TypeScript 7
`--noEmit` type-checks, then the remaining repository lint steps, then `npm test`, and exits with the
first non-zero status. The existing `lint` script SHALL run the same TypeScript 7 `--noEmit`
type-check over the root program. The project SHALL also provide
`lint:biome`, `fix:changed`, and `quality:report` scripts.

#### Scenario: Oracle passes on clean diff

- **WHEN** `quality:changed` runs and changed files are Biome-clean, types compile, and tests pass
- **THEN** it SHALL exit 0.

#### Scenario: Oracle fails on dirty diff

- **WHEN** `quality:changed` runs and a changed file has an unfixable warn-tier or error-tier violation, or a type error, or a failing test
- **THEN** it SHALL exit non-zero.

### Requirement: Code-quality skill with analyze-fix-test procedure

The project SHALL provide a `.pi/skills/code-quality/SKILL.md` skill describing
an analyze → fix → test procedure with two modes: a changed-files mode for the
goal loop and a whole-repo mode for explicit cleanup. The skill SHALL encode the
guardrails: changed-files scope by default, a test gate (the TypeScript 7
`--noEmit` type-check via the repository wrapper + `npm test`)
after every fix batch with revert-on-red, safe fixes auto-applied while unsafe and
manual fixes are surfaced as a report, and no edits to files outside the diff. The
skill SHALL provide the goal-text templates a judge model consumes.

#### Scenario: Skill drives the goal loop

- **WHEN** a user sets a goal using the skill's daily-driver template
- **THEN** the agent SHALL run `quality:changed`, fix reported issues on changed files only, and the judge SHALL mark the goal achieved once the script exits 0.

#### Scenario: Skill forbids scope creep

- **WHEN** the agent fixes issues under the skill
- **THEN** it SHALL NOT modify files outside the current diff and SHALL revert a fix batch if the test gate goes red.

## ADDED Requirements

### Requirement: TypeScript 7 compiles, TypeScript 5.x serves the JS API

Every repository type-check (`lint`, `lint:e2e`, `quality:changed`, package `typecheck` scripts) and every `tsc`-based package build SHALL run TypeScript 7's compiler, invoked through one repository wrapper by explicit package path and never through `node_modules/.bin/tsc`. The `typescript` package name SHALL stay on a 5.x release, so `require("typescript")` keeps providing the classic compiler API to codegen, tests and tooling. The switch from TypeScript 5.x to 7 SHALL NOT change the emitted JavaScript or declaration files of the `tsc`-built packages (verified at the switch-over; later source changes may change output as usual).

#### Scenario: Type-check runs on TypeScript 7

- **WHEN** `npm run lint` runs
- **THEN** the compiler that executes SHALL report version 7.x

#### Scenario: JS API consumers keep the 5.x API

- **WHEN** a codegen script or test calls `require("typescript").createSourceFile`
- **THEN** the call SHALL resolve to a TypeScript 5.x module exposing `createSourceFile`

#### Scenario: Built package output is unchanged at the switch-over

- **WHEN** `app-kit`, `bus-client`, `context-budget` and `kb` are built from the same source with TypeScript 7
- **THEN** every emitted `.js` and `.d.ts` file SHALL be byte-identical to the TypeScript 5.9 build of the same source

#### Scenario: Bin link order does not matter

- **WHEN** `node_modules/.bin/tsc` links to either TypeScript version
- **THEN** every repository type-check and build script, the kb dev rebuild, and the reload/build shell scripts SHALL still execute TypeScript 7
