# __tests__/knip-workflow-contract.test.ts — index

CI placement contract for the dead-code oracle (test-plan #X1-#X3). Locks the scan into nightly and OUT of `ci.yml`: its verdict does not depend on a PR diff and its runtime has no business on the PR path, so a later "just add it to CI" edit fails here. Also asserts the nightly job runs the config check before the ratchet and carries no `continue-on-error`. Corollary the wording respects: nightly runs after merge, so it DETECTS; the ship-it enforcer PREVENTS. See change: add-knip-dead-code-oracle.
