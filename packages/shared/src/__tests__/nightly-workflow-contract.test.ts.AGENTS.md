# __tests__/nightly-workflow-contract.test.ts — index

Repo-lint safety contract for the nightly (change: add-nightly-verdaccio-build). Asserts `nightly.yml`: every `npm publish` is `--dry-run` or carries `--registry http://localhost` (no public write), no `softprops/action-gh-release`, no tag `git push`, no version-bump `git commit`, and the electron job passes a loopback `registry_url`. Also asserts `_electron-build.yml` keeps its pure-artifact-producer invariant (no `npm publish`/Release/tag push) despite the `registry_url` addition.
