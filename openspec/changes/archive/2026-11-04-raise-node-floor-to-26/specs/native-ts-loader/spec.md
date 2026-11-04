## MODIFIED Requirements

### Requirement: Node-native TypeScript loader register module

The shared package SHALL ship a `--import`-able register module (`@blackbelt-technology/pi-dashboard-shared/platform/native-ts-register.mjs`) that installs Node module resolve/load hooks so the dashboard server's TypeScript sources run without jiti on every Node in the engines range. It SHALL register the hooks with synchronous, in-thread `module.registerHooks` when available (22.15+, 23.5+; this avoids the `module.register` DEP0205 deprecation on Node 26), and otherwise (end-of-life 23.0–23.4) with `module.register` using the same resolve/load logic. Types SHALL be stripped with `node:module` `stripTypeScriptTypes` in **strip** mode when available, and otherwise (23.0–23.1, which have no stripping API) with the bundled `amaro` package (Node's own type stripper) in `strip-only` mode, loaded only on those versions. The hooks SHALL:

- delegate resolution to Node first, and only on a not-found / unsupported-directory error for a relative or `file:` specifier retry the TypeScript sibling (`.js`→`.ts`, `.mjs`→`.mts`, `.cjs`→`.cts`) or, for an extensionless specifier, the candidates `.ts`, `.js`, `.mjs`, `/index.ts`, `/index.js`; bare package specifiers SHALL NOT be rewritten;
- load `.ts` / `.mts` / `.cts` files, including under `node_modules`, by stripping types in strip-only mode (as above), `.cts` as CommonJS and the rest as ESM;
- fail a file containing non-erasable TypeScript syntax (enum, namespace, parameter property) with an error naming the file path, whatever error code or name the stripper reports; there SHALL be no transpiling fallback;
- add the `json` import attribute to a JSON import that lacks one, in the resolve hook (so Node does not reject it with `ERR_IMPORT_ATTRIBUTE_MISSING`).

`.tsx` is not supported by the loader.

Every Node in the engines range SHALL boot through one of these tiers. The engines range is now Node 26 only, so the server boots exclusively through the `registerHooks` + `stripTypeScriptTypes` tier; the older tiers are retained in the register module and verified at unit level with a stubbed `node:module` API, not by booting the server on an end-of-life Node; the register module SHALL fail only when neither `module.registerHooks` nor `module.register` exists, naming the supported engines range. On Node lines with `registerHooks` the register module SHALL NOT emit a `DEP0205` deprecation warning. It SHALL suppress only the `stripTypeScriptTypes` `ExperimentalWarning`, in every thread that strips (every other warning still reaches stderr). Because `registerHooks` hooks also run for CommonJS `require()`, the hooks SHALL leave `require()` resolution of non-TypeScript modules unchanged.

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

- **WHEN** the dashboard server boots with the register module on Node 26
- **THEN** `/api/health` SHALL respond
- **AND** no `stripTypeScriptTypes` `ExperimentalWarning` and no `DEP0205` warning SHALL be printed

#### Scenario: Node without a stripping API uses the bundled stripper

- **WHEN** the register module runs against a `node:module` API with no `stripTypeScriptTypes` and no `registerHooks` (as on Node 23.0–23.1), verified with a stubbed module API
- **THEN** the hooks SHALL be registered with `module.register` and types stripped with the bundled `amaro`
- **AND** `amaro` SHALL NOT be loaded on any Node that has `stripTypeScriptTypes`

#### Scenario: CommonJS require of a dependency is unaffected

- **WHEN** server code loads a CommonJS package with `createRequire(import.meta.url)("<pkg>")`
- **THEN** the package SHALL resolve and evaluate exactly as without the hooks

#### Scenario: Old Node without type stripping

- **WHEN** the register module runs against a `node:module` API with `stripTypeScriptTypes` but no `registerHooks` (as on Node 23.2–23.4), verified with a stubbed module API
- **THEN** the hooks SHALL be registered with `module.register` and types stripped with `stripTypeScriptTypes` in strip mode
- **AND** no error SHALL mention `PI_DASHBOARD_TS_LOADER` or jiti
