## Context

`publish.yml` couples three concerns into one workflow:

1. **Version preparation** — bump workspace package.json files, regenerate lockfile, promote CHANGELOG, commit, tag, push.
2. **npm publish** — ordered per-package publish via OIDC Trusted Publisher.
3. **Electron build** — 6-leg matrix producing DMG / AppImage / DEB / Windows ZIP + portable .exe.
4. **GitHub Release** — draft Release with the binaries attached.

A CI dev build needs only (3), with a non-conflicting version slug and a sandboxed artifact destination. The cleanest factoring extracts (3) into a reusable workflow consumed by both pipelines.

## Decision 1 — Version slug shape

**Slug: `<base>-ci.<UTC-stamp>.<branch-slug>.<sha7>`**

- `base` = root `package.json` `version` field, read with `node -p`.
- `UTC-stamp` = `date -u +%Y%m%d-%H%M%S` → `20260525-143000`.
- `branch-slug` = `GITHUB_REF_NAME` with `[^a-zA-Z0-9.-]` replaced by `-`, truncated to 20 chars, trailing `-` stripped. Example: `feature/foo-bar` → `feature-foo-bar`.
- `sha7` = `GITHUB_SHA[:7]`.

Example final slug: `0.5.3-ci.20260525-143000.feature-foo-bar.abc1234`.

**Why prerelease, not build-metadata (`+ci.…`):** SemVer build metadata (`+`) is stripped by npm at publish time and inconsistently handled by `electron-forge` / `electron-builder` artifact naming. Prerelease segment (`-`) is preserved everywhere and orders strictly below the base stable version, which is the safety property we need (see Decision 4).

**SemVer validation:** the slug is validated at workflow start via the same regex `publish.yml` uses (`^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?(\+[A-Za-z0-9.-]+)?$`). A branch name with characters that survive sanitisation into an invalid SemVer identifier (e.g. starting with `.`) fails the validation early. Sanitiser MUST also strip leading `.` and `-`.

## Decision 2 — Reusable workflow boundary

Create `.github/workflows/_electron-build.yml` with `on: workflow_call`. Inputs:

| Input | Type | Required | Default | Notes |
|---|---|---|---|---|
| `version` | string | yes | — | SemVer string to set via `npm version` |
| `ref` | string | yes | — | Git ref to check out (tag for release, sha for CI) |
| `legs` | string | no | `all` | `all` \| `darwin` \| `linux` \| `win32` \| comma-list like `darwin-arm64,linux-x64` |
| `source_only_bundle` | boolean | no | `false` | Pass `--source-only` to `bundle-server.mjs` |
| `artifact_retention_days` | number | no | `14` | upload-artifact retention |

Outputs: none (artifacts only).

`publish.yml`'s `electron` job is replaced by:

```yaml
electron:
  needs: [prepare, publish]
  uses: ./.github/workflows/_electron-build.yml
  with:
    version: ${{ needs.prepare.outputs.version }}
    ref:     ${{ needs.prepare.outputs.tag }}
    legs:    all
    source_only_bundle: false
    artifact_retention_days: 90  # release artifacts live longer
```

`ci-electron.yml` consumes it with `source_only_bundle: true`, `ref: ${{ github.sha }}`, `legs: ${{ inputs.legs }}`.

**Matrix-subset implementation:** the reusable workflow includes the full 6-leg matrix and uses a `if:` guard per-leg that parses the `legs` input. Reject: dynamic matrix generation via `outputs.matrix` from a setup job. Reason: simpler, the `if:` guard short-circuits unused legs in <5s each, total overhead negligible.

## Decision 3 — Bundle-server source-only mode

> **⚠ Superseded by `fix-ci-electron-runnable-bundles` (2026-05-25).**
>
> The spike below validated that a source-only bundle is runnable *when an `npm install --omit=dev` step runs against it before launch*. The Linux container harness ran that install explicitly. **End users do not.** Post `eliminate-electron-runtime-install` (R3 dep lift), the runtime install path on user machines was deleted on purpose, so the implicit assumption "npm install runs later" no longer holds outside the harness.
>
> Net effect: CI-dispatched artefacts unzipped on a real desktop throw `BundledServerMissingError` because `resources/server/node_modules/` is absent. Documented user-visible symptom: Windows ZIP, `cli.ts` missing dialog.
>
> The corrected decision lives in `fix-ci-electron-runnable-bundles/proposal.md`: `ci-electron.yml` passes `source_only_bundle: false`, identical to the release flow. The spike + harness remain valid for the Docker cross-compile path (`docker-make.sh`) and as a structural probe; only the CI-workflow value flips.
>
> Section preserved below as historical record. Do not consult for current behaviour.
>
> ---

`bundle-server.mjs --source-only` skips the host-side `npm install` during bundle, leaving workspace source dirs in place. The Linux runner then runs `npm install --omit=dev` in-container, which resolves third-party deps from npm and materialises `@blackbelt-technology/*` workspaces via the bundle's synthetic root `package.json` (`workspaces: ["packages/server", "packages/shared", "packages/extension", "packages/dashboard-plugin-runtime"]`). This removes the registry-availability dependency that `publish.yml` carries via `needs: [prepare, publish]`.

