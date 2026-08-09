# Design — Graduate the type-aware and structural Biome rules into the quality gate

## Context

`biome.json` runs with `preset: "none"` and an explicitly enumerated rule set.
Every rule currently enabled is **single-file and syntactic**. The other two
gates in `quality:changed` do not cover the gap: `tsc --noEmit` proves types but
says nothing about whether a promise is handled, and Vitest proves only what it
was told to prove. An unawaited async call therefore reaches production
unchallenged by any oracle the project owns.

Biome 2.5.1 is already installed and already ships the missing oracles:

- **Type-aware** (`nursery.noFloatingPromises`, `nursery.noMisusedPromises`) —
  reason about promise semantics using Biome's own type inference.
- **Structural** (`suspicious.noImportCycles`,
  `correctness.noUndeclaredDependencies`) — reason *across* files.

`noUndeclaredDependencies` already landed at `error` via
`cleanup-undeclared-dependencies`, together with the three override blocks
(`__tests__/**`, build/config entry points, non-published trees) that make it
usable. The remaining three rules are installed, cheap, and simply `off`.

### Verified current state

Re-probed in this worktree at `e825cc9b1`, per the proposal's Non-Goals
instruction to *verify* green rather than assume it:

| Rule | Findings, whole repo, real config | Verdict |
|---|---|---|
| `nursery.noFloatingPromises` | 0 | ready for `error` |
| `nursery.noMisusedPromises` | 0 | ready for `error` |
| `suspicious.noImportCycles` | 0 | ready for `error` |
| `correctness.noUndeclaredDependencies` | 0 | already at `error` |

Method: copy `biome.json`, add the three rules at `error`, run a plain
`npx biome lint . --reporter=summary`, restore. Result: **0 errors, 2845
warnings** — the pre-existing warn-tier backlog, unchanged. Cost ~1.3s over
2916 files.

The oracle was proven non-vacuous before being trusted: a deliberate
`function g() { f(); }` over an `async f()` was planted under
`packages/server/src/` and `noFloatingPromises` reported it. A zero from a rule
that cannot fire is worthless.

Re-probed counts for the four **untriaged** type-aware rules (whole repo, `--only`):

| Rule | Findings |
|---|---|
| `suspicious.noUnnecessaryConditions` | 601 |
| `nursery.noBaseToString` | 47 |
| `nursery.useAwaitThenable` | 3 |
| `nursery.useExhaustiveSwitchCases` | 2 |

These differ sharply from the proposal's planning-time numbers (296 / 18 / 235 /
4). Two of the four rules also live in a different group than the proposal
assumed (`noUnnecessaryConditions` is `suspicious`, not `nursery`). Both facts
are why this change re-derives rather than trusts.

## Goals / Non-Goals

**Goals:**

- Enable `noFloatingPromises`, `noMisusedPromises`, `noImportCycles` at `error`
  in `biome.json`, on a tree re-verified at zero immediately before the flip.
- Triage the four untriaged type-aware rules on evidence, and place each at
  `warn` or `off` with a recorded reason. None enters at `error`.
- Extend `docs/code-quality.md` with the graduated rules, their tier placement,
  and the caveats a future graduation needs.
- Record the grandfathered blind spot the `__tests__` override creates.

**Non-Goals:**

- Fixing violations. If the pre-flip probe is non-zero, this change **stops**
  and the finding is routed to a cleanup change — it is not fixed here.
- Changing `quality:changed`'s shape or `ci.yml`. The rules ride the existing
  `biome check --changed` / `biome lint .` invocations.
- Enabling `linter.domains` wholesale, or the `project` domain's
  `noUnresolvedImports` / `noPrivateImports`.

## Decisions

### D1 — Name rules individually; do not enable `linter.domains`

`domains` is terser but grants *future* Biome rules automatically on upgrade.
That directly contradicts a one-way ratchet in which every graduation is a
deliberate, evidence-backed act. A `biome` version bump could otherwise turn a
dependency update into an unreviewed CI-blocking rule change.

*Alternative considered:* `"domains": { "test": "all", "project": "all" }`.
Rejected on the ratchet-integrity ground above. Individually named rules also
keep `biome.json` self-documenting about what is gated.

Resolves the proposal's third Open Question.

### D2 — The three clean rules enter at `error`, not `warn`

The ratchet's stated graduation criterion is "zero violations at repo-root
scope", and all three meet it. Holding a zero-violation rule at `warn` would
mean the gate does not gate — `warn` only fails under `--error-on-warnings`,
which CI's `biome lint .` does not pass. Regressions would land silently.

This resolves the proposal's first Open Question **in favour of `error`**, with
one explicit acknowledgement: Biome's type inference is approximate, so a future
false positive could hard-stop an unattended `ship-it`. The mitigation is a
documented escape hatch (R2 below), not a permanently toothless severity. A
rule that cannot block is not a gate.

