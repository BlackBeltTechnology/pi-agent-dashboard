## 1. Pin electron version (release-unblocker)

- [x] 1.1 Edit `packages/electron/package.json`: change `"electron": "^32.0.0"` → `"electron": "32.3.3"` (the version currently resolved by the lockfile, verified via `node -e "console.log(require('electron/package.json').version)"`).
- [x] 1.2 Run `npm install` from the repo root to regenerate `package-lock.json` with the pinned version.
- [x] 1.3 Verify `package-lock.json` shows `"node_modules/electron"` with `"version": "32.3.3"` and a single resolved tarball.
- [x] 1.4 Run `npm run lint` — must pass.

## 2. Port `bundle-server.sh` → `bundle-server.mjs`

- [x] 2.1 Create `packages/electron/scripts/bundle-server.mjs` with these responsibilities (mirror the bash script verbatim):
  - Resolve `__dirname` via `fileURLToPath(import.meta.url)`; derive `ELECTRON_DIR`, `PROJECT_DIR`, `SERVER_BUNDLE`.
  - Parse `--source-only` flag from `process.argv`.
  - `fs.rmSync(SERVER_BUNDLE, {recursive:true, force:true})` then `fs.mkdirSync(...{recursive:true})` for `packages/server`, `packages/shared`, `packages/extension`, and `packages/dist/client`.
  - `fs.cpSync` the three workspace source dirs and the built client (search the same three candidate locations the script uses today: `dist/client`, `packages/dist`, `packages/client/dist`).
  - Write the synthetic workspace `package.json` to `SERVER_BUNDLE`.
  - If NOT `--source-only`: `spawnSync("npm" or "npm.cmd", ["install","--omit=dev","--no-audit","--no-fund"], { cwd: SERVER_BUNDLE, shell: process.platform === "win32" })`. Tolerate non-zero exit.
  - Recursively delete `**/__tests__/`, `**/test/` directories under `node_modules`. Delete `*.md`, `*.map`, `CHANGELOG*`, `LICENSE*`, `*.d.ts` files under `node_modules`.
  - On non-Windows: `fs.chmodSync` every `spawn-helper` file to `0o755`.
  - On macOS only: spawn `xattr -d com.apple.quarantine` for every `spawn-helper` and `*.node` under `node_modules/node-pty`.
  - Recursive directory size sum and human-readable print.
