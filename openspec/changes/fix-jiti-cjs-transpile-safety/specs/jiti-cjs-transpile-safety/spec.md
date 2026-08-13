## ADDED Requirements

### Requirement: First-party TypeScript SHALL transpile to CommonJS without retaining `import.meta`

No first-party TypeScript source reachable from a jiti-loaded entry point SHALL
compile to a module that retains `import.meta` in **code position** after jiti's
transform. Occurrences inside comments or string literals are exempt — they
cannot produce a syntax error, and the transform preserves both.

Rationale, verified against jiti's own transform: jiti compiles TypeScript to
CommonJS and evaluates it in a `vm` function wrapper. Raw `import.meta` is a
`SyntaxError` there, and jiti's sole recovery is to re-import the module as
native ESM through a `data:text/javascript;base64,…` specifier. Node accepts such
a specifier; a Bun single-file executable resolves it as a package name against
its embedded filesystem and fails with `NameTooLong`. jiti's oversized-payload
guard keys on `err.code === "ENAMETOOLONG"` and so does not fire for Bun's
`ResolveMessage`.

The erasure is defeated by a **TypeScript cast**, not by how the property is
used. jiti's visitor matches only when the member expression's `object.type` is
`MetaProperty`; a cast makes it `TSAsExpression`. Measured behaviour:
`import.meta.url` is inlined to a string literal; `import.meta.resolve(id)` and
an *uncalled* `import.meta.resolve` both become `jitiESMResolve`; even
`(import.meta as any).env` is rewritten to `process.env`. Only a cast-wrapped
`.resolve` survives.

#### Scenario: A cast-wrapped `import.meta` is rejected

- **GIVEN** a first-party module containing
  `const r = (import.meta as unknown as { resolve?: (s: string) => string }).resolve`
- **WHEN** the module is passed through jiti's `transform()` in CommonJS mode
- **THEN** the emitted source SHALL be observed to retain `import.meta` in code
  position
- **AND** the gate SHALL fail naming that file

#### Scenario: Erasable shapes are accepted

- **GIVEN** a first-party module using `import.meta.url`, a called
  `import.meta.resolve(id)`, and an uncalled `import.meta.resolve`
- **WHEN** the module is transpiled in CommonJS mode
- **THEN** the emitted source SHALL retain no `import.meta` in code position

#### Scenario: A bridge-reachable module never takes jiti's ESM fallback

- **GIVEN** the bridge's import graph
  (`bridge.ts` → `command-handler.ts` → `shared/tool-registry/index.js` →
  `strategies.ts`)
- **WHEN** every module in that graph is transpiled in CommonJS mode
- **THEN** no module SHALL require jiti's native-ESM fallback
- **AND** no `data:text/javascript` specifier SHALL be constructed for any of them

### Requirement: The gate SHALL detect `import.meta` at AST level, not textually

The gate SHALL determine code-position occurrences by parsing the emitted module
and locating `MetaProperty` nodes. A substring or regular-expression search over
the emitted text SHALL NOT be used.

This is not a style preference — a textual check is provably wrong in both
directions against this repo's own files. jiti's output preserves comments, so a
textual check reports `packages/extension/src/model-tracker.ts` and
`packages/server/src/changelog/changelog-fs.ts` as violations though both mention
`import.meta` only in doc-comments. It also preserves string literals, so any
module containing the token inside a string — an error message, a lint rule name,
a doc snippet — would be reported. Both classes are false positives that would
make the gate un-landable or force an allow-list, and an allow-list is the thing
this gate exists to avoid.

#### Scenario: Comment-only occurrence is not a violation

- **GIVEN** a module mentioning `import.meta.resolve` only inside a doc-comment
- **WHEN** the gate runs
- **THEN** the module SHALL NOT be reported

#### Scenario: String-literal occurrence is not a violation

- **GIVEN** a module containing `const msg = "import.meta.resolve is unavailable"`
- **WHEN** the gate runs
- **THEN** the module SHALL NOT be reported

