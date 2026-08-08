# Design — cleanup-undeclared-dependencies

## Context

`noUndeclaredDependencies` reports **1398 findings at repo-root scope** (the scope
`biome lint .` uses in CI). The rule is installed but disabled; enabling it is
`add-typeaware-lint-gate`'s job, and that flip is blocked until this change
leaves the rule at zero.

The findings are not homogeneous. They decompose into four groups with different
correct treatments:

| Group | Count | Why it fires |
|---|---|---|
| test files | ~1288 | root-hoisted devDeps vs Biome's nearest-manifest resolution |
| build/config + build scripts under `packages/` | ~34 | same, in files that are never published |
| runtime imports in package source | ~48 sites / ~18 deps / 12 manifests | **real**: published code importing undeclared packages |
| outside `packages/` | 28 | root `scripts/` tooling, plus non-shipped trees (examples, spikes, flow fixtures) |

Reproduce with `--only`, **not** `--config-path` (a probe config outside the repo
fails Biome's ignore-file resolution):

```bash
npx biome lint --only=correctness/noUndeclaredDependencies . --max-diagnostics=20000
```

**Constraint that shapes everything below:** the existing quality oracle
(`biome check --changed` + `tsc --noEmit` + vitest) runs inside the monorepo,
where hoisting resolves every import regardless of what the manifests claim. A
manifest that lies passes every gate the project owns. This change therefore has
to bring its own oracle.

## Goals / Non-Goals

**Goals**

- `noUndeclaredDependencies` reports **zero** at repo-root scope.
- Every published workspace's manifest accurately describes what its shipped code
  imports.
- A verification mechanism that can actually detect this defect class.

**Non-Goals**

- Promise handling (`cleanup-client-plugin-promises`,
  `cleanup-async-semantics-server-extension`), import cycles
  (`cleanup-import-cycles`), severity flips (`add-typeaware-lint-gate`).
- Upgrading or deduplicating dependencies. Ranges are chosen to match what
  already resolves — this change does not move any version.
- Fixing the pre-existing drift it surfaces (see Adjacent Findings).

## Decisions

### D1 — Declare everything; zero suppressions

Every flagged import gets a manifest entry in the appropriate field. No
`biome-ignore` suppressions for the runtime group.

*Alternatives rejected:* (a) suppress type-only imports, on the theory that they
are erased at build and cannot break a consumer at runtime — rejected because it
creates a second, subtler rule ("is this import erased?") that a future
contributor must re-derive per site, and because a type-only import still breaks
a consumer's `tsc`; (b) suppress the deliberately-optional dynamic imports —
rejected for the same reason, and because an optional dependency has a correct
declarative expression (`peerDependenciesMeta.optional`), so suppression would be
hiding information the manifest is designed to carry.

*Consequence:* the largest manifest churn of the three options, and the reason
this change is scoped to nothing else.

### D2 — Concrete ranges, chosen by an explicit rule

Ranges are not invented per edit. The rule, in precedence order:

1. **Reuse an existing repo range — but only if the resolving version satisfies
   it.** This preserves de-facto lockstep without propagating a broken range.
2. **If the existing range is unsatisfiable by what resolves, do NOT reuse it.**
   Use a caret range on the resolving version and record the divergence. Two
   ranges in this repo are already in this state (`typebox: ^1.3.7` vs installed
   `1.3.6`; `vitest: ^2.1.8` in four packages vs installed `4.1.10`) — an earlier
   draft of this rule would have propagated them, writing a known-broken manifest.
3. **Otherwise use a caret range on the currently-resolving version**, verified
   against `node_modules/<dep>/package.json`.
4. **Never `"*"`.** The `workspace-publishing` requirement is *"resolvable
   concrete semver"*; `"*"` satisfies neither adjective.
5. **When siblings disagree, take the narrowest range that the resolving version
   satisfies.** (`wouter` has three: `>=3.0.0`, `^3.0.0`, `^3.9.0`; resolved
   `3.10.0` satisfies all, so `^3.9.0` wins.) This rule replaces the previous
   "match the sibling", which did not fire deterministically.

Applied:

| Dep | Resolves | Existing repo range | Declare as |
|---|---|---|---|
| `@mdi/js` | 7.4.47 | `^7.4.47` | `^7.4.47` |
| `@mdi/react` | 1.6.1 | `^1.6.1` | `^1.6.1` |
| `fastify` | 5.10.0 | `^5.0.0` | `^5.0.0` |
| `wouter` | 3.10.0 | `^3.0.0` / `^3.9.0` / `>=3.0.0` | `^3.9.0` (narrowest satisfied — rule 5) |
| `react` | 19.2.7 | `>=18.0.0` peer / `^19.0.0` dev | peer `>=18.0.0`, dev `^19.0.0` — mirror `dashboard-plugin-runtime` |
| `vite` | 6.4.3 | `^6.0.0` | `^6.0.0` |
| `@vitejs/plugin-react` | 4.7.0 | `^4.3.4` | `^4.3.4` |
| `dagre-d3-es` | 7.0.14 | **none** | `^7.0.14` |
| `tar` | 6.2.1 | **none** | `^6.2.1` |
| `@electron-forge/shared-types` | 7.11.2 | **none** | `^7.11.2` |
| `jiti` | 2.7.0 | `^2.7.0` | `^2.7.0` (root) |
| `yaml` | 2.9.0 | `^2.9.0` | `^2.9.0` (root) |
| `@earendil-works/pi-ai` | 0.75.5 | `*` peer / `^0.75.5` dev | **optional peer at `^0.75.5`** — concrete, not `"*"` |
| `typebox` | 1.3.6 | `*` peer / **`^1.3.7` dev (unsatisfiable)** | `^1.3.6` — rule 2 applies; do NOT reuse `^1.3.7` |
| `@blackbelt-technology/pi-anthropic-messages` | **not installed** | none | see exception below |

Verified safe: the `pi-ai` import at `provider-register.ts:652` is inside a
`try { … } catch { return {}; }`, so optional-peer semantics genuinely hold — a
consumer without the package degrades rather than throwing.

**Two exceptions that cannot follow the rule**, recorded rather than forced:

- **`@blackbelt-technology/pi-anthropic-messages` is not installed.** The bridge
  resolves it at runtime via `probeAll()` and falls back to the legacy
  `@pi/anthropic-messages` name. There is no locally-resolving version to pin,
  and npm has `0.3.4`. Declaring `^0.3.4` is possible but **unverifiable in this
  tree** — the oracle in D4 cannot confirm it. Options are to declare `^0.3.4`
  unverified, or leave it an optional peer at `"*"` and accept one documented
  exception to D2. **This is the one decision left open** (see Open Questions).
- **`@pi/anthropic-messages` MUST NOT be declared at all.** `npm view` returns
  **E404** — the package does not exist. It is a legacy pre-rescope name behind a
  `@ts-expect-error` fallback that can never resolve for a consumer. Declaring it
  would write unresolvable metadata into a published manifest, which is exactly
  what `workspace-publishing` forbids. This is the single permitted suppression,
  and it is a suppression of a *phantom*, not of a real dependency.

### D3 — Field selection per dep, not per package

Biome accepts `dependencies`, `devDependencies`, `peerDependencies`, and
`optionalDependencies` as satisfying the rule, so the field choice is a
*publishing* decision, not a linting one:

| Situation | Field | Why |
|---|---|---|
| imported by shipped runtime code | `dependencies` | consumer needs it installed |
| imported by shipped code but host-provided | `peerDependencies` + `peerDependenciesMeta.optional` | matches the existing `pi-coding-agent` / `pi-tui` convention and the `try/catch` import design |
| imported only by non-shipped files (build scripts, `test-support`, configs) | `devDependencies` | never reaches a consumer |
| type-only import in a published package | `peerDependencies` (optional) or `devDependencies` | **never `dependencies`** — see D3a |

**D3a — `react` in `packages/shared` is the load-bearing case.** The import is
`import type { ComponentType, ReactNode }`, and `ui-primitives.ts` documents *"no
React runtime cost for non-renderer consumers."* Putting `react` in
`dependencies` would ship React to every consumer of a published package and
break the single-instance invariant. It is declared, per D1 — but as a peer/dev,
never a dependency. The same applies to `demo-plugin` (private, so lower stakes).

### D4 — The verification oracle: static resolution over the packed file list

Two candidate oracles were evaluated and **rejected on capability grounds**:

| Candidate | Why it fails |
|---|---|
| `publint` / `@arethetypeswrong/cli` | They validate `exports` maps and type resolution. They do **not** check dependency resolvability, so they cannot detect an undeclared dep masked by hoisting — this change's entire defect class. |
| `npm pack` + clean install + "import the entry point" | False-fails on optional peers (`pi-ai`'s absence is *correct* behaviour, handled by `try/catch`). Entry points also need host context — a pi session, fastify, an electron runtime — that a bare fixture lacks, so failures would be unrelated to declarations. Worse, cross-workspace deps at `^0.7.0` resolve to the **published** 0.7.0, so the fixture tests released code rather than the change under test. |

**Chosen:** a static check, executing nothing.

```
for each touched public workspace:
  npm pack --dry-run --json      → the exact shipped file list
  parse every import/require/dynamic-import specifier in those files
  for each specifier:
    bare specifier → assert it resolves to a declaration in THAT package's own
                     manifest (dependencies | devDependencies | peerDependencies
                     | optionalDependencies) or is a Node builtin
    relative       → assert the target is itself in the shipped file list
```

**Specifier normalization is part of the spec, not an implementation detail.**
Three shapes must be handled explicitly, because two of them are neither "bare"
nor "relative":

| Shape | Example | Resolve to |
|---|---|---|
| bare | `fastify` | package name `fastify` |
| scoped | `@mdi/react` | package name `@mdi/react` (first **two** segments) |
| deep subpath | `dagre-d3-es/src/dagre/index.js` | package name `dagre-d3-es` (strip after the package name; scoped variants keep two segments) |
| relative | `./foo.js` | assert the target is in the shipped file list |

**Known-exception allowlist (required).** The oracle does not read
`biome-ignore` comments, so without an allowlist it will flag the one specifier
this change deliberately does not declare — the phantom `@pi/anthropic-messages`
at `flows-anthropic-bridge-plugin/src/bridge/index.ts:147`. The allowlist is
explicit, per-specifier, and carries a reason string.

**The oracle is deliberately STRICTER than Biome.** Biome's
`noUndeclaredDependencies` accepts all four dependency fields, including
`devDependencies`. This oracle does not: for a **shipped** file, only
`dependencies`, `peerDependencies`, and `optionalDependencies` satisfy an import.
A `devDependency` is not installed for a consumer, so a shipped file importing
one is a consumer-visible break Biome's rule structurally cannot see. The two
checks answer different questions — Biome: *"is this declared anywhere?"*; this
oracle: *"will this resolve for someone who installed the tarball?"* — and must
not be collapsed.

**Scope risk this creates:** because the oracle is stricter, it can surface
findings the Biome probe never reported — a shipped file importing a devDep is
invisible to the 1398 baseline. **Implementation must run the oracle early**, so
any such findings are known while the change is still open rather than after it
closes.

**Runtime budget: under 60s on CI** across all non-private workspaces. It runs on
every pull request; an unbounded gate is a gate people disable.

**Fixture strategy: inline temp directory.** The known-bad fixture is built at
runtime in `os.tmpdir()` and the checker invoked as a library. A committed
fixture workspace under `packages/` would be scanned by the repo-wide run and
fail by design — circular. Building it at runtime leaves no artifact to exclude.

**What this oracle does and does not prove.** It proves *the manifest declares,
with a concrete range, every package the shipped code imports*. It does **not**
prove those ranges install — a declared `^99.0.0` would pass. Full resolvability
needs a registry round-trip, which the rejected install oracle showed is
unreliable here. This is a deliberate, bounded gap, not an oversight.

**It also does not catch the `exports`-map class of bug.** An earlier draft
claimed the relative arm caught `client`'s `exports["./chat-embed"] → src/` "for
free" — that is **false**: the oracle walks shipped files, and the bad reference
lives in the exports map, which no shipped file imports. Catching it needs a
separate check that walks `exports` targets against the shipped file list. Worth
adding, but it is a distinct check and must be named as one.

**Cross-workspace specifiers** (`@blackbelt-technology/pi-dashboard-shared` etc.)
are treated as ordinary bare specifiers — they must appear in the manifest like
any other, which `workspace-publishing`'s plain-semver requirement already
demands.

Lives in `scripts/`, matching the repo's existing convention
(`verify-release-deps.mjs`, `verify-lockfile-versions.mjs`), and wires into
`ci.yml` alongside them.

### D5 — Override globs are derived, with an over-match guardrail

The build/config glob set is **derived from probe output**, not guessed. The naive
list (`**/vitest.config.ts`, `**/vite.config.ts`, `**/forge.config.ts`) provably
misses `packages/electron/vite.main.config.ts`, `vite.preload.config.ts`,
`packages/client/scripts/vite-build.mjs`, and
`packages/electron/scripts/download-git-windows.mjs`.

**Guardrail:** re-running the probe to zero proves *coverage* but cannot detect an
*over-broad* glob — a wrongly-matched source file also reports zero. The override
must therefore additionally be asserted to match **no file under any `src/**`**.

Biome merges overrides **per rule**. The existing `packages/client/**` override
sets only a11y rules and the new block sets only `noUndeclaredDependencies`, so
they cannot conflict and ordering is not load-bearing here. (An earlier draft
overstated this as a general last-wins hazard.) Ordering would matter only if a
future override set the same rule.

### D6 — Out-of-`packages/` policy

| Path | Treatment |
|---|---|
| root `scripts/` (`jiti`, `yaml`) | **declare at root as `devDependencies`** |
| `examples/`, `openspec/changes/**/spike/`, `.pi/flows/**` fixtures | **ignore** via `files.includes` — not shipped, not maintained as packages |
| `tests/e2e/` | **ignore** — test tree, never published |
| `qa/scripts/` | **ignore** — VM smoke harness, never published |
| `.pi/skills/**/scripts/` | **ignore** — skill helper scripts, not a package |

**Why `devDependencies` for the root scripts, not `dependencies`:** the root
`package.json` is itself a published metapackage
(`@blackbelt-technology/pi-agent-dashboard`, no `private` flag), and its `files`
array ships only `scripts/maybe-patch-package.cjs` and
`scripts/fix-pty-permissions.cjs`. The scripts importing `jiti`/`yaml`
(`generate-plugin-registry.mjs`, `check-skill-frontmatter.mjs`,
`measure-replay-compaction.mjs`) are **not shipped**, so declaring their imports
as runtime `dependencies` would push `jiti` and `yaml` onto every consumer of the
metapackage for code they never receive.

All five categories are decided here. The proposal asked design to stop punting
this mapping; deferring any category to "decide during implementation" would be
the same non-decision in a new place.

### D7 — Extend the `workspace-publishing` enumeration

The spec currently enumerates four published workspaces (`shared`, `extension`,
`server`, `client`) plus the root metapackage. The tree has **32 non-private
workspaces**. The delta extends the requirements to cover all of them.

**Scenario shape: set-based, not per-package.** Requirements are rewritten as
*"every non-private workspace under `packages/` SHALL …"* with one scenario per
requirement quantifying over the set, rather than one scenario per package.

*Alternatives rejected:* (a) full per-package enumeration for all 32 — the
existing spec carries ~14 per-package scenarios across 4 packages, so naive
scaling implies 80+ scenarios, an unreviewable delta from which `tasks.md` cannot
be derived; (b) per-package scenarios only for the 12 packages this change
touches — leaves 20 workspaces ambiguous, the exact gap the extension exists to
close; (c) a generic requirement with no enumeration — drops testability.

Set-based scenarios stay testable precisely because the D4 oracle enumerates the
set mechanically: "every non-private workspace" is a computable predicate, not
prose.

**The `bus-client` collision, and how it is resolved.** Extending the enumeration
asserts the public-access requirement over all 32, and `bus-client` is the only
one without `publishConfig.access` — verified, though it *is* on npm at `0.7.0`.
An OpenSpec delta whose scenario fails against the repo is rejected at
verify-change, so the extension cannot land as-is.

**Resolution: this change adds `publishConfig: { access: "public" }` to
`packages/bus-client/package.json`.** One line. A deliberate, named exception to
the surgical-changes rule, justified because it is the *same*
`workspace-publishing` requirement this change already modifies — extending a
requirement while knowingly leaving it false would be worse than the fix. A
grandfather clause and a dependency-requirement-only extension were both
considered and rejected as carrying more long-term ambiguity than the one line
costs.

This is the **only** adjacent finding this change fixes. The rest stay recorded
and untouched.

## Risks / Trade-offs

- **[Declaring changes consumer install graphs]** → Ranges are chosen to match
  what already resolves (D2), so no version moves. The D4 oracle verifies the
  result from the consumer's perspective.
- **[The test-file grandfather is a permanent blind spot]** → ~1288 findings
  silenced, only ~1030 of which are `vitest`. Once the rule is at `error`, test
  files can accumulate undeclared imports with no signal. Accepted; per-package
  declaration across 31 packages costs more than the defect class is worth.
  `add-typeaware-lint-gate` must record the hole at graduation rather than imply
  a clean zero.
- **[The build-script override is the same hole, smaller]** → It covers build
  *scripts*, not just `*.config.ts`, so future build scripts in published
  packages are blind. Bounded by the D5 `src/**` guardrail.
- **[Extending the enumeration widens this change's spec surface]** → 32
  workspaces instead of 4. Mitigated by set-based scenarios (one per requirement,
  quantified over a computable set) rather than 80+ per-package scenarios.
- **[The enumeration asserts requirements over 20 workspaces nobody audited]** →
  only 6 of 32 were sampled for registry presence. If any non-private workspace
  is not actually published, the set-based scenario fails. **Implementation must
  enumerate and verify all 32 before the delta is asserted**, not after.
- **[The oracle is new code that can itself be wrong]** → It must be tested
  against a known-bad fixture (a manifest deliberately missing a dep) as well as
  the real packages, or it will pass vacuously.

## Migration Plan

1. Re-derive the baseline with `--only` at repo root (counts here are a snapshot).
2. Land the two Biome overrides + the out-of-`packages/` ignore policy; re-probe
   and confirm the expected groups drop to zero and the `src/**` guardrail holds.
3. Declare the runtime deps, one manifest at a time, per D2/D3.
4. Stand up the D4 oracle; run it against a known-bad fixture first, then the
   touched packages.
5. Re-probe to zero at repo-root scope.
6. `add-typeaware-lint-gate` flips the severity in a later change.

**Rollback:** every step is a manifest or config edit with no runtime coupling;
revert is a `git revert`. The oracle is additive and can be disabled without
affecting the declarations.

## Adjacent Findings — recorded, not fixed

Surfaced while designing; **out of scope** per the surgical-changes rule:

- ~~**`bus-client`** is published with no `publishConfig.access`~~ — **FIXED BY
  THIS CHANGE** (see D7). The only adjacent finding this change repairs, because
  it is the same requirement the change modifies.
- **`vitest: "^2.1.8"`** is declared by four published packages
  (`dashboard-plugin-skill`, `nano-banana`, `video-production`,
  `video-transcription`) while the tree resolves **4.1.10** — the declared range
  is unsatisfiable by what is installed.
- **`typebox: "^1.3.7"`** in `packages/extension` devDeps while **1.3.6** is
  installed — also unsatisfiable.
- **`packages/client`** declares `files: ["dist/"]` but
  `exports["./chat-embed"] → "./src/chat-embed/index.ts"` — an exported subpath
  absent from the tarball. The D4 oracle will flag this; the fix is not this
  change's.
- **`scripts/sync-versions.js`** keeps only internal `@blackbelt-technology/*`
  specifiers in lockstep, so two plugins could declare `fastify` at different
  majors undetected.
- **`typebox` is not a phantom name** — the unscoped `typebox@1.3.10` genuinely
  exists (`@sinclair/typebox` is a different package). Checked because it looked
  like the `@pi/anthropic-messages` failure mode; it is not. No action.

## Open Questions

- **How is `@blackbelt-technology/pi-anthropic-messages` declared?** It is not
  installed, so D2's concrete-range rule cannot be verified locally. Declare
  `^0.3.4` unverified, or keep it an optional peer at `"*"` as a documented
  exception to D2?
- **~~Does `dagre-d3-es` resolve for a consumer?~~ CLOSED.** Verified:
  `dagre-d3-es` has **no** `exports` map (`main: src/index.js`), so the deep
  subpath `dagre-d3-es/src/dagre/index.js` resolves for any consumer. Declaring
  the dependency is sufficient.
- **~~Which `wouter` range?~~ CLOSED** by D2 rule 5: `^3.9.0`, the narrowest
  range the resolving `3.10.0` satisfies.
- **How is the D7 enumeration extension landed without asserting a scenario that
  currently fails?** See the D7 blocker below — this is the one open decision.
