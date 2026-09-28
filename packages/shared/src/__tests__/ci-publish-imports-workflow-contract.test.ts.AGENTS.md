# __tests__/ci-publish-imports-workflow-contract.test.ts — index

CI placement contract (test-plan #X3). `ci` job in `ci.yml` runs `node scripts/verify-published-imports.mjs` both before AND after `Build (fail on regressed warnings)`; post-build run covers built tree incl. root-shipped `packages/dist/`. Line-based, comments stripped. See change: check-root-package-imports.
