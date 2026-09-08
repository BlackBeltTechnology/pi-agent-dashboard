# Validation

## Automated evidence

- Baseline: `946b483210917f540615c17055ccfa701836f7e6`.
- Red: focused default-model tests with the original argv-only decision produced 11 behavioral failures and 54 passes. Child-marker and non-default SDK cases incorrectly applied the Dashboard default; error cases incorrectly allowed application.
- Green: `npm test -- packages/extension/src/__tests__/bridge-default-model-apply.test.ts packages/extension/src/__tests__/bridge-default-model-gate.test.ts` passed 66 tests.
- Final extension suite: `npm test -- --project @blackbelt-technology/pi-dashboard-extension` passed 145 files and 2,030 tests after the final import-order fix.
- `npm run lint` passed.
- `npm run lint:e2e` passed.
- `npm run spec:validate` passed all 577 main specifications.
- `node_modules/.bin/openspec validate fix-default-model-clobbers-sdk-model --strict` passed.
- `node_modules/.bin/biome check packages/extension/src/bridge-default-model-gate.ts packages/extension/src/__tests__/bridge-default-model-apply.test.ts --reporter=summary` passed.
- `node scripts/check-conventions.mjs --base HEAD` and `git diff --check` passed.
- LSP reported no diagnostics in the changed bridge, helper, and test files.

## Simplification and independent review

The packaged code-simplifier pass stayed within the task-owned changes. After 65 focused tests passed, the SDK helper was narrowed to SDK-only signals, removing a duplicated argv check while retaining the original argv gate. A production-wiring assertion was added. The repeated focused run passed 66 tests; the full extension suite also passed.

Fresh independent reviewer run `bd0e5bc3-e775-47dd-97a1-b3b7da62a34c` returned PASS with no issues. The child transcript records `openai-codex/gpt-6-astra` and `high` thinking. Review covered signal derivation, error handling, deferred model/thinking protection, maintainability/library choice, and documentation. It confirmed that Node filesystem access and JSON parsing are sufficient for this small read-only projection.

Reviewed code SHA-256:

- `packages/extension/src/bridge.ts`: `fb01576078ea22009db825cc49d0736f9e4ef568cde1e414f6fa5c7f7fb1f1e4`
- `packages/extension/src/bridge-default-model-gate.ts`: `89523ff1aeb94150cc88f595ea4128a0175fc44c6246de24174b773fe4ec99e0`
- `packages/extension/src/__tests__/bridge-default-model-apply.test.ts`: `ca2aac4c1d353c882c1c00e7b3eb229567d3fc2440e8243c551c9ba7a3458f15`

After review, only the test import ordering and an explicit argv/child-marker qualification in the older-Pi spec scenario changed. No production logic changed. The final extension suite and TypeScript checks were rerun successfully.

## Documentation and boundaries

Updated current bridge specs, the architecture startup-default section and Mermaid flow, its existing sidecar index, the source index, and the helper sidecar. README setup remains accurate because installation and commands do not change. Archived proposals remain historical evidence.

The tests execute the shared production guards with real temporary settings files and inspect production wiring. They are not live bridge end-to-end tests and do not invoke real model providers or provider registration. The full repository test suite and browser/rendered Mermaid validation were not run for this extension-only change.

No global settings, installed Pi package, or extension configuration was changed. No shared Dashboard/Herdr lifecycle command was run. The global-Pi-mutation fresh-start gate does not apply. Runtime rollout belongs to the owner after review.

The Firstmate guidance helper was run once and refused the existing regular `CLAUDE.md` pointer spelling (`@./AGENTS.md`) rather than overwriting it. Root `AGENTS.md` and `CLAUDE.md` remain unchanged. Shared Beads state resolves outside this worktree and was not mutated; implementation progress remains in the required change tasks.

The approved residual limitation remains: an arbitrary unmarked SDK caller explicitly choosing Pi's own configured default can still receive the Dashboard default. The global-only comparison and missing/incomplete-pair behavior are specified in design.md.
