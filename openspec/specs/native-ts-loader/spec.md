# native-ts-loader Specification

## Purpose
The dashboard server's default TypeScript loader: Node-native type stripping (`module.stripTypeScriptTypes`) registered by `@blackbelt-technology/pi-dashboard-shared/platform/native-ts-register.mjs`, with no transpile cache, so a read-only bundle such as a FUSE-mounted AppImage boots without a cold transpile. Also requires server-loaded first-party source to be loader-neutral (no reliance on injected CommonJS globals), enforced by an AST gate.

## Requirements

### Requirement: Node-native TypeScript loader register module

The shared package SHALL ship a `--import`-able register module (`@blackbelt-technology/pi-dashboard-shared/platform/native-ts-register.mjs`) that installs Node module resolve/load hooks so the dashboard server's TypeScript sources run without jiti on every Node in the engines range. It SHALL register the hooks with synchronous, in-thread `module.registerHooks` when available (22.15+, 23.5+; this avoids the `module.register` DEP0205 deprecation on Node 26), and otherwise (end-of-life 23.0–23.4) with `module.register` using the same resolve/load logic. Types SHALL be stripped with `node:module` `stripTypeScriptTypes` in **strip** mode when available, and otherwise (23.0–23.1, which have no stripping API) with the bundled `amaro` package (Node's own type stripper) in `strip-only` mode, loaded only on those versions. The hooks SHALL:

- delegate resolution to Node first, and only on a not-found / unsupported-directory error for a relative or `file:` specifier retry the TypeScript sibling (`.js`→`.ts`, `.mjs`→`.mts`, `.cjs`→`.cts`) or, for an extensionless specifier, the candidates `.ts`, `.js`, `.mjs`, `/index.ts`, `/index.js`; bare package specifiers SHALL NOT be rewritten;
- load `.ts` / `.mts` / `.cts` files, including under `node_modules`, by stripping types in strip-only mode (as above), `.cts` as CommonJS and the rest as ESM;
- fail a file containing non-erasable TypeScript syntax (enum, namespace, parameter property) with an error naming the file path, whatever error code or name the stripper reports; there SHALL be no transpiling fallback;
- add the `json` import attribute to a JSON import that lacks one, in the resolve hook (so Node does not reject it with `ERR_IMPORT_ATTRIBUTE_MISSING`).

`.tsx` is not supported by the loader.

Every Node in the engines range SHALL boot through one of these tiers; the register module SHALL fail only when neither `module.registerHooks` nor `module.register` exists, naming the supported engines range. On Node lines with `registerHooks` the register module SHALL NOT emit a `DEP0205` deprecation warning. It SHALL suppress only the `stripTypeScriptTypes` `ExperimentalWarning`, in every thread that strips (every other warning still reaches stderr). Because `registerHooks` hooks also run for CommonJS `require()`, the hooks SHALL leave `require()` resolution of non-TypeScript modules unchanged.

#### Scenario: NodeNext-style .js specifier resolves to the .ts source

- **WHEN** a server module imports `./foo.js` and only `./foo.ts` exists
- **THEN** the loader SHALL load `./foo.ts` with types stripped

#### Scenario: Existing .js file wins over the .ts sibling

- **WHEN** a module imports `./foo.js` and `./foo.js` exists
- **THEN** the loader SHALL load `./foo.js` unchanged

#### Scenario: Bare specifier is not rewritten

- **WHEN** a bare package specifier fails to resolve
- **THEN** the loader SHALL surface Node's original resolution error

#### Scenario: Erasable TypeScript under node_modules

- **WHEN** a `.ts` file under `node_modules` uses only erasable syntax (type annotations, interfaces, `import type`)
- **THEN** the loader SHALL load it and line/column positions SHALL match the source

#### Scenario: Enum and parameter properties under node_modules

- **WHEN** a loaded `.ts` file (including one under `node_modules`) declares an `enum` or a class with parameter properties
- **THEN** loading SHALL fail with an error naming that file's path
- **AND** the loader SHALL NOT fall back to another transpiler

#### Scenario: JSON import without an attribute

- **WHEN** a server module imports `./data.json` without `with { type: "json" }`
- **THEN** the loader SHALL load the JSON module without `ERR_IMPORT_ATTRIBUTE_MISSING`

#### Scenario: Same loader on every supported Node line

- **WHEN** the dashboard server boots with the register module on Node 22.19, 23.1, 23.4, 24, 25 and 26
- **THEN** `/api/health` SHALL respond on each
- **AND** no `stripTypeScriptTypes` `ExperimentalWarning` SHALL be printed on any of them, and no `DEP0205` warning on the lines that have `registerHooks`

#### Scenario: Node without a stripping API uses the bundled stripper

- **WHEN** the server boots on Node 23.0 or 23.1 (no `stripTypeScriptTypes`, no `registerHooks`)
- **THEN** the hooks SHALL be registered with `module.register` and types stripped with the bundled `amaro`
- **AND** `amaro` SHALL NOT be loaded on any Node that has `stripTypeScriptTypes`

#### Scenario: CommonJS require of a dependency is unaffected

- **WHEN** server code loads a CommonJS package with `createRequire(import.meta.url)("<pkg>")`
- **THEN** the package SHALL resolve and evaluate exactly as without the hooks