- [x] 2.2 Replace the bash invocation in `.github/workflows/publish.yml` (`bash packages/electron/scripts/bundle-server.sh`) with `node packages/electron/scripts/bundle-server.mjs`. Drop `shell: bash` from the step.
- [x] 2.3 Replace the bash invocation in `packages/electron/scripts/docker-make.sh` and `packages/electron/scripts/build-installer.sh` with `node ...mjs` (parity with the offline-bundle script's prior conversion).
- [x] 2.4 Update doc references in `forge.config.ts`, `offline-packages.ts`, AGENTS.md from `bundle-server.sh` → `bundle-server.mjs`.
- [x] 2.5 `git rm packages/electron/scripts/bundle-server.sh`.
- [x] 2.6 Verify locally on Linux: `node packages/electron/scripts/bundle-server.mjs` produces `resources/server/` with the expected directory layout (`packages/server`, `packages/shared`, `packages/extension`, `packages/dist/client`, `node_modules`, root `package.json`). Diff the file listing against a fresh `bundle-server.sh` run from a stash to confirm parity.

## 3. De-bashify Windows-reachable steps in `publish.yml`

- [x] 3.1 **Set version from resolved tag** (line ~330 today): drop `shell: bash`. The single `npm version $V ...` command runs on every shell. Default Windows shell (cmd) handles it.
- [x] 3.2 **Bundle first-party recommended extensions** (the wrapper around `node X.mjs`): split into two steps — `if: matrix.platform != 'win32'` with `shell: bash` keeping today's `tee` + heredoc step-summary, and `if: matrix.platform == 'win32'` with `shell: pwsh` using `Tee-Object` + `Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append`.
- [x] 3.3 **Bundle offline npm cache** (same pattern): split per-OS the same way as 3.2.
- [x] 3.4 **Bundle dashboard server** (after the .mjs port from §2): drop `shell: bash`. The single `node ...mjs` command runs on every shell.
- [x] 3.5 **Smoke assertion — offline bundle resources present**: split per-OS — `bash` on POSIX checks `[ -f "$DIR/manifest.json" ]`; `pwsh` on Windows uses `Test-Path`. Or unify with `node -e "process.exit(fs.existsSync(...) ? 0 : 1)"` — choose unify; smaller surface.
- [x] 3.6 **Package Electron (Windows arm64 — no NSIS cross-compile)**: drop `shell: bash`, replace with `shell: pwsh`. Convert `cd packages/electron && ../../node_modules/.bin/electron-forge package ...` to pwsh equivalent with `Set-Location` and full backslash path.
- [x] 3.7 Verify `publish.yml` parses via `node -e "yaml.load(fs.readFileSync(...))"` (or the `js-yaml` already in lockfile).

## 4. Repo-lint test

- [x] 4.1 Create `packages/shared/src/__tests__/no-bash-on-windows.test.ts` mirroring the patterns of `publish-workflow-contract.test.ts` and `no-direct-process-kill.test.ts`. Logic:
  - Read `.github/workflows/publish.yml` and `.github/workflows/ci.yml`.
  - For each workflow, find every job. For each job, capture matrix values and the `runs-on` field. Mark the job's runtime OS set.
  - Walk steps. For each step capture `name`, `shell`, and `if`. If `shell == "bash"`:
    - Compute the step's reachable OS set: job OS set ∩ `if:` filter result.
    - If the reachable set includes `windows-*`, fail with file:line + step name + cite change `eliminate-bash-on-windows-runners` in the error.
- [x] 4.2 The `if:` evaluator handles only the literal forms used in this repo's workflows (`matrix.platform == 'X'`, `matrix.platform != 'X'`, `&&`, `||`, `!(...)` , and bare conjunctions). Document the supported grammar in the test's header comment. Unrecognized `if:` expressions SHALL fail closed (treat as Windows-reachable, force the contributor to write a recognizable form or expand the evaluator).
- [x] 4.3 Run `npm test` — the new test must pass.
- [x] 4.4 Sanity-check: temporarily revert task 3.4 (re-add `shell: bash` to the Bundle dashboard server step), re-run the test, observe failure that names "Bundle dashboard server" and cites change `eliminate-bash-on-windows-runners`. Restore task 3.4 afterwards.

## 4b. Prerelease support (publish to `next` dist-tag + GitHub `prerelease: true`)

- [x] 4b.1 Edit `.github/workflows/publish.yml` `prepare` job's `Resolve version` step. Add a third line right after `tag=...`:
  ```bash
  is_prerelease=$([[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+- ]] && echo true || echo false)
  echo "is_prerelease=$is_prerelease" >> "$GITHUB_OUTPUT"
  ```
  Both branches (tag-push and workflow_dispatch) reach the same write since the regex applies to the resolved `$version` value before that line.
- [x] 4b.2 Edit the `prepare` job's `outputs:` block. Add `is_prerelease: ${{ steps.resolve.outputs.is_prerelease }}` alongside the existing `version` and `tag` outputs.
- [x] 4b.3 Edit the `publish` job's per-package npm publish loop. Compute the `--tag` argument conditionally before each `npm publish` call:
  ```bash
  PRERELEASE="${{ needs.prepare.outputs.is_prerelease }}"
  TAG_ARG=""
  if [ "$PRERELEASE" = "true" ]; then TAG_ARG="--tag next"; fi
  ```
  Pass `$TAG_ARG` to both invocations (root metapackage AND `--workspace=$pkg` sub-packages). Quoting note: leave `$TAG_ARG` UN-quoted so the empty-string case for stable releases doesn't pass an empty arg to npm.
- [x] 4b.4 Edit the `github-release` job's `softprops/action-gh-release@v2` step. Add `prerelease: ${{ needs.prepare.outputs.is_prerelease == 'true' }}` to the `with:` block (the literal-string comparison is required because Actions stringifies job outputs).
- [x] 4b.5 Extend `packages/shared/src/__tests__/publish-workflow-contract.test.ts`. Add three new test cases:
  - The `prepare` job's `outputs:` block contains `is_prerelease`.
  - The `publish` job's body contains the literal `--tag next` AND the `is_prerelease == "true"` (or `[ "$PRERELEASE" = "true" ]`) conditional in the same step.
  - The `github-release` step's body contains `prerelease:` followed by an `is_prerelease`-keyed expression.
  Failure messages cite change `eliminate-bash-on-windows-runners` per the design D6 contract.
- [x] 4b.6 Run `HOME=$(mktemp -d) npx vitest run packages/shared/src/__tests__/publish-workflow-contract.test.ts` — must pass.
- [x] 4b.7 Sanity-check: temporarily revert task 4b.2 (drop the `is_prerelease` from `outputs:`), re-run the test, observe a failure that names the missing output AND cites the change. Restore.

## 5. Documentation

- [x] 5.1 Update `docs/architecture.md` — add a "Cross-OS build orchestration" section documenting:
  - The principle (Node-native scripts only for cross-OS work).
  - The shell allowlist (`bash` POSIX-only, `pwsh` Windows-only, `node` everywhere).
  - The `no-bash-on-windows.test.ts` invariant.
  - The four-cell failure-mode matrix from this change's design.md.
- [x] 5.2 Update `AGENTS.md` Key Files table:
  - Add row for `packages/electron/scripts/bundle-server.mjs` (replacing `.sh`).
  - Add row for `packages/shared/src/__tests__/no-bash-on-windows.test.ts`.
  - Extend the existing `.github/workflows/publish.yml` row with a one-line invariant statement: "no `shell: bash` step is reachable on a Windows runner; locked by `no-bash-on-windows.test.ts`."
- [x] 5.3 Add a `### Changed` entry to `CHANGELOG.md`'s `## [Unreleased]` section: "Windows electron builds now use only Windows-native + Node tools (no MSYS/bash). `bundle-server.sh` ported to `bundle-server.mjs`. Pins electron@32.3.3 to unblock NSIS maker. (eliminate-bash-on-windows-runners)"
- [x] 5.4 Extend the same `### Changed` entry (or add a sibling line) noting prerelease support: "Prerelease versions (e.g. `0.4.5-rc.1`, any version with a SemVer prerelease segment) now publish to npm under the `next` dist-tag (consumers opt in via `npm install <pkg>@next` or `@<exact-version>`) and surface as GitHub `prerelease: true` Releases. Stable versions keep `latest` + regular Release. (eliminate-bash-on-windows-runners)"

## 6. Verify

- [x] 6.1 Run `npm run lint` — must pass.
- [x] 6.2 Run `npm test 2>&1 | tee /tmp/pi-test.log` — must pass. Confirm `no-bash-on-windows.test.ts` is in the pass count.
- [x] 6.3 Run `openspec validate eliminate-bash-on-windows-runners --strict` — must return "valid".
- [x] 6.4 Push to `develop` (no tag).
- [x] 6.5 Trigger `workflow_dispatch` with a pre-release version (e.g. `0.4.5-rc.1`) and watch the matrix. Capture the run URL.
- [x] 6.6 Confirm Windows x64 NSIS produces an `.exe` artifact and Windows arm64 packaging produces a `.zip`. If either fails, capture the log and either fix or rollback.
- [x] 6.7 On rc success: tag the real release.
