## ADDED Requirements

### Requirement: Node-native TypeScript loader register module

The shared package SHALL ship a `--import`-able register module (`@blackbelt-technology/pi-dashboard-shared/platform/native-ts-register.mjs`) that calls `module.register` on its sibling hooks module (`platform/native-ts-hooks.mjs`, exporting `resolve` and `load`) and so installs Node module resolve/load hooks so the dashboard server's TypeScript sources run without jiti. The hooks SHALL:

- delegate resolution to Node first, and only on a not-found / unsupported-directory error for a relative or `file:` specifier retry the TypeScript sibling (`.js`→`.ts`, `.mjs`→`.mts`, `.cjs`→`.cts`) or, for an extensionless specifier, the candidates `.ts`, `.js`, `.mjs`, `/index.ts`, `/index.js`; bare package specifiers SHALL NOT be rewritten;
- load `.ts` / `.mts` / `.cts` files, including under `node_modules`, by stripping types with `node:module` `stripTypeScriptTypes` in transform mode (so enums, namespaces, and parameter properties work), `.cts` as CommonJS and the rest as ESM;
- add the `json` import attribute to a JSON import that lacks one, in the resolve hook (so Node does not reject it with `ERR_IMPORT_ATTRIBUTE_MISSING`).

`.tsx` is not supported by the loader.

When the running Node lacks `stripTypeScriptTypes`, the register module SHALL fail with an error that names `PI_DASHBOARD_TS_LOADER=jiti` as the workaround.

#### Scenario: NodeNext-style .js specifier resolves to the .ts source

- **WHEN** a server module imports `./foo.js` and only `./foo.ts` exists
- **THEN** the loader SHALL load `./foo.ts` with types stripped

#### Scenario: Existing .js file wins over the .ts sibling

- **WHEN** a module imports `./foo.js` and `./foo.js` exists
- **THEN** the loader SHALL load `./foo.js` unchanged

#### Scenario: Bare specifier is not rewritten

- **WHEN** a bare package specifier fails to resolve
- **THEN** the loader SHALL surface Node's original resolution error

#### Scenario: Enum and parameter properties under node_modules

- **WHEN** a `.ts` file under `node_modules` declares an `enum` and a class with parameter properties
- **THEN** the loader SHALL load it and the runtime values SHALL match the TypeScript semantics

#### Scenario: JSON import without an attribute

- **WHEN** a server module imports `./data.json` without `with { type: "json" }`
- **THEN** the loader SHALL load the JSON module without `ERR_IMPORT_ATTRIBUTE_MISSING`

#### Scenario: Old Node without type stripping

- **WHEN** the register module runs on a Node whose `node:module` has no `stripTypeScriptTypes`
- **THEN** startup SHALL fail with an error mentioning `PI_DASHBOARD_TS_LOADER=jiti`

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