**Spike result (2026-05-25):** verified end-to-end via `packages/electron/scripts/spike-source-only-bundle.sh` against `node:24-bookworm-slim`. **All checks PASS, including live HTTP health probe.**

| Check | Result |
|---|---|
| `bundle-server.mjs --source-only` exits 0 | ✓ |
| Bundle structure: `package.json`, `packages/{server,shared,extension}/src/`, `resources/plugins/` | ✓ |
| `node_modules/` correctly absent from host output | ✓ |
| In-container `npm install --omit=dev` succeeds (39s) | ✓ |
| `node-pty` native rebuild for `linux-x64` succeeds | ✓ |
| `@blackbelt-technology/*` workspaces materialise from local source (not registry) | ✓ |
| Server boots under jiti loader (production loader) | ✓ |
| `GET /api/health` returns 200 within 12 s (30 s budget) | ✓ |
| Pi gateway listens on :9999, mDNS advertises, bridge extension registers | ✓ |
| Total bundle on disk pre-install: ~27 MB | ✓ |

Conclusion: `source_only_bundle: true` is the CI default. The bundle is provably runnable in a clean Linux container with nothing but `npm install --omit=dev`.

**Loader note**: production launches go through `packages/shared/src/server-launcher.ts` which uses jiti. The harness initially used tsx and surfaced a `bonjour-service` ESM/CJS interop error — a tsx-specific quirk that does not affect production. The fix in `test-server-launch.sh` Test 8 uses the bundled jiti loader at `node_modules/jiti/lib/jiti-register.mjs` (raw path, not `file://` URL, per `node-spawn.ts` isJitiLoader contract). After this fix the harness is both a structural and a boot validator.

**Side-effects of the spike** (preserved as cleanup):
- `packages/electron/scripts/test-server-launch.sh` — fixed orphan `COPY resources/server/dist` (path no longer produced by the bundler), conditional `-it` vs `-i` flag for non-TTY environments, and added Test 8 (jiti + `/api/health` probe) as the load-bearing verdict.
- `packages/electron/scripts/spike-source-only-bundle.sh` — new non-destructive probe with backup/restore, captures the empirical contract in executable form.

## Decision 4 — Safety against installed-user update clobber

The CI workflow MUST NOT:

- Run any `npm publish` step.
- Create any GitHub Release (drafts, prereleases, or full).
- Push any git tag.

Defence-in-depth: even if a future change accidentally added a Release publish, the version slug `<base>-ci.<…>` SemVer-ranks below `<base>`, so `electron-updater` with default `allowPrerelease: false` would not offer it as an update. `update-checker.ts` for standalone installs queries npm — and CI builds are never on npm.

A repo lint test enforces the no-publish, no-release invariant by scanning `ci-electron.yml` for forbidden actions:

```
softprops/action-gh-release | actions/create-release | npm publish
```

Match → test fails.

## Decision 5 — Artifact accessibility

`actions/upload-artifact@v4` with:

- `name: electron-${{ matrix.platform }}-${{ matrix.arch }}-${{ inputs.sha7 }}` (unique per-leg, sha-stamped for traceability).
- `path: packages/electron/out/make/**/*`.
- `retention-days: ${{ inputs.artifact_retention_days }}` (CI default 14, release override 90).
- `if-no-files-found: error` to fail loudly when a leg silently produces nothing.

Download URL is the per-run Actions page. Repo collaborators only — matches the user's stated audience.

## Decision 6 — Concurrency

```yaml
concurrency:
  group: ci-electron-${{ github.ref }}
  cancel-in-progress: true
```

Re-dispatching on the same branch cancels the prior run. Different branches run in parallel. Release flow keeps its own (or no) concurrency group; the reusable workflow inherits the caller's.

## Open Questions

1. ~~Spike result for `--source-only`~~ — **resolved** (see Decision 3, Spike result section). `source_only_bundle: true` is the CI default.
2. macOS deployment-target verification step in `publish.yml` currently inspects a DMG via `hdiutil attach`. Does it run unmodified in the reusable workflow? Expected yes (the step is matrix-local), confirmed by task 5 dry-run.
3. Should the CI workflow surface the resolved version slug in `GITHUB_STEP_SUMMARY` for easy copy/paste? Lean yes, trivial.
4. ~~Pre-existing harness boot issue~~ — **resolved** during spike. `test-server-launch.sh` Test 8 now uses the jiti loader from inside the bundle and confirms `/api/health` 200. The tsx-based Tests 2–4 are retained as diagnostics but no longer load-bearing.

## Non-Goals

- Code signing / notarisation for CI builds.
- Public, anonymous artifact access.
- PR-triggered or scheduled builds.
- Differential bundle uploads or artifact deduplication across legs.
- Caching the bundled server tarball between runs.
