# Graduate the type-aware and structural Biome rules into the quality gate

## Why

The local quality oracle (`quality:changed`) runs three checks, and all three are
blind to the same thing. Biome with `preset: none` is **single-file and
syntactic**. `tsc --noEmit` proves types, not usage. Vitest proves what it was
told to prove. Nothing in the loop reads *across* files or reasons about promise
semantics — so an unawaited async call in the WS pump is invisible to every gate
the project owns until it manifests as a hung session in production.

Biome 2.5.1 already ships the fix. The `types` domain (type-aware inference) and
the structural `noImportCycles` / `noUndeclaredDependencies` rules are installed,
cost ~2s across 1879 files, and are simply not enabled. A probe over the whole
`packages/` tree found **171 structural findings** (143 floating promises, 11
misused, 17 cycles) plus **1398 undeclared-dependency findings**, including a
class of latent publish bugs across 12 manifests.

This change flips the severities. It is deliberately the **last cleanup-dependent**
rung: the ratchet is one-way and requires a green tree first, so it is blocked on
**all four** cleanup changes, each of which owns a disjoint slice:

| Blocking change | Clears |
|---|---|
| `cleanup-undeclared-dependencies` | `noUndeclaredDependencies` (all 1398) |
| `cleanup-client-plugin-promises` | 88 floating (client, plugins, shell, `scripts/`) + 5 misused (client 3, server 2) |
| `cleanup-async-semantics-server-extension` | 55 floating (extension 37, server 17, electron 1) + 6 misused (electron main) |
| `cleanup-import-cycles` | all 17 cycles |

Floating totals **143** (88 + 55), misused **11** (5 + 6). The electron sites
moved to the async-semantics change during planning — the split is by blast
radius, not package name.

> The floating total is 143, not 142. A site-extraction filter matching only
> `.ts/.tsx/.mjs/.js/.jsx` drops `packages/server/src/rpc-keeper/keeper.cjs:141`.
> Include `.cjs` when re-deriving, or the gate will be flipped one site early.

`noFloatingPromises` reaches zero only when **two** of them have landed;
`noMisusedPromises` likewise. A flip attempted after either alone will fail.

## What Changes

- **Enable the type-aware rules** in `biome.json`, at `error`:
  `nursery.noFloatingPromises`, `nursery.noMisusedPromises`. Both are cleaned to
  zero by the two cleanup changes; per the ratchet's graduation criterion
  (`biome lint . --only=<rule>` reports zero), they graduate straight to `error`
  rather than resting at `warn`.
- **Enable the structural rules** at `error`: `suspicious.noImportCycles`,
  `correctness.noUndeclaredDependencies`. The latter depends on **all four**
  parts of `cleanup-undeclared-dependencies`: the `__tests__/**` override (~1288
  findings), the build/config override glob (~34), the ~18 runtime dependency
  declarations across 12 manifests (~48 sites), and the policy for the 28
  findings outside `packages/`. Any one left undone leaves the rule non-zero and
  this flip impossible.
- **Evaluate, do not assume, the remaining type-aware rules.** `useAwaitThenable`
  (235 findings), `noUnnecessaryConditions` (296), `noBaseToString` (18),
  `useExhaustiveSwitchCases` (4) were measured but NOT triaged. Biome's type
  inference is incomplete relative to `tsc`, so a fraction of these are false
  positives. Each rule gets a sampled audit; it enters at `warn` (Tier B) if the
  signal holds, or stays `off` with a recorded reason if it does not. **No rule
  enters at `error` without a zero-violation tree.**
- **Extend `docs/code-quality.md`** with the graduated rules and their tier
  placement, and record the nearest-manifest/hoisting caveat that makes
  `noUndeclaredDependencies` unusable without the test override.
- **Record the grandfathered blind spot.** The test-file override silences 1288
  findings permanently, only ~1030 of which are `vitest`. Once the rule is at
  `error`, test files can accumulate undeclared imports with no signal. The
  graduation entry must name this hole rather than imply a clean zero.
- **CI inherits automatically** — `ci.yml` already runs `biome lint .`, so
  `error`-tier rules gate PRs with no workflow edit.

## Capabilities

### New Capabilities

*(none)*

### Modified Capabilities

- `code-quality-loop` — the tier ladder gains type-aware and structural rules;
  the "Biome-backed static analysis configuration" requirement is extended to
  cover domain/type-aware configuration, and the graduation criterion is applied
  to a new class of rule whose oracle (type inference) is approximate rather than
  exact.

## Non-Goals

- Fixing violations. Both cleanups land first; this change flips switches on an
  already-green tree. **Verify that green, do not assume it** — re-probe each
  rule at zero before flipping it, since the tree moves under active development
  (the floating-promise count drifted 141 → 142 during planning alone).
- Adding a new analysis engine (`add-semgrep-knip-oracles`).
- Changing the `quality:changed` script's shape — the rules ride the existing
  `biome check --changed` invocation.
- Enabling the full `project` domain. `noUnresolvedImports` / `noPrivateImports`
  are untested here and out of scope.

## Impact

- `biome.json` — rule severities and (if adopted) a `linter.domains` block.
- `docs/code-quality.md` — tier ladder and caveats (delegated to DocScribe).
- `.github/workflows/ci.yml` — no edit expected; inherits via `biome lint .`.
- Every future PR — a new class of finding can now block CI. That is the point,
  and it is also the risk: a false positive from approximate type inference
  becomes a hard stop for an unattended `ship-it` run.

## Open Questions

- **Is `error` the right entry severity for type-aware rules?** The ratchet's
  graduation criterion assumes an exact oracle. Biome's inference is
  approximate — a rule can be at zero violations today and produce a false
  positive tomorrow on new code, blocking a headless `ship-it` at 2am. A case
  exists for holding type-aware rules at `warn` permanently and letting
  `--error-on-warnings` gate them only in the changed-files scope.
- **Do the 235 `useAwaitThenable` findings survive triage?** If the false-positive
  rate is material, that is evidence for the `warn`-forever position above.
- **Should `linter.domains` be used instead of naming rules individually?**
  Domains are terser but grant future rules automatically — which conflicts with
  a one-way ratchet where every graduation is a deliberate act.

## Discipline Skills

- `doubt-driven-review` — flipping a rule to `error` is effectively irreversible
  in a one-way ratchet and gates every future PR; stress it before it stands.
- `code-quality` — this change is the ratchet's graduation step; the skill owns
  the criterion and the tier ladder.
- `review-code` — the sampled false-positive audit is a judgement call that needs
  a second reader.
