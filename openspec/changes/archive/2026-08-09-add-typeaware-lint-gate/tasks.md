## 1. Pre-flip verification (blocking — do not skip)

- [x] 1.1 Copy `biome.json` to a scratch file, set `nursery.noFloatingPromises`, `nursery.noMisusedPromises`, and `suspicious.noImportCycles` to `"error"`, and run a plain `npx biome lint . --max-diagnostics=20000 --reporter=summary` with that config in place. Record the per-rule error counts. Do NOT use `--only`.
- [x] 1.2 Prove each probe non-vacuous: plant one deliberate violation per rule under `packages/server/src/` (e.g. a bare call to an `async` fn for `noFloatingPromises`), confirm the probe reports it, then delete the planted file.
- [x] 1.3 Confirm each of the three rule identifiers exists in the installed Biome version (`nursery` vs `suspicious` group is not assumable — `noUnnecessaryConditions` is `suspicious`, not `nursery`).
- [x] 1.4 If any rule's count is non-zero, STOP for that rule: record the sites, route them to a cleanup change, and exclude that rule from task group 2. The other rules still proceed.

## 2. Flip the three clean rules

- [x] 2.1 Add `nursery.noFloatingPromises: "error"` and `nursery.noMisusedPromises: "error"` to `linter.rules` in `biome.json` (new `nursery` block).
- [x] 2.2 Add `suspicious.noImportCycles: "error"` to the existing `suspicious` block in `biome.json`.
- [x] 2.3 Confirm `biome.json` contains no `linter.domains` block (rules named individually — design D1).
- [x] 2.4 Run `npx biome lint . --max-diagnostics=20000` and confirm zero errors repo-wide.
- [x] 2.5 Verify the quality gate by running its three legs directly: `npx biome lint .` (0 errors), `npx tsc --noEmit` (clean), `npm test` (12690 passed, 0 failed). The aggregate `npm run quality:changed` is **not applicable** to this diff and was not used as the gate: the diff holds only `.md` + `biome.json`, so `biome check --changed` processes 0 files and exits 1 with "No files were processed in the specified paths". That exit is a scope artifact, not a violation. Quirk recorded in `docs/code-quality.md`.

## 3. Triage the four candidate type-aware rules

- [x] 3.1 Re-derive current finding counts for `nursery.useAwaitThenable`, `suspicious.noUnnecessaryConditions`, `nursery.noBaseToString`, `nursery.useExhaustiveSwitchCases` against the current tree. Do not reuse planning-time numbers.
- [x] 3.2 Fully audit `nursery.useAwaitThenable` and `nursery.useExhaustiveSwitchCases` (small populations); record true/false-positive verdict per finding.
- [x] 3.3 Sample-audit `suspicious.noUnnecessaryConditions` (largest population, highest false-positive risk under approximate inference); record sample size and observed FP rate.
- [x] 3.4 Sample-audit `nursery.noBaseToString`; record sample size and observed FP rate.
- [x] 3.5 Set each of the four rules to `"warn"` in `biome.json` where the signal holds, or leave it `"off"` with a recorded reason. None enters at `"error"`.
- [x] 3.6 Re-run `npx biome lint .` and confirm error count is still zero (only the warn backlog grew).

## 4. Documentation (delegate every `docs/` write to DocScribe, caveman style)

- [x] 4.1 Extend `docs/code-quality.md` tier ladder with the three graduated rules and their `error` placement.
- [x] 4.2 Record the per-rule triage outcome from group 3: measured count, sample size, FP assessment, assigned severity.
- [x] 4.3 Record the `--only`-bypasses-`overrides` caveat and the rule that a graduation probe must enable the rule in config and run a plain `biome lint .`.
- [x] 4.4 Record the non-vacuous-probe requirement (plant a violation before trusting a zero).
- [x] 4.5 Record the grandfathered `__tests__` blind spot for `noUndeclaredDependencies` — ~1288 findings silenced, only ~1030 of them `vitest`, undeclared test imports produce no diagnostic.
- [x] 4.6 Record the false-positive escape hatch: `biome-ignore` with a mandatory reason plus a linked follow-up for shipped code; never downgrade the rule's severity to clear one site.
- [x] 4.7 Apply the tree rows DocScribe returns to `docs/AGENTS.md`.

## 5. Verification and review

- [x] 5.1 Confirm `.github/workflows/ci.yml` needs no edit — `biome lint .` already runs and inherits the `error`-tier rules.
- [x] 5.2 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and grep the summary.
- [x] 5.3 Invoke `doubt-driven-review` on the `error`-vs-`warn` entry-severity decision before the flip stands (one-way ratchet, gates every future PR).
- [x] 5.4 Invoke `review-code` on the triage verdicts — the sampled false-positive judgement needs a second reader.
- [x] 5.5 Confirm the diff contains no violation fixes (`biome.json` + `docs/` only) — this change flips switches, it does not clean up.
