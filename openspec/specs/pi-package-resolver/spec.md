# pi-package-resolver Specification

## Purpose

Shared helper (`packages/shared/src/pi-package-resolver.ts`) that resolves a pi peer package name to its install directory and importable entry path by walking pi-coding-agent's own `settings.json#packages[]` files (global + per-workspace). Handles the three install kinds pi supports — `npm:`, `git:`/`https:`/`ssh:`/`github:`, and absolute / relative local paths — and applies the same path arithmetic pi uses internally. Primary consumer: dashboard plugin bridges that need to dynamically `import()` a pi-installed peer (e.g. `@pi/anthropic-messages`) when Node's `createRequire(cwd).resolve` walk cannot reach the install location.

Read-only, read-on-call: never installs, never mutates. Its ONLY module-level state is the memoized `npm root -g` result; settings reads, `package.json` reads and resolution results are never cached. Two settings reads + N `package.json` reads per resolution.

## Requirements

### Requirement: Shared helper resolves package specs to absolute paths

The dashboard SHALL expose a `resolvePiPackage(spec, opts?)` function from `@blackbelt-technology/pi-dashboard-shared/pi-package-resolver` that accepts a package name string (matching `package.json#name`) and returns either `null` (no match) or an object containing `packageDir` (absolute path to the package root), `entryPath` (absolute path to the importable entry file, or `null` if no entry can be determined), `scope` (`"user"` or `"project"`), `source` (the original `settings.json` entry string), and `packageJsonName` (the parsed `name` field from `package.json`, or `null` if absent).

The function SHALL also export a convenience wrapper `resolvePiPackageEntry(spec, opts?)` that returns just the `entryPath` string or `null`.

The function SHALL be synchronous (no `Promise` return) so plugin bridges and tier-2 probe callers can use it in synchronous fall-through paths without forcing their entire chain to be async.

The function SHALL perform only filesystem reads — never writes and never network calls. It MAY spawn exactly one process per process lifetime: the memoized `npm root -g` probe used when the caller supplies no `npmRoot` (see the memoization requirements below). No other process spawning is permitted.

#### Scenario: Spec resolves to an npm-installed peer in global scope

