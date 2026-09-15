## 1. macOS floor canary (#533) — `packages/electron/scripts/`

- [ ] 1.1 Test the canary verdicts — extend the macos-floor test in `packages/electron/vitest.build-contract.config.ts`'s collected set (or add `macos-floor-canary.test.mjs` there): stub `otool` output with no version load command → canary verdict `blind-extractor` with a message naming `extractMinosValues` and the prebuilt path; one-slice output → canary passes and the produced-binary mapping is unchanged (`not-extractable` → warning). Verify red first.
- [ ] 1.2 Implement D1 in `verify-macos-floor.mjs` (+ helper in `macos-floor.mjs`); update the script's header table and `_electron-build.yml` step comment. Verify 1.1 green; `node packages/electron/scripts/verify-macos-floor.mjs` on a local macOS build exits 0 and prints the canary line.
- [ ] 1.3 Verify step ordering in `_electron-build.yml`: the floor-check step runs while `node_modules/electron/dist` is present (no prune between package and check). Record the step names in this line.

## 2. Dead trigger (#580) — `.github/workflows/sync-release-version.yml`

- [ ] 2.1 Test — `site-deploy-workflow-contract.test.ts` E10 extended: `sync-release-version.yml` has no `release:` trigger and keeps `workflow_dispatch.inputs.correlation`. Verify red first.
- [ ] 2.2 Implement D2: delete the trigger, rewrite the "Triggers" docstring (dispatch-only; human-published draft → manual dispatch). Verify 2.1 green; `.github/workflows/AGENTS.md` row updated.

## 3. Text corrections (#577, #578)

- [ ] 3.1 `packages/shell/vite.config.ts` `spa404Fallback` docstring per D4. Verify: comment names `site/404.html` and `/app/`; `pnpm run build` for the shell unchanged.
- [ ] 3.2 Spec deltas in this change's `specs/` are complete (D3) — `openspec validate fix-ci-pipeline-followups --strict` green; after archive, `rg -n "npm ci" openspec/specs/ci-cd-pipeline/spec.md` and `rg -n "Astro" openspec/specs/marketing-site/spec.md` (requirement blocks) return nothing.

## 4. Closeout

- [ ] 4.1 `AGENTS.md` rows: `packages/electron/scripts/AGENTS.md` (`verify-macos-floor.mjs`, `macos-floor.mjs`), `.github/workflows/AGENTS.md`, `packages/shell/AGENTS.md` if `vite.config.ts` has a row. Verify `kb dox lint` clean.
- [ ] 4.2 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` zero failures; `npm run quality:changed` clean; comment on #533, #577, #578, #580 with the change name.
