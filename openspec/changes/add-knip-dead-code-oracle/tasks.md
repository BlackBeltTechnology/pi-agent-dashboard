# Tasks — add-knip-dead-code-oracle

Test tasks are folded from `test-plan.md` (19 automated, 2 manual-only).

## 1. Install and configure Knip

- [ ] Add `knip` as a root devDependency and a `knip` script running the whole-graph scan
- [ ] Author `knip.json` declaring workspace entry points: plugin client entries, `.pi/skills/**/scripts/*.ts`, `packages/*/vitest.config.ts`, `public/sw.js`, `site/astro.config.mjs`
- [ ] Verify `knip.json` contains no ignore rule covering any `unlisted` finding (config encodes graph shape only)

## 2. Fix the 63 phantom dependencies

- [ ] Declare `node-pty` in every package that imports it (currently `scripts/fix-pty-permissions.cjs`)
- [ ] Declare `@testing-library/react` in each `*-plugin` package whose tests import it
- [ ] Declare `@vitejs/plugin-react` in each package whose `vitest.config.ts` imports it
- [ ] Declare `@mdi/js` in `tests/e2e` owner package and any other importer
- [ ] Declare `jszip`, `@pi/anthropic-messages`, `@electron-forge/shared-types` in their importing packages
- [ ] Re-run Knip and confirm the `unlisted` class is empty

## 3. Tests — dead-code detection (L1)

