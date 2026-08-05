# Declare every undeclared dependency and grandfather the rest

> Rung 1a of the local-review-gate ladder. Split out of
> `cleanup-lint-debt-mechanical` after doubt-driven-review cycle 3 found that
> change was carrying three unrelated kinds of work. This rung is the genuinely
> **mechanical** part: manifest declarations and Biome overrides. No promise
> semantics, no module restructuring.

## Why

`noUndeclaredDependencies` reports **1398 findings at repo-root scope** — the
scope CI actually lints. Almost all are noise from root-hoisted devDependencies
resolving against Biome's nearest-manifest rule. But buried in them is a real
defect class: **published packages importing dependencies their own manifest
never declares**, resolving today purely because the monorepo hoists.

`packages/extension` does `await import("@earendil-works/pi-ai")` at
`provider-register.ts:652` and `bridge.ts:1399`; `flows-plugin` imports `@mdi/js`
and `@mdi/react` 23 times; `fastify` is imported by four server-side plugin
modules that declare it nowhere; `dagre-d3-es` and `tar` are declared in **zero
manifests repo-wide**. Each is a published artifact whose install graph is a lie.
That is a live violation of the standing `workspace-publishing` requirement
*"Published tarballs contain resolvable concrete semver dependencies."*

This rung also unblocks the ladder: `add-typeaware-lint-gate` cannot flip
`noUndeclaredDependencies` to `error` until this reports zero.

## Baseline — derive it, do not trust it

Two prior planning cycles produced wrong numbers, both times because the
**measurement scope** was wrong (first 4 `src` dirs, then `packages/`). The
authoritative baseline is the command, not any number in this document:

```bash
npx biome lint --config-path=<probe-config> . --max-diagnostics=20000
```

Repo-root scope is load-bearing: `biome lint .` reaches root `scripts/`,
`examples/`, `tests/e2e/`, `qa/scripts/`, `.pi/skills/**/scripts/`, `.pi/flows/**`
and `openspec/changes/**/spike/`. Measuring `packages/` alone understates by 28.

As-of snapshot (Biome 2.5.1, repo root, current `develop`) — **1398 total**:

| Group | Count | Disposition |
|---|---|---|
| test files | ~1288 | grandfather via the existing `__tests__/**` override |
| build/config + build scripts under `packages/` | ~34 | new override glob, derived from probe |
| runtime imports in package source | ~48 sites / ~18 distinct deps / 12 manifests | **declare** |
| outside `packages/` | 28 | declare at root (`jiti`, `yaml`) or ignore (examples, spikes, flow fixtures) |

## What Changes

- **Grandfather test-file findings.** Add
  `correctness.noUndeclaredDependencies: "off"` to the existing `__tests__/**`
  override. Silences ~1288 findings, only ~1030 of which are `vitest`. This is a
  **deliberate permanent blind spot**, recorded as such (see Trade-offs).
- **Add a build/config override glob** covering every build/config path the probe
  reports — including the non-obvious ones the naive glob list misses:
  `packages/electron/vite.main.config.ts`, `vite.preload.config.ts`,
  `packages/client/scripts/vite-build.mjs`,
  `packages/electron/scripts/download-git-windows.mjs`.
  **Over-match guardrail (required):** re-running the probe to zero proves
  coverage but cannot detect an over-broad glob — a wrongly-matched source file
  also reports zero. The override MUST additionally be asserted to match **no
  file under any `src/**`**.
- **Declare ~18 dependencies across 12 manifests.** Field is per-row and
  non-obvious (`dashboard-plugin-runtime` already declares `wouter`/`react` as
  **peer**, not dep), so no blanket rule applies:

  | Manifest | Deps | Field |
  |---|---|---|
  | `flows-plugin` | `@mdi/js`, `@mdi/react`, `dagre-d3-es` | TBD — match sibling plugins |
  | `automation-plugin` | `@mdi/js`, `@mdi/react`, `wouter`, `fastify` | TBD — `wouter` likely peer |
  | `dashboard-plugin-runtime` | `@mdi/react`, `fastify` | TBD — pkg uses peer for `wouter`/`react` |
  | `extension` | `@earendil-works/pi-ai` | optional peer |
  | `flows-anthropic-bridge-plugin` | `@blackbelt-technology/pi-anthropic-messages` **only** | optional peer |
  | `hermes-memory-plugin`, `subagents-plugin` | `fastify` | TBD — server-side, likely dep |
  | `kb-extension` | `typebox` | TBD — extension declares it non-optional peer |
  | `shared` (public), `demo-plugin` (private) | `react` | peer/dev — **never `dependencies`** |
  | `electron` (private) | `vite` | dev |
  | `client` (public) | `vitest` via `src/test-support/**` | **dev** — ships `files: ["dist/"]` |

