# Tasks

## 1. Spike — prove the model applies (design D3) — throwaway branches, never merged

- [ ] 1.1 Control branch from `develop`: add `packages/server/src/codeql-probe-routes.ts` (guarded/unguarded Fastify route pair, guard imported from `@blackbelt-technology/pi-dashboard-shared/cwd-guard.js`); open a draft PR. Verify: the PR's CodeQL analysis reports BOTH probe sinks; run URL recorded in `evidence/spike.md`.
- [ ] 1.2 Probe branch = control + groups 2–3 of this change. Verify: the PR's CodeQL analysis reports the unguarded sink and NOT the guarded one; `npm run codeql -- --json` on the branch does the same; both recorded in `evidence/spike.md`. **Gate:** otherwise stop → `systematic-debugging` (package-name rows, `codeql resolve extensions`); unresolved → re-plan `core-cwd-admission` and `triage-codeql-alert-debt`.
- [ ] 1.3 Close both draft PRs and delete both branches. Verify: `git ls-remote origin` shows neither branch; `evidence/spike.md` committed in this change.

## 2. Model pack layout (D1)

- [ ] 2.1 Create `.github/codeql/extensions/pi-dashboard-models/codeql-pack.yml` (D1 content) and `git mv` `cwd-guard.model.yml` into it unchanged. Verify: `codeql resolve extensions --additional-packs .github/codeql/extensions --model-packs pi-dashboard/models` (or `codeql pack resolve-dependencies`) lists the model rows offline.
- [ ] 2.2 Update `.github/codeql/AGENTS.md` and `.github/codeql/extensions/AGENTS.md` (new pack dir row, moved model file; scaffold `pi-dashboard-models/AGENTS.md`). Verify: rows present; `kb dox lint` clean.

## 3. Local ratchet loads the pack (D2)

- [ ] 3.1 `scripts/codeql-local.mjs`: add `--additional-packs <snapshot>/.github/codeql/extensions --model-packs pi-dashboard/models` to `database analyze` (`:670`). Verify: `npm run codeql -- --json` completes with the pack on this machine.
- [ ] 3.2 Model-pack resolution failure → `CODEQL SKIPPED: model pack pi-dashboard/models unavailable (…)`, exit 0, `--json` skipped status with cause. Verify: running with an empty `CODEQL_PACK_CACHE`-equivalent (temporary `--search-path`-free env) prints the skip.

## 4. Mirror-dismissal mode (D4)

- [ ] 4.1 Extend the reason validator for the multi-number `github-dismissed (#n, #m, …)` form. Verify: the validator accepts every reason in the current `codeql-baseline.json`.
- [ ] 4.2 Implement `--mirror-dismissal` next to `modeTriage` (`:837`), sharing lock + hash-binding helpers; add it to `--help`. Verify: `node scripts/codeql-local.mjs --help` lists it.

## 5. Ignore spike code + prune

- [ ] 5.1 Add `spike/**` to `.github/codeql/codeql-config.yml` `paths-ignore` (+ header comment). Verify: `node scripts/codeql-local.mjs --prune` removes the 4 `spike/identity-login-plane/*` entries; `--check-baseline-diff origin/develop` passes.
- [ ] 5.2 After the local run with the model loaded, `--prune` any entries the model now closes. Verify: lowered/removed entries listed in the PR body; `--check-baseline-diff origin/develop` passes.

## 6. Docs

- [ ] 6.1 `docs/code-quality.md` CodeQL ratchet section via DocScribe: model pack layout + both loaders, `spike/**`, `--mirror-dismissal` Commands row, correction of the "identical results with the model" note. Verify: `grep -n "mirror-dismissal\|pi-dashboard-models" docs/code-quality.md` hits.

## 7. Post-merge parity re-measure (D5)

- [ ] 7.1 After the first `develop` CodeQL scan with the pack, compare local vs CI result multisets at that commit per the `docs/code-quality.md` protocol. Verify: before/after numbers recorded in `docs/code-quality.md` (DocScribe); unmatched-share growth ≤ 5 points, else stop for a decision.

## Workflow follow-up

- Archive via `ship-change` after 7.1; sync the `codeql-local-ratchet` delta.