- [ ] Assert Knip reports zero `unlisted` findings across the workspace (test-plan #E1) · input: current workspace manifests · trigger: run Knip and read `issues[].unlisted` · observable: total `unlisted` count is 0 — see `scripts/__tests__/dependency-declarations.test.mjs`
- [ ] Assert each of the 7 known phantom packages is declared by every importer (test-plan #E2) · input: the 7 package names · trigger: read each importing package's `package.json` · observable: dep present in `dependencies` or `devDependencies` — see `scripts/__tests__/biome-undeclared-dependencies.test.mjs`
- [ ] Assert a newly undeclared import regresses (test-plan #E3) · input: fixture package importing `left-pad` undeclared · trigger: run Knip on fixture · observable: exactly one `unlisted` naming `left-pad` — see `scripts/__tests__/dependency-declarations.test.mjs`
- [ ] Assert `knip.json` never suppresses an `unlisted` finding (test-plan #E4) · input: parsed `knip.json` · trigger: inspect ignore/`ignoreDependencies` entries · observable: no entry matches any of the 7 phantom names — see `scripts/__tests__/check-conventions.test.mjs`
- [ ] Assert plugin client entries are not reported orphan (test-plan #E5) · input: `packages/automation-plugin/src/client/**` · trigger: run Knip · observable: no `*-plugin` client entry in `files`; `react-dom` not reported unused — see `scripts/__tests__/assert-bundled-plugins-complete.test.mjs`
- [ ] Assert skill/config entry points are not reported orphan (test-plan #E6) · input: `.pi/skills/**/scripts/*.ts`, `packages/*/vitest.config.ts`, `public/sw.js` · trigger: run Knip · observable: none appears in unused `files` — see `scripts/__tests__/dox-byte-gate.test.mjs`
- [ ] Assert server→client type imports are followed (test-plan #E7) · input: `ConfigOk` in `blackhole-plugin/src/server/config-io.ts` imported by `src/client/BlackholeSettings.tsx` · trigger: run Knip · observable: `ConfigOk` not reported as unused type — see `scripts/__tests__/dependency-declarations.test.mjs`
- [ ] Assert a genuine orphan export is still detected (test-plan #E8) · input: fixture module with an unimported export · trigger: run Knip on fixture · observable: export reported in `exports` — see `scripts/__tests__/dependency-declarations.test.mjs`

## 4. Tests — performance (L1)

- [ ] Assert whole-workspace Knip runtime stays under 30s (test-plan #P1) · input: full workspace · trigger: timed Knip run · observable: wall time < 30s (baseline 5.59s) — see `scripts/__tests__/dox-byte-gate.test.mjs`
- [ ] Assert `quality:changed` never invokes Knip (test-plan #P2) · input: `package.json` scripts + changed-scope chain · trigger: resolve the command chain · observable: no Knip invocation reachable — see `scripts/__tests__/check-conventions.test.mjs`

## 5. CI wiring + workflow assertions

- [ ] Add the whole-graph Knip job to `.github/workflows/nightly.yml` with `continue-on-error: true`
- [ ] Assert the nightly Knip job carries `continue-on-error: true` while the baseline is unclean (test-plan #X1) · input: `nightly.yml` Knip job · trigger: parse workflow YAML · observable: `continue-on-error: true` present — see `packages/shared/src/__tests__/publish-workflow-contract.test.ts`
- [ ] Assert `ci.yml` invokes no Knip step (test-plan #X2) · input: `ci.yml` · trigger: parse workflow YAML · observable: no step or script invokes `knip` — see `packages/shared/src/__tests__/publish-workflow-contract.test.ts`
- [ ] Assert `nightly.yml` invokes the whole-graph Knip script (test-plan #X3) · input: `nightly.yml` · trigger: parse workflow YAML · observable: a job invokes the Knip script — see `packages/shared/src/__tests__/publish-workflow-contract.test.ts`

## 6. Orphan cross-check script

- [ ] Author the cross-check script comparing Knip unused-files against `kb dox lint` orphan rows
- [ ] Assert confirmed dead code when both tools report the orphan (test-plan #X4) · input: file unused per Knip AND orphan row per `kb dox lint` · trigger: run cross-check · observable: reported as confirmed dead code / deletion candidate — see `scripts/__tests__/dox-byte-gate.test.mjs`
- [ ] Assert documentation-only drift (test-plan #X5) · input: reachable file, orphan `AGENTS.md` row · trigger: run cross-check · observable: doc-only drift, not a deletion candidate — see `scripts/__tests__/dox-byte-gate.test.mjs`
- [ ] Assert code-only drift (test-plan #X6) · input: unused file, valid `AGENTS.md` row · trigger: run cross-check · observable: code-only drift; row flagged for removal — see `scripts/__tests__/dox-byte-gate.test.mjs`
- [ ] Assert clean reconciliation exits 0 (test-plan #X7) · input: neither tool reports orphans · trigger: run cross-check · observable: no drift; exit code 0 — see `scripts/__tests__/dox-byte-gate.test.mjs`
- [ ] Assert missing/unparseable `kb dox lint` output fails loudly (test-plan #X8) · input: absent or malformed lint output · trigger: run cross-check · observable: named error, no false drift reported — see `scripts/__tests__/dox-byte-gate.test.mjs`

## 7. Docker harness (L2)

- [ ] Add the Knip pass to the docker harness
- [ ] Assert the harness runs Knip and yields the same finding classes as a host run (test-plan #H1) · input: docker harness container · trigger: invoke the Knip script inside the harness · observable: completes; same finding classes as host — see `qa/tests/02-server-start.sh`

## 8. Documentation

- [ ] Record the per-change vs whole-graph check classification in `docs/code-quality.md` (delegate the `docs/` write to DocScribe, caveman style)
- [ ] Add directory `AGENTS.md` rows for the new `knip.json` and the cross-check script

## 9. Deferred / manual verification

- [ ] Verify escalation flip to blocking once the baseline reaches zero: turn off `continue-on-error`, introduce an unused export, confirm the pipeline fails (test-plan: manual-only)
- [ ] Verify a package whose phantom deps were fixed installs and imports standalone outside the monorepo (pack + install) (test-plan: manual-only)

## 10. Follow-up (not this change)

- [ ] Open a separate cleanup change for the remaining baseline (orphan files, unused exports/types)
- [ ] Explicitly close the parent `add-semgrep-knip-oracles` scope as measured-and-rejected for the Semgrep half
