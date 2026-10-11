## MODIFIED Requirements

### Requirement: Deterministic quality oracle script

The project SHALL provide a `quality:changed` npm script that runs
`biome check --changed --error-on-warnings --write`, then the TypeScript 7
type-check (`--noEmit`), then `npm test`, and exits with the first non-zero
status. The existing `lint` script SHALL run the same TypeScript 7 `--noEmit`
type-check over the root program. The project SHALL also provide
`lint:biome`, `fix:changed`, and `quality:report` scripts.

#### Scenario: Oracle passes on clean diff

- **WHEN** `quality:changed` runs and changed files are Biome-clean, types compile, and tests pass
- **THEN** it SHALL exit 0.

#### Scenario: Oracle fails on dirty diff

- **WHEN** `quality:changed` runs and a changed file has an unfixable warn-tier or error-tier violation, or a type error, or a failing test
- **THEN** it SHALL exit non-zero.

## ADDED Requirements

### Requirement: TypeScript 7 compiles, TypeScript 5.x serves the JS API

Every repository type-check (`lint`, `lint:e2e`, `quality:changed`, package `typecheck` scripts) and every `tsc`-based package build SHALL run TypeScript 7's compiler, invoked through one repository wrapper by explicit package path and never through `node_modules/.bin/tsc`. The `typescript` package name SHALL stay on a 5.x release, so `require("typescript")` keeps providing the classic compiler API to codegen, tests and tooling. Switching compilers SHALL NOT change the emitted JavaScript or declaration files of the `tsc`-built packages.

#### Scenario: Type-check runs on TypeScript 7

- **WHEN** `npm run lint` runs
- **THEN** the compiler that executes SHALL report version 7.x

#### Scenario: JS API consumers keep the 5.x API

- **WHEN** a codegen script or test calls `require("typescript").createSourceFile`
- **THEN** the call SHALL resolve to a TypeScript 5.x module exposing `createSourceFile`

#### Scenario: Built package output is unchanged

- **WHEN** `app-kit`, `bus-client`, `context-budget` and `kb` are built with TypeScript 7
- **THEN** every emitted `.js` and `.d.ts` file SHALL be byte-identical to the TypeScript 5.9 build of the same source

#### Scenario: Bin link order does not matter

- **WHEN** `node_modules/.bin/tsc` links to either TypeScript version
- **THEN** every repository type-check and build script SHALL still execute TypeScript 7
