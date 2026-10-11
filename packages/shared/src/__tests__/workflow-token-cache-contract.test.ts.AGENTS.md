# __tests__/workflow-token-cache-contract.test.ts — index

Repo-lint over every `.github/workflows/*.{yml,yaml}`. Pure checker `checkWorkflows(Map<basename, parsedYaml>)` → `Violation[]`; `parseWorkflowTexts` throws naming a malformed file; `loadWorkflowDir` lists `.yml` + `.yaml`.

Rules: 0 explicit token permissions (top-level block or job-level; `TOP_READ_FILES` = exactly `{contents: read}`); 1 no `actions/cache*` / non-empty cache key (`CACHE_KEYS`) in a release-privileged job; 2 `_electron-build.yml` callers: privileged → boolean `use_dependency_cache: false`, `DEV_CACHE_CALLERS` (`ci-electron.yml` build, `nightly.yml` electron) → `true`; 3 callee input boolean default false + cache gated on it (gated step exempt from rule 1); 4 `publish.yml` job outside `SHIPS_IN_RELEASE` (and its reusable callee) must not upload `electron-*`.

Release-privileged: (a) write scope / `write-all` / `id-token: write`, (b) non-GITHUB_TOKEN secret / `secrets:` / `environment:`, (c) listed in `SHIPS_IN_RELEASE` (top of file; update when a new job's output is attached to a release). Evaluated per call site for reusable callees.

Falsification fixtures mutate a clone of the real tree. See change: harden-ci-cache-poisoning.