#### Scenario: Old Node without type stripping

- **WHEN** the register module runs on Node 23.2–23.4 (`stripTypeScriptTypes` but no `registerHooks`)
- **THEN** the hooks SHALL be registered with `module.register` and types stripped with `stripTypeScriptTypes` in strip mode
- **AND** no error SHALL mention `PI_DASHBOARD_TS_LOADER` or jiti

### Requirement: Server-loaded source is loader-neutral

First-party TypeScript loaded by the dashboard server process SHALL NOT reference the CommonJS globals `require`, `__dirname`, `__filename`, `module`, or `exports` unless the identifier is bound in the file (e.g. `const require = createRequire(import.meta.url)`, `const __dirname = dirname(fileURLToPath(import.meta.url))`). Occurrences inside string or template literals and comments are not references. The scope SHALL be derived, not listed: the jiti-scope seed discovery (`scripts/lib-jiti-scope.mjs`) SHALL read plugin entries from both manifest forms the runtime loader accepts (an adjacent `dashboard-plugin.json` taking precedence over `package.json#pi-dashboard-plugin`, as in `packages/dashboard-plugin-runtime/src/server/loader.ts`), SHALL tag each seed by kind (`piExtension`, `serverMain`, `pluginServer`, `pluginBridge`), and this gate SHALL walk only from `serverMain` and `pluginServer` seeds — excluding `pi.extensions` and plugin `bridge` seeds, which pi's own jiti loads. The walk SHALL follow value imports only (type-only `import type` / `export type` specifiers are erased and not followed). A `.tsx` file reached by a value import is a violation. The `jiti-cjs-transpile-safety` file set SHALL be unchanged by the seed tagging. A static, AST-level gate SHALL enforce this and SHALL be proven to fail on a fixture and on an empty file set.

#### Scenario: Bare require is rejected

- **WHEN** a server-loaded `.ts` file calls `require("x")` without a `createRequire`-bound `require` in scope
- **THEN** the gate SHALL fail naming the file and line

#### Scenario: createRequire-bound require is accepted

- **WHEN** a server-loaded file declares `const nativeRequire = createRequire(import.meta.url)` and calls `nativeRequire("x")`
- **THEN** the gate SHALL pass for that file

#### Scenario: Locally declared __dirname is accepted

- **WHEN** a server-loaded file declares `const __dirname = dirname(fileURLToPath(import.meta.url))` and uses `__dirname`
- **THEN** the gate SHALL pass for that file

#### Scenario: Bridge-only code is out of scope

- **WHEN** a file is reachable only from a `pi.extensions` or plugin `bridge` seed and uses an unbound `__dirname`
- **THEN** the gate SHALL NOT report it

#### Scenario: Type-only import of a .tsx file is not followed

- **WHEN** a server-scope file has `import type { X } from "../plugin-context.js"` whose target is a `.tsx` file
- **THEN** the gate SHALL NOT walk into it and SHALL NOT report a `.tsx` violation

#### Scenario: Literal occurrence is not a violation

- **WHEN** `require(` appears only inside a string or template literal (e.g. a `node -e` script)
- **THEN** the gate SHALL NOT report it

### Requirement: First-party TypeScript uses only erasable syntax

First-party TypeScript in the repository type-check program (`packages/*/src`, tests included; `packages/team-app` is excluded because it is a Vite-bundled browser app that the server loader never evaluates) SHALL use only syntax that Node's strip-only type stripping accepts: no `enum` (including `const enum`), no runtime `namespace` / `module` declarations, no constructor parameter properties, and no `import x = require(...)` aliases. Imports and re-exports used only as types SHALL be written `import type` / `export type` (or with inline `type` modifiers), because strip mode keeps an untyped `import { Foo }` and the module then fails to link when `Foo` is only a type. The repository SHALL enforce the syntax rule through the shared base TypeScript configuration (`erasableSyntaxOnly`), so every package that extends it inherits it, and the type-only-import rule through the Biome `useImportType` rule at error level.

#### Scenario: A parameter property fails the type-check

- **WHEN** a contributor adds `constructor(private readonly x: number) {}` to a file under `packages/*/src`
- **THEN** the repository type-check (`npm run lint`) SHALL fail on that line

#### Scenario: A type imported without `import type` fails the lint

- **WHEN** a contributor writes `import { SomeInterface } from "./x.js"` and uses `SomeInterface` only as a type
- **THEN** `biome lint` SHALL report an error

#### Scenario: An enum fails the type-check

- **WHEN** a contributor adds `export enum Mode { A, B }` under `packages/*/src`
- **THEN** the repository type-check SHALL fail on that declaration

#### Scenario: Existing string-enum call sites keep compiling

- **WHEN** `ChangeState` is defined as an `as const` object plus a same-named type
- **THEN** every existing `ChangeState.X` value use and `ChangeState` type annotation SHALL type-check unchanged
- **AND** `ChangeState.X` SHALL evaluate to the same string value as before
- **AND** a raw string literal of a member value (e.g. `"READY"`) SHALL now also be assignable to `ChangeState` (accepted loosening of the former nominal enum type)
