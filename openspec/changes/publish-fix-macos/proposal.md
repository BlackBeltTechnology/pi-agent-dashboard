## Why

The `Release` workflow run [#34](https://github.com/BlackBeltTechnology/pi-agent-dashboard/actions/runs/25170661930) failed because the `electron` matrix job started in parallel with the `publish` job and tried to `npm install` `@blackbelt-technology/dashboard-plugin-runtime@^0.4.2` from the public registry **before** `publish` had uploaded that version. macOS hit `ETARGET` first, fail-fast cancelled every other electron variant, and `github-release` was skipped — turning a perfectly good source tree and successful npm publish into a half-shipped release with no Electron artifacts. The race is non-deterministic across re-runs, which makes it worse than a hard failure: it sometimes "passes" and sometimes doesn't.

## What Changes

- Make the electron matrix job depend on the publish job (`needs: [prepare, publish]`) so `bundle-server.sh`'s `npm install --omit=dev` only runs after every sub-package is on the npm registry.
- Replace the implicit fail-fast cancellation with `strategy.fail-fast: false` on the electron matrix so a single OS failure no longer wastes the other four runners and so we get full diagnostic output across the matrix.
- Document the dependency-graph contract in the `ci-cd-pipeline` spec (currently silent on cross-job ordering) so the regression cannot recur via a future workflow refactor.

This is a pure CI/CD ordering fix. No application code changes; no behavior change for users; no API contract change.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `ci-cd-pipeline`: add a requirement that the electron build job depends on a successful publish job, and that the electron matrix is non-fail-fast.

## Impact

- **File**: `.github/workflows/publish.yml` only — `electron` job's `needs:` and `strategy:` keys.
- **Wallclock**: the electron matrix becomes serial-after-publish, adding ~3 min to total release wallclock (publish currently takes ~3m 18s; electron and publish previously ran concurrently). This is a one-time cost per release and acceptable.
- **No API change, no client change, no server change.**
- **Tests**: a static lint test on `publish.yml` (assert `needs:` graph) — see specs.
