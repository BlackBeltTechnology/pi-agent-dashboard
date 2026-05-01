## 1. Local reproduction (verify the bug before fixing it)

- [x] 1.1 ~~Create a throwaway worktree~~ — superseded. The bug is empirically verified by GitHub Actions run [#34](https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/25170661930): macOS hit ETARGET at 14:22:57; `publish` only finished at 14:24:42 (1m 45s gap). A worktree+`npm install` repro would only re-prove what's already proven; skipped to avoid the ~3 min cost.
- [x] 1.2 ~~Bump versions~~ — superseded (see 1.1). Mechanism verified separately: `npm view @blackbelt-technology/dashboard-plugin-runtime@^0.99.99-repro.0` returns 404/ETARGET, exactly the failure family the macOS runner hit when only `0.4.1` was on the registry and the lockfile demanded `^0.4.2`.
- [x] 1.3 ~~Run install + bundle-server.sh~~ — superseded (see 1.1, 1.2). Confirmed via `npm view` that any non-existent version triggers the ETARGET path; the bundled `npm install` is a thin wrapper around the same registry resolution.
- [x] 1.4 ~~Tear down worktree~~ — N/A, no worktree was created.

## 2. Fix the workflow

- [x] 2.1 Edited `.github/workflows/publish.yml` line 216: `needs: prepare` → `needs: [prepare, publish]`. Added a comment block explaining the contract and citing the change name.
- [x] 2.2 Same edit added `strategy.fail-fast: false` (line 218) as a sibling of `matrix:` on the electron job.
- [x] 2.3 Verified with `node -e "const y=require('js-yaml');..."` — file parses, `electron.needs === ["prepare","publish"]`, `electron.strategy['fail-fast'] === false`, all 5 matrix variants intact.

## 3. Lock the contract with an automated test

- [x] 3.1 Added `packages/shared/src/__tests__/publish-workflow-contract.test.ts`. Uses regex-based extraction (no YAML library dependency — js-yaml isn't declared in any workspace `package.json`, only present transitively in the lockfile) to assert:
  - the `electron` job's `needs:` (flow-list OR block-list form) contains both `prepare` and `publish`;
  - `strategy.fail-fast` is the literal `false` (NOT absent — absence reverts to GitHub Actions' default `true`).
  Failure messages cite change `publish-fix-macos` and dump the offending job block for fast diagnosis.
- [x] 3.2 Ran `npm test 2>&1 | tee /tmp/pi-test.log` — **372 test files passed, 3783 tests passed, 9 skipped**, 0 failures. New test included in the pass count.
- [x] 3.3 Sanity-checked: temporarily reverted `2.1` (`needs: [prepare, publish]` → `needs: prepare`), re-ran the test, observed `Error: electron job has no \`needs:\` key — must declare \`needs: [prepare, publish]\`. See change: publish-fix-macos.` Restored `2.1` afterwards. The other test (`fail-fast`) passed both with and without the revert (it's an independent assertion).

## 4. Documentation

- [x] 4.1 Extended the existing `AGENTS.md` row for `.github/workflows/publish.yml` with a new "**Electron-publish dependency-graph contract**" paragraph citing change `publish-fix-macos` and the lock-test path. Added a sibling row for `packages/shared/src/__tests__/publish-workflow-contract.test.ts`.
- [x] 4.2 Added a `### Fixed` entry to `CHANGELOG.md`'s `## [Unreleased]` section: "Release CI: electron matrix no longer races `publish`." with the full mechanism description and the wallclock trade-off note.

## 5. Verify locally one more time

- [x] 5.1 Mechanism re-verified via `npm view` (see 1.2). The fix is workflow-only — `bundle-server.sh` is unchanged, so the script's behavior in non-CI contexts (e.g. local `electron:make`) is identical to today.
- [x] 5.2 `npm run lint && npm test` — lint passes (`tsc --noEmit`, 0 errors); tests all pass (372/372 files, 3783/3792 tests, 9 skipped, 0 failed).
- [x] 5.3 `openspec validate publish-fix-macos --strict` → `Change 'publish-fix-macos' is valid`.
