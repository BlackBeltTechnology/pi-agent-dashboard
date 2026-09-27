## MODIFIED Requirements

### Requirement: A static resolution check verifies shipped imports against manifests

The project SHALL provide a verification script that, for every non-private
workspace, asserts that **every module specifier appearing in the workspace's
shipped files is declared in that workspace's own `package.json`**.

The check SHALL be static — it SHALL NOT install, execute, or import the packaged
code. The existing quality oracle (`biome check --changed` + `tsc --noEmit` +
`npm test`) cannot detect this defect class, because it runs inside the monorepo
where hoisting resolves every import regardless of what the manifests declare.

The shipped file set SHALL be derived from `npm pack` (dry-run), not from a glob,
so that the `files` array and `.npmignore` semantics are honoured exactly as the
registry would apply them.

A specifier SHALL be resolved to a package name before lookup, handling all four
shapes: bare (`fastify`), scoped (`@mdi/react` — first two segments), deep
subpath (`dagre-d3-es/src/dagre/index.js` — segments after the package name are
stripped), and relative (`./foo.js` — resolved against the shipped file set
rather than the manifest).

**Meta-package exception.** For the repository-root package only, a shipped file
under `packages/<dir>/` SHALL additionally treat as declared the runtime
dependencies of `packages/<dir>/package.json`, when that workspace is reachable
from the root (see *Meta-package-shipped workspace sources are credited with
reachable workspace dependencies*). This is the sole exception to "that
workspace's own manifest".

Subject to the meta-package exception above, a specifier in a **shipped** file
SHALL be considered declared only when it appears in `dependencies`, `peerDependencies`, or `optionalDependencies` of that
workspace's manifest, or when it is a Node builtin (with or without the `node:`
prefix).

**`devDependencies` SHALL NOT satisfy an import in a shipped file.** This is
deliberately stricter than Biome's `noUndeclaredDependencies`, which accepts all
four fields. A `devDependency` is not installed for a consumer, so a shipped file
importing one is a consumer-visible break that Biome's rule cannot detect. The
two checks therefore serve different invariants and SHALL NOT be collapsed:
Biome asks *"is this import declared anywhere?"*, this check asks *"will this
import resolve for someone who installed the tarball?"*

#### Scenario: A shipped file importing an undeclared package fails the check

- **WHEN** the check runs against a workspace whose shipped code imports a package absent from all four dependency fields of its own manifest
- **THEN** the check SHALL exit non-zero
- **AND** the output SHALL name the workspace, the importing file, and the undeclared specifier

#### Scenario: A dependency declared as a runtime, peer, or optional dependency passes

- **WHEN** a shipped file imports a package declared in `dependencies`, `peerDependencies`, or `optionalDependencies`
- **THEN** the check SHALL NOT report that specifier

#### Scenario: A shipped file importing a devDependency fails

- **WHEN** a shipped file imports a package declared ONLY in `devDependencies`
- **THEN** the check SHALL exit non-zero
- **AND** the output SHALL state that the dependency is dev-only and will not be installed for a consumer

#### Scenario: A devDependency imported only by non-shipped files is not reported

- **WHEN** a package is declared in `devDependencies` and imported only by files absent from the packed file set, as `packages/client` does for `vitest` via `src/test-support/**` while shipping `files: ["dist/"]`
- **THEN** the check SHALL NOT report it, because the importing file never reaches a consumer

#### Scenario: Deep subpath imports resolve to the package name

- **WHEN** a shipped file contains `import ... from "dagre-d3-es/src/dagre/index.js"` and `dagre-d3-es` is declared
- **THEN** the check SHALL treat the specifier as satisfied
- **AND** SHALL NOT require a declaration named `dagre-d3-es/src/dagre/index.js`

#### Scenario: Scoped packages resolve to two segments

- **WHEN** a shipped file imports `@mdi/react` and `@mdi/react` is declared
- **THEN** the check SHALL treat the specifier as satisfied

#### Scenario: Node builtins are never reported

- **WHEN** a shipped file imports `node:path`, `path`, `node:fs`, or any other Node builtin
- **THEN** the check SHALL NOT report it as undeclared

#### Scenario: Relative specifiers must resolve inside the shipped file set

- **WHEN** a shipped file imports a relative path whose target is NOT present in the packed file list
- **THEN** the check SHALL exit non-zero and name the dangling relative import

#### Scenario: Private workspaces are skipped