#### Scenario: The repo's existing erasable-shape files stay green

- **WHEN** the gate runs against `packages/extension/src/model-tracker.ts` and
  `packages/server/src/changelog/changelog-fs.ts` unmodified
- **THEN** neither SHALL be reported
- **AND** the reason SHALL be recorded as *erasable shapes*, NOT "comment-only":
  both use `import.meta` in **code** position — `model-tracker.ts:143`
  (`import.meta.resolve(spec)`, a direct uncast call) and
  `changelog-fs.ts:103,120` (`createRequire(import.meta.url)` and a bare
  `import.meta.url`). jiti erases all three shapes, which is precisely why they
  are green
- **AND** these files therefore prove the *erasure* limb of the gate, while the
  fixture in the preceding scenarios proves the comment/string limb

### Requirement: The gate's scope SHALL be a derived rule over jiti-loaded source

The gate SHALL determine its file set from a **rule** — first-party TypeScript
that **jiti** evaluates at runtime from source — rather than an enumerated list
of workspaces. A newly added file, or a newly added workspace that meets the
rule, SHALL be covered with no edit to the gate.

The criterion is *evaluated by jiti*, not *executed from source*. Those are not
the same set, and conflating them was a defect in an earlier draft (see the
`bin` exclusion below).

The rule SHALL be derived from package manifests plus one import walk. The
**seeds** are:

1. **`pi.extensions` entries** pointing at a `.ts` file — loaded by the pi host
   through jiti.
2. **The dashboard server's own entry.** `packages/server` declares
   `main: src/cli.ts`, and its `bin/pi-dashboard.mjs` wrapper re-execs Node with
   `--import <jiti-url> cli.ts`. The whole of `packages/server/src/**` is
   therefore jiti-evaluated. The `bin` field is `.mjs`, so no manifest limb
   keyed on `bin` can discover this — it SHALL be seeded from a workspace whose
   `main` is a `.ts` file.
3. **`pi-dashboard-plugin` `server` and `bridge` entries** pointing at a `.ts`
   file. `packages/dashboard-plugin-runtime/src/server/loader.ts:442` loads them
   with `await import(plugin.serverEntryPath)` over glob-discovered paths, so
   **no static specifier exists** and no import walk can reach them. They SHALL
   be read from the manifests directly.

The **walk** is transitive and first-party, seeded from all three, following ESM
`import` specifiers **and** CJS `require()` calls (jiti transpiles both),
resolving relative specifiers and workspace package names, and stopping at
`node_modules`.

`packages/dashboard-plugin-runtime/src/server/` is reached by the walk from
seed 2 (`packages/server/src/server.ts` imports it) — **not** from
`packages/extension/src/bridge.ts`, which has no edge to it. It SHALL NOT be
hardcoded.

Enumerating the rule against the tree at time of writing yields four
`pi.extensions` entry points, not one. An earlier draft of this change named
only the first and would have left the other three uncovered:

| Workspace | `pi.extensions` |
|---|---|
| `packages/extension` | `src/bridge.ts` |
| `packages/image-fit-extension` | `src/extension.ts` |
| `packages/kb-extension` | `src/extension.ts` |
| `packages/mockup-loop` | `src/extension.ts` |

All four ship raw `.ts` and are transpiled in a live pi session — precisely the
condition that produced this bug. `packages/mockup-loop/src/presets/contract.ts`
already uses `import.meta.url`; it is benign only because that shape is
erasable, leaving it one TypeScript cast away from reproducing the fault.

Seed 3 qualifies **fourteen** entries across eleven workspaces (ten `server`,
four `bridge`), all raw `.ts`: `apple-tools`, `automation-plugin`,
`blackhole-plugin`, `flows-anthropic-bridge-plugin`, `flows-plugin`,
`goal-plugin`, `hermes-memory-plugin`, `kb-plugin`, `mcp-server-plugin`,
`subagents-plugin` declare `server`; `automation-plugin`,
`flows-anthropic-bridge-plugin`, `flows-plugin`, `goal-plugin` also declare
`bridge`. An earlier draft said "twelve across ten", omitting `blackhole-plugin`
and `mcp-server-plugin` — a live re-instance of the hand-enumeration decay this
change's correction-of-record already documents twice, and precisely why the
gate SHALL derive this set rather than hardcode it, and why the assertion below
is a superset check.

