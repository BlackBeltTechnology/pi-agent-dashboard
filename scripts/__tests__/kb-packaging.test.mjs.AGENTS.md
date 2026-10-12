# __tests__/kb-packaging.test.mjs — index

C2 (fix-kb-eval-measurement-integrity, ci-level behind RUN_CI_SCENARIOS=1): `npm pack --dry-run` of packages/kb after a real build must carry bin/kb.mjs, bin/lib/engine-fingerprint.mjs, engine-fingerprint.json, dist/cli.js, src/ — and no `__tests__`.