- **WHEN** a workspace declares `"private": true`
- **THEN** the check SHALL skip it, because it is never published and its install graph reaches no consumer

#### Scenario: Root meta-package exception is the only cross-manifest credit

- **WHEN** a non-root workspace's shipped file imports a package declared only by another workspace it depends on
- **THEN** the check SHALL report `undeclared-import`, because the credit applies to the root package alone

### Requirement: The root package's shipped tsconfigs are checked

The publish check SHALL include the repository-root package when its `package.json` is not `"private": true`, and SHALL apply every rule of this capability to it: undeclared, dev-only and dangling-relative imports, unparseable source, tsconfig `extends`, and declared-range verification. The root package SHALL NOT be restricted to a subset of rules.

#### Scenario: Non-private root gets the full rule set
- **WHEN** the root `package.json` has no `"private": true` and a root-shipped file outside `packages/` imports a package that is declared nowhere
- **THEN** the check reports `undeclared-import` for the root package

#### Scenario: Private root is skipped
- **WHEN** the root `package.json` has `"private": true`
- **THEN** the root package is not checked

## ADDED Requirements

### Requirement: Meta-package-shipped workspace sources are credited with reachable workspace dependencies

For a file shipped by the root package at `packages/<dir>/…`, the check SHALL treat as declared the runtime dependencies of `packages/<dir>/package.json` in addition to the root's own runtime dependencies. This SHALL apply only when that workspace's `name` is reachable from the root's runtime dependencies through workspace-to-workspace runtime dependencies. A dependency declared only in `devDependencies` of both the root and the owning workspace SHALL be reported as `dev-only-import`. A credited dependency SHALL NOT be reported as dev-only. The check's summary SHALL report how many root imports were satisfied by this credit, as `N root import(s) credited via reachable workspace` (N ≥ 0).

#### Scenario: Import declared by a directly depended workspace passes
- **WHEN** the root depends on workspace `server`, and a root-shipped `packages/server/src/x.ts` imports `fastify`, which `server` declares in `dependencies`
- **THEN** no finding is reported for that import

#### Scenario: Credit count is reported
- **WHEN** the check runs and 2 root imports are satisfied only by reachable-workspace credit
- **THEN** the summary output contains `2 root import(s) credited via reachable workspace`

#### Scenario: Transitively reachable workspace is credited
- **WHEN** the root depends on `server`, `server` depends on `shared`, and a root-shipped `packages/shared/src/y.ts` imports a package that `shared` declares
- **THEN** no finding is reported for that import

#### Scenario: Unreachable shipped workspace is not credited
- **WHEN** a root-shipped `packages/other/src/z.ts` imports a package that `other` declares, but no root runtime dependency reaches `other`
- **THEN** the check reports `undeclared-import`

#### Scenario: Dev-only in the owning workspace is still reported
- **WHEN** a root-shipped `packages/server/src/x.ts` imports a package that `server` declares only in `devDependencies`, and the root does not declare it at runtime
- **THEN** the check reports `dev-only-import`

#### Scenario: Root devDependency does not shadow a credit
- **WHEN** the root lists `fastify` in `devDependencies` and the reachable `server` declares it in `dependencies`
- **THEN** no finding is reported for a root-shipped `packages/server/src/x.ts` importing `fastify`

#### Scenario: Files outside packages/ get no credit
- **WHEN** a root-shipped `scripts/a.cjs` imports a package that only a workspace declares
- **THEN** the check reports `undeclared-import`

#### Scenario: Shipped bundle output gets no credit
- **WHEN** a root-shipped `packages/dist/client/assets/a.js` contains a bare import of a package the root does not declare
- **THEN** the check reports `undeclared-import`, because `packages/dist/` has no workspace manifest

#### Scenario: Cyclic workspace dependencies terminate
- **WHEN** the root depends on workspace `a`, `a` depends on `b`, and `b` depends on `a`
- **THEN** reachability computation terminates and credits both `a` and `b`

### Requirement: The publish check also runs on the built tree in CI

CI SHALL run `scripts/verify-published-imports.mjs` a second time after the client build, so that build output shipped by any package (including the root's `packages/dist/`) is checked on every pull request.

#### Scenario: Post-build run is wired in ci.yml
- **WHEN** `.github/workflows/ci.yml` is inspected
- **THEN** a step running `node scripts/verify-published-imports.mjs` appears after the build step in the same job