- **GIVEN** `~/.pi/agent/settings.json` contains `"packages": ["npm:@pi/anthropic-messages"]`
- **AND** `~/.pi/agent/node_modules/@pi/anthropic-messages/package.json` declares `{"name": "@pi/anthropic-messages", "exports": {".": "./extensions/index.js"}}`
- **WHEN** a caller invokes `resolvePiPackage("@pi/anthropic-messages")`
- **THEN** the function SHALL return `{ packageDir: "~/.pi/agent/node_modules/@pi/anthropic-messages", entryPath: "~/.pi/agent/node_modules/@pi/anthropic-messages/extensions/index.js", scope: "user", source: "npm:@pi/anthropic-messages", packageJsonName: "@pi/anthropic-messages" }` (with `~` expanded to the user's home directory).

#### Scenario: Spec resolves to a git-cloned peer

- **GIVEN** `~/.pi/agent/settings.json` contains `"packages": ["https://github.com/BlackBeltTechnology/pi-anthropic-messages.git"]`
- **AND** the directory `~/.pi/agent/git/github.com/BlackBeltTechnology/pi-anthropic-messages/` exists with a valid `package.json` declaring `name: "@pi/anthropic-messages"` and `main: "./extensions/index.ts"`
- **WHEN** a caller invokes `resolvePiPackage("@pi/anthropic-messages")`
- **THEN** the function SHALL return a result whose `packageDir` points to the cloned directory and `entryPath` resolves the `main` field to an absolute path that exists on disk.

#### Scenario: Spec resolves to a peer installed via absolute path

- **GIVEN** `~/.pi/agent/settings.json` contains `"packages": ["/home/skrot1/BB/pi-packages/pi-anthropic-messages"]`
- **AND** the directory exists with a `package.json` declaring `name: "@pi/anthropic-messages"`
- **WHEN** a caller invokes `resolvePiPackage("@pi/anthropic-messages")`
- **THEN** the function SHALL return a result whose `packageDir` equals `/home/skrot1/BB/pi-packages/pi-anthropic-messages` and whose `entryPath` follows the entry-point resolution chain.

#### Scenario: Spec not found in any scope

- **GIVEN** neither `~/.pi/agent/settings.json#packages[]` nor `<cwd>/.pi/settings.json#packages[]` contains an entry whose resolved `package.json#name` matches `spec`
- **WHEN** a caller invokes `resolvePiPackage("@some/missing")`
- **THEN** the function SHALL return `null`.

### Requirement: Entry-point resolution follows a deterministic priority chain

For any matched package, the function SHALL determine `entryPath` by attempting each candidate in this order and returning the first whose target file exists on disk:

1. `package.json#exports["."]` — as a string, or `import` / `default` / `node` field when expressed as an object
2. `package.json#main`
3. `package.json#pi.extensions[0]` — pi-coding-agent's own legacy entry field
4. `index.js` relative to `packageDir`
5. `index.ts` relative to `packageDir`

If none of the five candidates resolve to an existing file, `entryPath` SHALL be `null` while `packageDir` is still returned.

#### Scenario: Modern package with exports field wins

- **GIVEN** a matched package's `package.json` contains `"exports": {".": "./dist/index.js"}` and a `main: "./legacy.js"`
- **AND** both `dist/index.js` and `legacy.js` exist on disk
- **WHEN** the resolver computes `entryPath`
- **THEN** it SHALL return the path to `dist/index.js` (exports wins over main).

#### Scenario: Legacy package with only pi.extensions

- **GIVEN** a matched package's `package.json` contains neither `exports` nor `main`, but has `"pi": {"extensions": ["./extensions/index.ts"]}`
- **AND** `./extensions/index.ts` exists relative to `packageDir`
- **WHEN** the resolver computes `entryPath`
- **THEN** it SHALL return the absolute path to `extensions/index.ts`.

#### Scenario: Bare package with index.js fallback

- **GIVEN** a matched package has no `exports`, `main`, or `pi.extensions`, but has an `index.js` at its root
- **WHEN** the resolver computes `entryPath`
- **THEN** it SHALL return the absolute path to `index.js`.

#### Scenario: Package found but no resolvable entry

- **GIVEN** a matched package whose `package.json` has none of the entry fields and no `index.js` / `index.ts` exists
- **WHEN** the resolver computes `entryPath`
- **THEN** it SHALL return `entryPath: null` in the result (the caller decides how to surface this).

### Requirement: Scope precedence mirrors pi's deepMergeSettings

The function SHALL support a `scope` option (`"user"`, `"project"`, or `"any"`, default `"any"`).

When `scope === "any"` and `opts.cwd` is provided, the function SHALL read `<cwd>/.pi/settings.json` first and consider its `packages[]` entries as project-scope; then read `~/.pi/agent/settings.json` and consider its `packages[]` entries as user-scope. Project-scope entries SHALL be searched first; the first match by `package.json#name` SHALL win.

When `scope === "project"`: the function SHALL only read `<cwd>/.pi/settings.json`. If `opts.cwd` is not provided, the function SHALL return `null` without reading anything.

When `scope === "user"`: the function SHALL only read `~/.pi/agent/settings.json` (or `opts.agentDir` if provided).

#### Scenario: Project scope wins when both scopes have the same name

- **GIVEN** `<cwd>/.pi/settings.json#packages[]` contains a local-path entry whose `package.json#name` is `"foo"`
- **AND** `~/.pi/agent/settings.json#packages[]` contains an `npm:foo` entry whose installed package's `name` is `"foo"`
- **WHEN** a caller invokes `resolvePiPackage("foo", { cwd })` with default `scope: "any"`
- **THEN** the function SHALL return the project-scope match and `result.scope === "project"`.

#### Scenario: Project-only lookup without cwd returns null

- **GIVEN** any global settings state
- **WHEN** a caller invokes `resolvePiPackage("foo", { scope: "project" })` without providing `cwd`
- **THEN** the function SHALL return `null` without reading any file.

### Requirement: Tier-2 fallback in plugin peer probes uses the shared resolver

The `flows-anthropic-bridge-plugin/src/peer-probe.ts` module SHALL accept an optional `resolvePiPackage` dependency in its `ProbeDeps` interface with the signature `(spec: string) => { entryPath: string } | null`. The `probePeer` helper SHALL first attempt `deps.resolve(spec)` (Node's `createRequire`-anchored resolver, unchanged from current behavior); on any thrown error, it SHALL fall through to `deps.resolvePiPackage?.(spec)` if provided. When the fallback returns a non-`null` value, the probe result SHALL include `ok: true`, `via: "pi-packages"`, and `entryPath: <absolute path>`. When tier-1 succeeds, the result SHALL include `ok: true, via: "node"` without an `entryPath` field.

The `flows-anthropic-bridge-plugin/src/bridge/index.ts` module SHALL pass `resolvePiPackage: (spec) => { const ep = resolvePiPackageEntry(spec, { cwd: process.cwd() }); return ep ? { entryPath: ep } : null; }` when constructing its `ProbeDeps`. After a successful probe, the dynamic import SHALL use the bare specifier when `via === "node"` and the absolute `entryPath` when `via === "pi-packages"`.

#### Scenario: Tier-1 resolves, tier-2 not consulted

- **GIVEN** `@pi/anthropic-messages` is reachable from `process.cwd()` via `node_modules` walk
- **WHEN** the bridge probes for the peer
- **THEN** `probePeer` SHALL return `{ ok: true, via: "node" }` and the bridge SHALL `await import("@pi/anthropic-messages")` by bare specifier.

#### Scenario: Tier-1 fails, tier-2 resolves from pi git cache

- **GIVEN** `@pi/anthropic-messages` is installed only at `~/.pi/agent/git/github.com/BlackBeltTechnology/pi-anthropic-messages/` (not reachable from cwd's `node_modules`)
- **AND** `resolvePiPackage` is wired as the tier-2 fallback
- **WHEN** the bridge probes for the peer
- **THEN** `probePeer` SHALL return `{ ok: true, via: "pi-packages", entryPath: "<absolute path to entry>" }` and the bridge SHALL `await import(<that absolute path>)`.

#### Scenario: Both tiers miss

- **GIVEN** `@pi/anthropic-messages` is not in `node_modules` nor in any pi settings entry
- **WHEN** the bridge probes for the peer
- **THEN** `probePeer` SHALL return `{ ok: false, reason: <description> }` and the bridge SHALL emit status `waiting_peers` as it does today.

### Requirement: Resolver source file is constrained to shared-only imports

The `packages/shared/src/pi-package-resolver.ts` source file SHALL NOT import from `packages/server/`, `packages/client/`, `packages/electron/`, or any workspace package other than `@blackbelt-technology/pi-dashboard-shared` itself and Node built-ins. A repo-lint test SHALL enforce this invariant by parsing the file's `import` declarations and asserting only allowed prefixes.

#### Scenario: Pull request adds disallowed import

- **WHEN** a pull request modifies `pi-package-resolver.ts` to add `import { foo } from "@blackbelt-technology/pi-dashboard-server/bar"`
- **THEN** the repo-lint test SHALL fail with a message naming the disallowed import and the resolver file path.

#### Scenario: Pull request adds Node built-in import

- **WHEN** a pull request adds `import { existsSync } from "node:fs"` to `pi-package-resolver.ts`
- **THEN** the repo-lint test SHALL pass (Node built-ins are allowed).

### Requirement: Memoization is scoped to the npm global root only

The resolver SHALL remain read-only and read-on-call: it never installs and never mutates. The memoized `npm root -g` result SHALL be its ONLY module-level state; settings reads, `package.json` reads, and resolution results SHALL NOT be cached. The capability Purpose sentence ("never installs, never mutates, never caches") and the module header ("holds no module-level cache") SHALL be updated to state this single exception.

#### Scenario: settings edits take effect without a restart

- **GIVEN** a package is added to `~/.pi/agent/settings.json#packages[]` after a first resolution
- **WHEN** `resolvePiPackageEntry` is called again in the same process
- **THEN** the new package SHALL resolve

#### Scenario: stated contract matches behaviour

- **WHEN** the change is archived
- **THEN** neither the capability Purpose nor the module header SHALL claim the resolver never caches

### Requirement: Default npm global root is memoized per process

`resolvePiPackageEntry` and `listPiPackages` SHALL shell out to `npm root -g`
(via `rootGlobalOr("")`) at most once per process when `opts.npmRoot` is
absent, caching the result (including an empty-string result) for every later
call. `opts.npmRoot` SHALL bypass the cache. A test-only reset export SHALL
clear the cache.

#### Scenario: Repeated resolves shell out once

- **WHEN** `resolvePiPackageEntry` is called three times and `listPiPackages`
  once, none with `npmRoot`
- **THEN** `rootGlobalOr` is invoked exactly once

#### Scenario: Explicit npmRoot bypasses the cache

- **WHEN** `resolvePiPackageEntry(spec, { npmRoot: "/tmp/x" })` is called
- **THEN** `rootGlobalOr` is not invoked and `/tmp/x` is used

#### Scenario: Missing npm is cached too

- **WHEN** `rootGlobalOr` returns `""`
- **THEN** subsequent default resolves do not invoke it again

#### Scenario: Extension load cost

- **WHEN** an extension whose activation calls `resolvePiPackageEntry` is
  instantiated for N child sessions in one process
- **THEN** only the first instantiation pays the `npm root -g` cost