- **`@pi/anthropic-messages` MUST NOT be declared.** `npm view` returns **E404** —
  the package does not exist (only `@blackbelt-technology/pi-anthropic-messages@0.3.4`).
  It is a legacy pre-rescope name behind a `@ts-expect-error` dynamic fallback at
  `flows-anthropic-bridge-plugin/src/bridge/index.ts:148` that can never resolve
  for a consumer. Declaring it would write **unresolvable metadata into a
  published manifest** — the exact failure `workspace-publishing` forbids.
  Suppress at the call site and record why.
- **`react` in `packages/shared` is not a runtime dependency.** The import is
  `import type` only and `ui-primitives.ts` documents *"no React runtime cost for
  non-renderer consumers"*. `dependencies` would ship React to every consumer of a
  published package and break the single-instance invariant.
- **Decide a policy for the 28 out-of-`packages/` findings.** Root `scripts/`
  imports (`jiti`, `yaml`) are real tooling deps undeclared at root → declare.
  `examples/`, `openspec/changes/**/spike/`, `.pi/flows/**` fixtures are not
  shipped → Biome ignore/override. Both paths are in scope.
- **No severity flips.** `add-typeaware-lint-gate` owns those.

## Capabilities

### New Capabilities

- `publish-correctness-verification` — the pack-and-install oracle described in
  Verification below; the repo currently has no way to prove a manifest change is
  correct for a consumer.

### Modified Capabilities

- `code-quality-loop` — override set gains a rule and a build/config glob;
  discharges the ratchet precondition for `noUndeclaredDependencies`. The spec's
  claim that overrides exist for `packages/server/**` and `scripts/**` is
  **already false** against `biome.json` and must be reconciled in the delta.
- `workspace-publishing` — 12 manifests stop importing undeclared packages.
  Whether that constitutes *compliance* is an Open Question: an optional peer at
  `"*"` is neither concrete nor guaranteed-resolvable.

## Verification

The existing oracle **cannot prove this change correct.** `quality:changed`
(biome + tsc + vitest) runs inside the monorepo where hoisting resolves
everything; a manifest that lies still passes. Proving the dependency work
requires leaving the workspace:

- `npm pack` each touched **public** package, install the tarball into a clean
  fixture outside the repo, and assert the entry point imports.
- Or `publint` / `@arethetypeswrong/cli` against the packed tarballs.

This oracle does not exist in the repo today; standing it up is part of this
change.

## Non-Goals

- Any promise-handling fix (`cleanup-client-plugin-promises`,
  `cleanup-async-semantics-server-extension`).
- Any import-cycle fix (`cleanup-import-cycles`).
- Any rule severity flip (`add-typeaware-lint-gate`).
- Upgrading, deduplicating, or version-aligning dependencies. This change
  *declares* what already resolves; it does not change which version resolves.

## Trade-offs (accepted, recorded)

- **The test-file grandfather is a permanent hole.** Once the rule is at `error`,
  test files accumulate undeclared imports with no signal. Accepted because
  per-package declaration across 31 packages costs more than the defect class is
  worth — but `add-typeaware-lint-gate` must record the hole at graduation.
- **The build-script override is the same hole at smaller scale.** The group
  includes build *scripts*, not only `*.config.ts`; future build scripts in
  published packages will be blind.

## Impact

- `biome.json` — one key on the existing override, one new override block,
  possibly `files.includes` ignores.
- 12 `package.json` files + root `package.json` — declarations only, no version
  changes.
- New pack-and-install verification tooling.
- **Published artifacts change, for public packages only.** `electron`,
  `demo-plugin`, `shell` are `private: true` — declarations there change no
  consumer install graph.

## Open Questions

- **Does an optional peer satisfy `workspace-publishing`?** The spec requires
  *"resolvable concrete semver"*. An optional peer at `"*"` is neither. A consumer
  without `pi-ai` still hits the same silent dynamic-import failure, and `"*"`
  resolves a different major than the tree's pinned `0.75.5` (API drift
  documented in `provider-register.ts.AGENTS.md`). Does this change *fix* the
  violation or merely *document* it?
- **`dagre-d3-es`, `tar`, `jiti`, `yaml` are declared nowhere.** Confirm which
  version currently resolves before declaring a range, or the declaration
  silently pins something different from what ships today.
- **Is the 12-manifest list complete?** It was derived from the probe, but the
  probe is a snapshot; re-derive before implementing.

## Discipline Skills

- `security-hardening` — declaring dependencies on published packages changes
  consumer install graphs; verify no unexpected transitive surface appears.
- `review-code` — ~18 declarations whose *field* choice is the defect-prone part;
  cycle 1 of doubt-review got exactly this wrong.
- `doubt-driven-review` — the publishing-compliance question is irreversible once
  published; settle it before the delta spec asserts compliance.
- `scenario-design` — the pack-and-install oracle needs real scenarios (missing
  optional peer, consumer without hoisting, type-only import).