The assertion over each derived seed set SHALL be a **superset** check — every
entry known at authoring time is present — not an equality check. Equality would
turn the gate red exactly when a new extension or plugin is added correctly,
contradicting the "covered with no edit" property this requirement exists to
provide.

The scope SHALL exclude, and SHALL document why it excludes:

- **Client/browser source compiled by Vite**, which legitimately uses
  `import.meta.env` and never passes through jiti.
- **Build output and untracked artefacts**, notably `packages/electron/out`,
  which is gitignored, exists on any machine that has run a local Electron
  build, and contains `.tsx` retaining `import.meta` in code position. A naive
  recursive walk false-positives there and the failure reproduces only on
  developer machines — the worst possible failure signature for a repo gate.
- Test files and `__tests__` directories.

The scope SHALL therefore include the whole of `packages/server/src/**` and
`packages/dashboard-plugin-runtime/src/server/**`, both reached from seed 2.
This matters beyond coverage: `packages/server/src/changelog/changelog-fs.ts` is
one of the two files the erasure scenarios above rely on, and under a rule that
omitted `packages/server/src` those scenarios would have passed **vacuously** —
asserting "SHALL NOT be reported" about a file the gate never opened.

**Raw-`.ts` `bin` entries are OUT of scope**, and the exclusion is load-bearing
enough to state explicitly. Five workspaces ship one (`apple-tools`,
`dashboard-plugin-skill`, `nano-banana`, `video-production`,
`video-transcription`), and an earlier draft of this requirement included them
on the reasoning that "executed from source implies transpiled by the host,
therefore the same fault class applies." That reasoning is **wrong**. Each entry
carries a `#!/usr/bin/env node` shebang and is executed by Node's **native
type-stripping** (unflagged since Node 22.18; the repo's floor is `>=22.19.0`),
which treats the file as ESM. There is no CJS wrapper, so a retained
`import.meta` raises no `SyntaxError`, triggers no native-ESM fallback, and
produces no `data:` URL. Verified by executing a `.ts` file containing the exact
cast-wrapped shape under `node` directly: it runs cleanly and reports
`typeof resolve === "function"`.

Including them would have widened the gate on a false premise. If a bin is ever
spawned *through* jiti, it enters scope via the seeds above and no rule change is
needed.

`packages/client-utils` was examined and is **out** of scope: no server-side
source under `packages/*/src/server/` or `packages/server/src/` imports it, so
it is reached only through the Vite client path.

#### Scenario: A newly added workspace is covered without editing the gate

- **WHEN** a new workspace containing jiti-loaded server source is added
- **THEN** the gate SHALL include its files on the next run
- **AND** no change to the gate SHALL be required

#### Scenario: A local Electron build does not turn the gate red

- **GIVEN** a working tree where `packages/electron/out` exists from a prior
  local build
- **WHEN** the gate runs
- **THEN** no file under that directory SHALL be reported
- **AND** the gate's verdict SHALL match a clean checkout's verdict

#### Scenario: Vite-only client source is out of scope

- **GIVEN** a client component using `import.meta.env`
- **WHEN** the gate runs
- **THEN** the component SHALL NOT be reported

#### Scenario: Every `pi.extensions` entry point is covered

- **GIVEN** the four workspaces declaring a `pi.extensions` `.ts` entry
  (`extension`, `image-fit-extension`, `kb-extension`, `mockup-loop`)
- **WHEN** the gate computes its file set
- **THEN** the transitive first-party import graph of each entry SHALL be included
- **AND** the set SHALL be derived by reading `pi.extensions` from the manifests,
  so that a fifth extension workspace is covered without editing the gate

#### Scenario: Dynamically imported plugin entries are covered

- **GIVEN** the `pi-dashboard-plugin` `server` and `bridge` `.ts` entries, loaded
  at `loader.ts:442` via `await import(plugin.serverEntryPath)` over
  glob-discovered paths
- **WHEN** the gate computes its file set
- **THEN** all of them SHALL be in scope
- **AND** they SHALL be read from the manifests, because no static specifier
  exists for an import walk to follow
- **AND** the assertion SHALL be a superset check, so a newly added plugin is
  covered without editing the gate

#### Scenario: The dashboard server's own source is covered

- **GIVEN** `packages/server`, whose `main` is `src/cli.ts` and whose
  `bin/pi-dashboard.mjs` re-execs Node with `--import <jiti-url> cli.ts`
- **WHEN** the gate computes its file set
- **THEN** `packages/server/src/**` SHALL be in scope
- **AND** the seed SHALL key on `main` resolving to a `.ts` file, since keying on
  `bin` would miss it — `bin` points at the `.mjs` wrapper

#### Scenario: A raw-TypeScript `bin` is NOT in scope

- **GIVEN** a workspace whose only raw-`.ts` entry is a `bin` with a
  `#!/usr/bin/env node` shebang, reachable from no jiti seed
- **WHEN** the gate runs
- **THEN** its source SHALL NOT be reported
- **AND** the justification SHALL be that native type-stripping evaluates it as
  ESM, so no CJS wrapper exists and the fault class cannot arise

### Requirement: The gate SHALL be proven to fail closed

The gate SHALL be exercised against a fixture known to retain `import.meta` in
code position and SHALL report it as a violation. The gate SHALL additionally
assert that its discovered file set is non-empty, so a mis-globbed or empty walk
cannot read as a pass.

The gate SHALL NOT assert a hardcoded lower bound on the file count beyond
non-emptiness: a magic floor breaks under legitimate workspace restructuring and
buys nothing that the fixture proof does not already provide.

#### Scenario: Fixture proves the checker fires

- **WHEN** the gate runs against a fixture containing a cast-wrapped
  `import.meta`
- **THEN** the fixture SHALL be reported as a violation

#### Scenario: Empty file set is a failure, not a pass

- **WHEN** the discovery rule yields no files
- **THEN** the gate SHALL fail
- **AND** SHALL state that discovery, not compliance, is the problem

### Requirement: The host-side escape hatch SHALL be documented

`docs/faq.md` SHALL record `JITI_ESM_EVAL_TEMP_FILE=1` as the zero-code remedy
for a host whose module resolver rejects `data:` specifiers, stating that it
makes jiti write the fallback module to a temporary `.mjs` file and import it by
path.

The entry SHALL be reachable from **both** symptoms a user can observe, because
jiti's ESM fallback is async-only:

- the async path — `NameTooLong` while resolving a
  `data:text/javascript;base64,…` "package";
- the sync path — a bare `SyntaxError` on `import.meta`, with no `NameTooLong`
  text to search for.

The entry SHALL state that `-ne` is not an acceptable workaround because it
disables the bridge, and SHALL note that the temp-file path requires a writable
`os.tmpdir()`, which a sandboxed or read-only host may not provide.

#### Scenario: A user searches by the async-path error text

- **GIVEN** a user whose host fails with
  `NameTooLong while resolving package 'data:text/javascript;base64,…'`
- **WHEN** they search `docs/faq.md` for `NameTooLong` or `data:text/javascript`
- **THEN** they SHALL find the entry
- **AND** the entry SHALL give `JITI_ESM_EVAL_TEMP_FILE=1` as the remedy

#### Scenario: A user searches by the sync-path error text

- **GIVEN** a host that loads the module synchronously and reports a bare
  `SyntaxError` mentioning `import.meta`
- **WHEN** they search `docs/faq.md` for that symptom
- **THEN** they SHALL reach the same entry
