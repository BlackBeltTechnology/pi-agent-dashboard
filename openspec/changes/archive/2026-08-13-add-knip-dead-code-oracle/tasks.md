# Tasks — add-knip-dead-code-oracle

Folded from `test-plan.md` (21 automated, 1 manual-only), round 3.
Exemplar pointers name the nearest existing test of that category; where the
category has no close exemplar the task says so and the test is authored fresh.

## 1. Install and configure Knip

- [x] Add `knip` as a root devDependency and a `knip` script running the whole-graph scan
- [x] Promote `openspec/changes/add-knip-dead-code-oracle/spike/knip.json` to a root `knip.json` (the measured config: 723→437 findings once the graph was rooted)
- [x] Author `scripts/knip-config.mjs` that derives entry points from `pi-dashboard-plugin.{client,server,bridge}`, `pi.extensions`, `bin`, and `exports`, so the config cannot silently drift from the manifests
- [x] Disable every dependency class in `knip.json` and record in-file that `noUndeclaredDependencies` in `biome.json` owns them
- [x] Commit the per-class baseline (files 10, exports 227, types 189, duplicates 11)

## 2. Tests — entry-point rooting (L1)

- [x] Assert every `pi-dashboard-plugin.{client,server,bridge}` path is a Knip entry (test-plan #G1) · input: all packages declaring the manifest · trigger: compare declared paths to `knip.json` · observable: every declared path is an entry — see `scripts/__tests__/assert-bundled-plugins-complete.test.mjs` (same manifest-vs-config shape)
- [x] Assert every `pi.extensions` path is a Knip entry (test-plan #G2) · input: packages declaring `pi.extensions` · trigger: compare to `knip.json` · observable: every listed path is an entry — see `scripts/__tests__/assert-bundled-plugins-complete.test.mjs`
- [x] Assert app entries are not reported unused (test-plan #G3) · input: `client/src/main.tsx`, `electron/src/{main,preload}.ts`, `server/src/cli.ts` · trigger: run Knip · observable: none in the unused-files list — new test, no close exemplar; follow the harness style of `scripts/__tests__/dependency-declarations.test.mjs`
- [x] Assert a new plugin manifest entry missing from config fails the check (test-plan #G4) · input: fixture package adding `pi-dashboard-plugin.bridge` absent from `knip.json` · trigger: run the config check · observable: fails naming package + missing entry — see `scripts/__tests__/check-conventions.test.mjs`
- [x] Assert shell-invoked scripts are entries (test-plan #G5) · input: `scripts/ab-context/extract.mjs`, `scripts/lib/smoke-spawn-session.mjs` · trigger: run Knip · observable: neither reported unused — new test; these are the measured false positives from the spike
- [x] Assert rooting holds for a transitively imported module (test-plan #G6) · input: `packages/extension/src/canvas-tool.ts`, imported by `src/bridge.ts` · trigger: run Knip · observable: not reported unused — new test; this exact file was a false positive before the graph was rooted

## 3. Tests — ratchet (L1)

- [x] Assert a class regression fails and names the class (test-plan #R1) · input: baseline `exports: 227`, run reporting 228 · trigger: ratchet check · observable: fails naming class, baseline, new count — new test; follow `scripts/__tests__/dox-byte-gate.test.mjs` (threshold-gate shape)
- [x] Assert offsetting changes cannot mask a regression (test-plan #R2) · input: `files` 10→9 and `exports` 227→229 · trigger: ratchet check · observable: fails on `exports`; `files` drop does not offset — new test, same shape as above
- [x] Assert counts exactly at baseline pass (test-plan #R3) · input: every class at baseline · trigger: ratchet check · observable: succeeds — see `scripts/__tests__/dox-byte-gate.test.mjs`
- [x] Assert a baseline increase is rejected (test-plan #R4) · input: diff raising any baseline number · trigger: run the enforcer · observable: fails; message says remove dead code rather than raise the baseline — see `scripts/__tests__/check-conventions.test.mjs`
- [x] Assert a missing baseline fails loudly (test-plan #R5) · input: no baseline file · trigger: ratchet check · observable: named error; current counts not adopted — see `scripts/__tests__/check-conventions.test.mjs`
- [x] Assert the enforcer is deterministic and offline (test-plan #R6) · input: unchanged tree · trigger: run enforcer twice · observable: identical verdict, no network/model call — see `scripts/__tests__/check-conventions.test.mjs`

## 4. Tests — rule ownership (L1)

- [x] Assert every dependency class is disabled and Biome recorded as owner (test-plan #D1) · input: parsed `knip.json` · trigger: inspect rules · observable: all dependency classes off; owner recorded — see `scripts/__tests__/check-conventions.test.mjs`
- [x] Assert Knip emits no dependency findings (test-plan #D2) · input: current workspace · trigger: run Knip · observable: zero findings in any dependency class — see `scripts/__tests__/dependency-declarations.test.mjs`
- [x] Assert Biome-exempted trees are not re-litigated (test-plan #D3) · input: a `**/__tests__/**` file importing an undeclared dep · trigger: run Knip · observable: nothing reported; no manifest declaration added — see `scripts/__tests__/biome-undeclared-dependencies.test.mjs`

## 5. Tests — performance (L1)

- [x] Assert whole-workspace runtime stays under 30s (test-plan #P1) · input: full workspace · trigger: timed Knip run · observable: wall time < 30s (measured 9.78s) — see `scripts/__tests__/dox-byte-gate.test.mjs`
- [x] Assert `quality:changed` never invokes Knip (test-plan #P2) · input: `package.json` scripts + changed-scope chain · trigger: resolve the chain · observable: no Knip invocation reachable — see `scripts/__tests__/check-conventions.test.mjs`

## 6. Ship-gate enforcer

- [x] Author the ratchet enforcer script and wire it into the `ship-it` enforcer step alongside `check-conventions.mjs` / `dox-byte-gate.mjs`
- [x] Update `.pi/skills/ship-it/SKILL.md` step 4.4 to invoke the new enforcer

## 7. CI wiring + workflow assertions

- [x] Add the whole-graph Knip job to `.github/workflows/nightly.yml`, invoking the ratchet check
- [x] Assert `ci.yml` invokes no Knip step (test-plan #X1) · input: `ci.yml` · trigger: parse workflow YAML · observable: no step or script invokes `knip` — see `packages/shared/src/__tests__/publish-workflow-contract.test.ts`
- [x] Assert `nightly.yml` invokes the whole-graph Knip script (test-plan #X2) · input: `nightly.yml` · trigger: parse workflow YAML · observable: a job invokes it — see `packages/shared/src/__tests__/publish-workflow-contract.test.ts`
- [x] Assert the nightly job runs the ratchet check and fails above baseline (test-plan #X3) · input: nightly Knip job definition · trigger: parse workflow YAML · observable: ratchet invoked; fails on a class above baseline — see `packages/shared/src/__tests__/publish-workflow-contract.test.ts`

## 8. Docker harness (L2)

- [x] Add the Knip pass to the docker harness
- [x] Assert the harness runs Knip with the same per-class counts as a host run (test-plan #H1) · input: docker harness container · trigger: invoke the Knip script inside the harness · observable: completes; counts match — see `qa/tests/02-server-start.sh`

## 9. Documentation

- [x] Record the per-change vs whole-graph classification, and that shell-invoked scripts are undetectable, in `docs/code-quality.md` (delegate the `docs/` write to DocScribe, caveman style)
- [x] Add directory `AGENTS.md` rows for `knip.json`, the config generator, and the enforcer script

## 10. Deferred / manual verification

- [x] Verify the enforcer blocks a real regression: add an unused export on a branch and confirm the ship enforcer step exits non-zero (test-plan: manual-only) — DONE: appended an unused `RATCHET_PROBE_UNUSED` export to `packages/server/src/lib/grep.ts`; `knip-ratchet.mjs` reported `"exports" 228 > baseline 227 (+1)` and exited 1; probe reverted, tree clean.

## 11. Follow-up (not this change)

- Open a cleanup change for the 437 baseline findings, lowering each class baseline as it lands
- Open a separate change for Knip↔`kb dox lint` reconciliation, defining it against the `missing` category (row absent for an existing file) rather than `orphan` (row pointing at a deleted file) — the mismatch that made the original cross-check unconstructible
- Explicitly close the parent `add-semgrep-knip-oracles` scope as measured-and-rejected for the Semgrep half
