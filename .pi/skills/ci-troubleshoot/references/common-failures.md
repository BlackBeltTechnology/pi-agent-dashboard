# Common CI Failures

Synthesized from recent changes in the per-directory `AGENTS.md` tree, repo-lint tests, and observed failure modes.

## Repo-lint failures (fail the `ci` job's test step)

Each lint test exists because of a real regression. **Fix the code, never loosen the lint.**

| Lint test | Forbids | If it fails |
|-----------|---------|-------------|
| `no-raw-node-import.test.ts` | Raw `--import` / `--loader` argv outside `node-spawn.ts` | Refactor the spawn site to use `platform/node-spawn.ts` |
| `no-direct-process-kill.test.ts` | `process.kill(` outside `platform/` | Use helpers from `platform/process.ts` |
| `no-hardcoded-node-modules-paths.test.ts` | Hardcoded `node_modules/electron` / `node_modules/node-pty` | Use tool registry: `getDefaultRegistry().resolve('electron')` etc. |
| `no-bare-external-anchor.test.ts` | `<a href="http(s)://">` without `target="_blank"` | Add `target="_blank" rel="noopener noreferrer"` |
| `no-bash-on-windows.test.ts` | `shell: bash` on steps that run on Windows runners | Remove `shell: bash` or guard `if: runner.os != 'Windows'` |
| `publish-workflow-contract.test.ts` | Removing electron job's `needs:` or `fail-fast: false` | Restore `needs: [prepare, publish]` and `fail-fast: false` on matrix |

## Lockfile failures

### `verify-lockfile-versions.mjs` exits non-zero in `prepare`

Cross-ref specifier in `package-lock.json` is not `^<root.version>`. Causes:

1. Someone hand-edited the lockfile.
2. `scripts/sync-versions.js` didn't run before `npm install --package-lock-only`.
3. A new workspace package was added but not registered for cross-ref sync.

Fix:
```bash
# Locally, reproduce the workflow steps:
npm version 0.0.0-test --no-git-tag-version --allow-same-version --workspaces --include-workspace-root
node scripts/sync-versions.js
npm install --package-lock-only --no-audit --no-fund
node scripts/verify-lockfile-versions.mjs

# If verify fails, fix sync-versions.js, then revert the version bump
git checkout package.json packages/*/package.json package-lock.json
```

### `npm ci` fails in CI but works locally

Lockfile out of sync with package.jsons. Cause: someone ran `npm install` instead of `npm ci` and didn't commit the updated lockfile.

Fix:
```bash
npm install
git add package-lock.json && git commit -m "chore: sync package-lock.json"
git push
```

## CHANGELOG failures

### `CHANGELOG.md already contains a section for X.Y.Z`

Re-dispatching `publish.yml` with a version that was already promoted to a dated section.

Causes:
1. Previous dispatch succeeded `prepare` but failed later; you're trying again with same version.
2. Manual edit committed an `[X.Y.Z]` section.

Fix:
- If the prior run succeeded → bump to the next version.
- If the prior run failed → `git revert` the `chore(release): vX.Y.Z` commit and the tag, then re-dispatch.

### `Could not find '## [Unreleased]' heading`

CHANGELOG was manually edited and the `## [Unreleased]` section was deleted.

Fix: re-add `## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n\n` at the top, before the most recent dated section.

## Publish failures

### `403 Forbidden` from npm

OIDC trusted publisher not configured for that package.

Fix (one-time per package): npm web UI → package → Settings → Trusted Publishers → GitHub Actions → fill in repo + workflow path (`.github/workflows/publish.yml`) + environment (if used).

### `409 Conflict` from npm

Version already exists on npm. The idempotency check should skip; if not, there's a real conflict (likely a re-dispatch with same version where the prior publish completed partially).

Fix: bump to next version. Don't try to overwrite published versions — npm allows unpublish only within 72 hours and only for packages with no dependents.

### Publish order broken

Sub-packages must publish before root. If root publishes first, end-user `npm install` of root fails until subs catch up.

Fix: ensure the publish loop in `publish.yml` iterates sub-packages before root. The `-ws --include-workspace-root` flag form (used by `release-cut` skill) handles this correctly.

## Electron build failures

### `Cannot find module @blackbelt-technology/...` in bundled server

`publish` job didn't complete before `electron` job started. This should be impossible because of `needs: [prepare, publish]`, but if the contract was bypassed (or someone deleted the `needs:`), this is the symptom.

Fix:
1. Restore `needs: [prepare, publish]` on electron job.
2. Re-run electron job after publish completes.

### node-pty prebuild missing for `<triple>`

`bundle-server.mjs` Phase 1 GO/NO-GO guard fires. The bundled server requires native node-pty prebuilds for every electron matrix triple.

Fix: check node-pty's prebuild list. If missing, file a node-pty PR or pin to a version that has the triple.

### DMG signing fails

Apple Developer certificate expired, wrong, or not in the `APPLE_*` secrets.

Fix: renew cert via Apple Developer portal; update `APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD` secrets in repo settings.

### Docker build fails (Linux legs)

`packages/electron/scripts/Dockerfile.build` issue.

Fix: reproduce locally with `packages/electron/scripts/docker-make.sh`. The Dockerfile uses `node:22-bookworm-slim`; if a base-image change broke it, pin to the previous digest.

## Smoke test failures (`standalone-install-smoke-*`)

### Smoke fails on Alpine but passes on Debian

musl libc vs glibc difference. Likely a native dep without an Alpine prebuild.

Fix: check which dep failed in the log. If it's node-pty or better-sqlite3, ensure Alpine prebuilds exist or compile from source (slower but works).

### Smoke fails on Windows

Common: path separator issues, `shell: bash` accidentally added, missing native deps.

Fix: check `no-bash-on-windows.test.ts` (it catches this in `ci.yml` first); fix the step to use cross-platform shell or guard for Windows.

### Bridge connects then disconnects in smoke

Likely the smoke is missing `LANG`/`LC_ALL` env vars and node-pty mis-detects encoding. Or the smoke didn't wait long enough for bootstrap.

Fix: add `sleep 3` after server start; ensure smoke sets `LANG=C.UTF-8`.

## Flakes vs real failures

Before assuming flake:

1. **Re-read the log** — `gh run view <run-id> --log-failed`. Most "flakes" are real races or env issues.
2. **Re-run failed only** — `gh run rerun <run-id> --failed`. If it passes on rerun, suspect environment (network, npm registry, Docker pull).
3. **Check the recent change history** — `git log -5 --oneline`. Recent merge may have introduced a regression.

If genuinely flaky:
- File an issue (don't just rerun-and-forget).
- Look for `setTimeout`, `setInterval`, race conditions in the failing test.
- Convert real-time to fake timers via `vi.useFakeTimers()`.

## When the failure makes no sense

```bash
# Get the raw log for grep
gh run view <run-id> --log > /tmp/ci.log

# Then grep with all your patterns
grep -n -B 5 -A 30 'error\|fail\|Error\|FAIL' /tmp/ci.log

# Look at the env diff between this run and the last green
gh run view <green-run-id> --log > /tmp/ci-green.log
diff <(grep -E '^Run |^##\[' /tmp/ci-green.log | head -100) \
     <(grep -E '^Run |^##\[' /tmp/ci.log | head -100)
```

If nothing reveals the cause, drop into the failing job's `actions/upload-artifact` (when available) and inspect the workspace state at failure.