*Alternative considered:* type-aware rules held at `warn` forever, gated only in
changed-files scope via `--error-on-warnings`. Rejected: it makes the gate's
strength depend on which script the developer happened to run, and leaves CI
blind to a floating promise introduced by a merge.

### D3 — Oracle is a plain `biome lint .`, never `--only`

`--only=<rule>` force-enables the rule and **bypasses `overrides` severity
entirely** (only `files.includes` exclusions survive it). The existing spec
already records this for `noUndeclaredDependencies`; it was re-confirmed here —
`--only=correctness/noUndeclaredDependencies` reports hundreds of findings in
`__tests__/` that the real config resolves by override, while a plain
`biome lint .` reports zero errors repo-wide.

Consequence: the pre-flip verification for each rule is *add it to a scratch
copy of `biome.json` at `error`, run a plain `biome lint .`, count errors*. Not
`--only`. `--only` remains fine for *counting* an `off` rule during triage,
where no override interaction exists yet.

### D4 — The four untriaged rules are triaged by sampled audit, entering at `warn` or staying `off`

Each rule gets a sample of its findings read by hand. The rule enters at `warn`
if the sampled signal holds, and stays `off` with a recorded reason if it does
not. No untriaged rule enters at `error`, because none has a zero-violation
tree and enabling one at `error` would require a cleanup this change disclaims.

Sample size scales with population: full read where the count is small
(`useAwaitThenable` 3, `useExhaustiveSwitchCases` 2), a bounded sample where it
is large (`noUnnecessaryConditions` 601, `noBaseToString` 47).

`noUnnecessaryConditions` at 601 findings is the prime `warn`-or-`off`
candidate: it is exactly the rule where approximate inference produces
"condition is always truthy" claims that `tsc` would not make. A high sampled
false-positive rate is itself the evidence for D2's counter-position and MUST be
recorded, not discarded.

### D5 — The `__tests__` blind spot is named, not implied away

The `__tests__/**` override silences ~1288 `noUndeclaredDependencies` findings
permanently, only ~1030 of which are `vitest`. Once the rule sits at `error`,
test files can accumulate undeclared imports with zero signal. The
`docs/code-quality.md` entry MUST state this hole explicitly rather than present
the rule as a clean zero. A gate whose documented scope overstates its real
scope is worse than no gate, because it stops people looking.

### D6 — Order of operations: verify, then flip, one rule at a time

Each rule is verified at zero and flipped independently, so a non-zero probe
blocks exactly one rule rather than the whole change. The tree moves under
active development (the floating-promise count drifted 141 → 142 → 143 during
planning); a probe taken at plan time is not evidence at apply time.

## Risks / Trade-offs

- **[False positive from approximate inference hard-stops an unattended
  `ship-it` at 2am]** → Documented escape hatch: a `// biome-ignore
  lint/nursery/noFloatingPromises: <reason>` suppression with a mandatory
  reason, plus the standing rule that a suppression in *shipped* code needs a
  linked follow-up. `suppressions/unused` is already reported by Biome, so a
  stale suppression surfaces on its own.
- **[Biome upgrade changes a nursery rule's behaviour and reddens CI on
  untouched code]** → D1 (no `domains`) bounds the blast radius to the three
  named rules. The `bump-pi-version`-style discipline of reading the upstream
  changelog applies to `@biomejs/biome` bumps too.
- **[`noImportCycles` at zero today is fragile]** → A cycle is easy to
  reintroduce and the diagnostic points at a file, not at the edge that closed
  the loop. Accepted: this is precisely the regression class the gate exists to
  catch, and catching it at PR time is much cheaper than at runtime.
- **[Triage is a judgement call by a single reader]** → `review-code` discipline
  applies; the sampled findings and the verdict per rule are recorded in
  `docs/code-quality.md` so the judgement is auditable rather than folklore.
- **[Zero-finding probe is vacuous because the rule silently cannot fire]** →
  Mitigated by the planted-violation check already run for `noFloatingPromises`;
  the same check is required for each rule before its flip is believed.

## Migration Plan

1. Re-probe each of the three rules at `error` on a scratch config; require 0
   errors from a plain `biome lint .`.
2. Confirm each probe is non-vacuous by planting one violation and seeing it
   reported.
3. Flip the three rules in `biome.json`. Run `npm run quality:changed`.
4. Triage the four untriaged rules; write `warn` or leave `off` per D4.
5. Update `docs/code-quality.md` (DocScribe) with the tier ladder, the
   `--only`-bypasses-overrides caveat, and the D5 blind spot.
6. CI inherits with no workflow edit — `ci.yml` already runs `biome lint .`.

**Rollback:** revert the `biome.json` hunk. No data, schema, or runtime
migration; the change is configuration plus documentation.

## Open Questions

- None blocking. The proposal's three Open Questions are resolved by D2 (entry
  severity: `error`, with a documented escape hatch), D4 (the untriaged rules
  are triaged on evidence, and `useAwaitThenable` is 3 findings — not 235 — so
  it is no longer material to the severity argument), and D1 (individually named
  rules, not `domains`).
