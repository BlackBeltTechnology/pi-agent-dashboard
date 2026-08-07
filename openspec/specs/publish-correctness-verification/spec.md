# publish-correctness-verification Specification

## Purpose

Statically verify that every module specifier in a published workspace's packed
file set resolves against that workspace's own manifest.

The shipped file set is derived from `npm pack --dry-run`, so the `files` array
and `.npmignore` are honoured exactly as the registry applies them. A specifier
counts as declared only when it appears in `dependencies`, `peerDependencies`,
or `optionalDependencies`, or is a Node builtin. `devDependencies` do NOT
satisfy a shipped import, because npm does not install them for a consumer.

This is deliberately stricter than Biome's `noUndeclaredDependencies`, which
accepts all four fields. Biome asks *"is this import declared anywhere?"*; this
asks *"will this import resolve for someone who installed the tarball?"* The
monorepo hoists every import regardless of what the manifests declare, so the
defect is invisible until a consumer installs the published package.

**Bounded guarantee:** this proves *declaration*, not *installability*. It does
not verify that a declared range resolves on the registry — a declared
`^99.0.0` passes.
## Requirements
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

A specifier in a **shipped** file SHALL be considered declared only when it
appears in `dependencies`, `peerDependencies`, or `optionalDependencies` of that
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

### Requirement: The check carries an explicit, reasoned exception list

The check SHALL support an allowlist of specifiers that are deliberately not
declared, each entry carrying the workspace, the specifier, and a reason string.
The allowlist exists because the check does not read `biome-ignore` comments and
would otherwise flag intentionally-undeclared specifiers.

The allowlist SHALL contain `@pi/anthropic-messages` for
`packages/flows-anthropic-bridge-plugin`, because that package does not exist on
the npm registry (`npm view` returns E404). It is a legacy pre-rescope name
reached only through a dynamic-import fallback, and declaring it would write an
unresolvable dependency into a published manifest.

#### Scenario: An allowlisted specifier is not reported

- **WHEN** the check encounters `@pi/anthropic-messages` in `packages/flows-anthropic-bridge-plugin` shipped code
- **THEN** the check SHALL NOT report it
- **AND** the allowlist entry SHALL carry a reason string explaining the E404

#### Scenario: An allowlist entry without a reason is rejected

- **WHEN** the allowlist contains an entry with no reason string
- **THEN** the check SHALL exit non-zero, so exceptions cannot accumulate silently

### Requirement: The check is proven against a known-bad fixture

The check SHALL be exercised against a fixture whose manifest deliberately omits
a dependency its shipped code imports, and SHALL fail on it. A verification tool
that has only ever been run against passing input may be passing vacuously.

The fixture SHALL be constructed at runtime in a temporary directory and the
checker invoked as a library against it. The fixture SHALL NOT be a committed
workspace under `packages/`, because the repository-wide run would scan it and
fail on it by design.

#### Scenario: Known-bad fixture fails

- **WHEN** the check runs against a temporary fixture workspace importing a package absent from its manifest
- **THEN** the check SHALL exit non-zero

#### Scenario: Known-good fixture passes

- **WHEN** the check runs against a temporary fixture workspace whose manifest declares every import in its shipped files
- **THEN** the check SHALL exit zero

#### Scenario: The fixture leaves no repository artifact

- **WHEN** the fixture test completes
- **THEN** no fixture package directory SHALL remain under `packages/`
- **AND** the repository-wide run SHALL be unaffected by the fixture's existence

### Requirement: The check completes within a CI time budget

The check SHALL complete in under 60 seconds on CI across every non-private
workspace. It runs on every pull request, so an unbounded runtime would make it
the slowest gate in the pipeline and invite disabling.

#### Scenario: Full-repository run stays within budget

- **WHEN** the check runs across all non-private workspaces on CI
- **THEN** total wall-clock time SHALL be under 60 seconds

### Requirement: The check runs in CI

The check SHALL run in CI alongside the existing release-integrity scripts
(`verify-release-deps.mjs`, `verify-lockfile-versions.mjs`), so that a manifest
regression is caught before release rather than after publication.

#### Scenario: CI fails on an undeclared shipped import

- **WHEN** a pull request adds an import of an undeclared package to shipped code in a non-private workspace
- **THEN** the CI job running this check SHALL fail

### Requirement: The check's guarantee is bounded and stated

The check SHALL be documented as proving *declaration*, not *installability*. It
verifies that every shipped import is declared with a concrete range; it does NOT
verify that the range resolves on the registry. A declared `^99.0.0` passes this
check.

Full resolvability would require a registry round-trip against published
versions, which reports on already-released code rather than the change under
test, and false-fails on optional peers that are absent by design.

#### Scenario: A declared but unresolvable range passes and is documented as such

- **WHEN** a workspace declares a dependency at a range no published version satisfies
- **THEN** this check SHALL pass
- **AND** the limitation SHALL be recorded in the check's own documentation so the gap is known rather than assumed covered

