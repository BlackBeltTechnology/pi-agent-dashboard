# Release Pipeline — `publish.yml` Deep Dive

The 4-job release flow with per-job failure modes and recovery paths.

```
   prepare ──▶ publish ──▶ electron ──▶ github-release
```

## Job 1 — `prepare`

**Purpose:** Resolve the version, optionally bump+commit+tag (on dispatch), produce outputs consumed by downstream jobs.

### Steps (dispatch path)

1. **Checkout** with `fetch-depth: 0` (needed for `git tag` uniqueness check).
2. **Resolve version** — from tag (on push) or input (on dispatch).
3. **Set up Node.js** — installs from `.nvmrc` or workflow-pinned version.
4. **Install dependencies** — `npm ci`.
5. **Bump workspace versions** — `npm version <X.Y.Z> --no-git-tag-version --allow-same-version --workspaces --include-workspace-root`.
6. **Sync inter-package dep specifiers** — `node scripts/sync-versions.js`.
7. **Regenerate package-lock.json** — `npm install --package-lock-only --no-audit --no-fund`. The lockfile must be regenerated because the workspace symlink graph just changed; otherwise strict prerelease semver causes consumer `npm ci` to fall back to the registry on every install.
8. **Verify lockfile matches workspace versions** — `node scripts/verify-lockfile-versions.mjs`. **Fails fast** if any cross-ref is not `^<root.version>`.
9. **Promote CHANGELOG** — Python inlined script. Inserts a new `## [Unreleased]` template before the now-versioned section.
10. **Commit, tag, push** — `chore(release): v<X.Y.Z>` + `v<X.Y.Z>` tag, pushed to the dispatched branch.

### Outputs

- `version` — e.g. `0.4.1`
- `tag` — e.g. `v0.4.1`
- `is_prerelease` — boolean derived from semver

### Common failures

| Failure | Cause | Fix |
|---------|-------|-----|
| `CHANGELOG.md already contains a section for X.Y.Z` | Re-dispatching with a previously-promoted version | Bump to a new version; or `git revert` the prior `chore(release): vX.Y.Z` commit |
| `verify-lockfile-versions.mjs` exits non-zero | A cross-ref specifier in lockfile is not `^<root.version>` | Check `scripts/sync-versions.js` ran; re-regenerate lockfile; commit |
| `Could not find '## [Unreleased]' heading` | CHANGELOG manually edited; Unreleased section missing | Restore `## [Unreleased]` heading at top of CHANGELOG |
| `git push` fails | Branch protection blocks bot pushes | Configure branch protection to allow `github-actions[bot]` OR push via PAT |
| `npm ci` fails | Lockfile out of sync with package.jsons | Locally: `npm install`, commit `package-lock.json`, re-dispatch |

## Job 2 — `publish`

**Purpose:** Publish all packages to npm via OIDC trusted publishing.

### Steps

1. **Checkout** at the resolved ref (the freshly-pushed tag on dispatch).
2. **Set up Node.js** with registry URL.
3. **Upgrade npm to latest** — required for OIDC trusted publishing.
4. **Set version from resolved tag** — `npm version` on every workspace (idempotent if already set).
5. **Sync inter-package dep specifiers to bumped version**.
6. **Publish to npm** — idempotent, ordered: sub-packages first (`packages/shared`, `packages/extension`, `packages/server`, `packages/client`), root last (`@blackbelt-technology/pi-agent-dashboard`).

### Why the order matters

The root package depends on the sub-packages via workspace specifiers. If root publishes before subs, the published root resolves to npm-registry versions of subs that don't exist yet — installs fail for end users for a brief window.

### Common failures

| Failure | Cause | Fix |
|---------|-------|-----|
| `403 Forbidden` on `npm publish` | OIDC trusted publisher not configured for that package | Configure in npm web UI: package → Settings → Trusted Publishers → GitHub Actions → repo + workflow path |
| `409 Conflict` | Version already exists on npm | Idempotency check should skip — if it doesn't, there's a real conflict. Bump version. |
| Package not found in workspace | Sub-package missing from publish list | Check the publish step's loop matches the actual workspace |
| OIDC `id-token: write` permission missing | Workflow permissions wrong | Ensure `permissions: { id-token: write, contents: read }` on publish job |

## Job 3 — `electron`

**Purpose:** Build Electron installers across the 6-leg matrix.

### Critical constraint

```yaml
electron:
  needs: [prepare, publish]   # ← LOCKED by repo-lint
```

**Do not remove `needs: [prepare, publish]`.** The electron build's bundled server runs `npm install` for `@blackbelt-technology/*` packages, which must already be available on npm. Removing this dependency would cause electron to attempt installs of versions that haven't published yet.

Locked by `packages/shared/src/__tests__/publish-workflow-contract.test.ts`.

### Delegation

This job is a single `uses: ./.github/workflows/_electron-build.yml` call with:
- `version`: from prepare outputs
- `ref`: the freshly-pushed tag
- `legs`: `all`
- `source_only_bundle`: `false` (releases bundle from npm)
- `artifact_retention_days`: 90

### Common failures

| Failure | Cause | Fix |
|---------|-------|-----|
| `Cannot find module @blackbelt-technology/...` | Publish job didn't run / failed | Check `publish` job; re-run if it failed. Never bypass the dependency. |
| node-pty prebuild missing for a triple | bundle-server.mjs GO/NO-GO guard fires | Rebuild prebuilds; add the missing triple to node-pty deps |
| `forge.config.ts` crash | Recent change broke a maker | `ci-electron.yml` should have caught this earlier — run it on the feature branch before merging |
| DMG signing fails (macOS) | Code signing certs expired or wrong | Update Apple Developer cert + secrets |
| Docker build fails (Linux) | `Dockerfile.build` issue | Test locally with `packages/electron/scripts/docker-make.sh` |

## Job 4 — `github-release`

**Purpose:** Create the GitHub Release with extracted release notes and uploaded artifacts.

### Steps

1. **Checkout** at the tag.
2. **Download all artifacts** from electron job.
3. **Extract release notes from CHANGELOG** — pulls the `## [X.Y.Z]` section.
4. **Drop builder-debug logs** — avoids asset basename collision (multiple platforms ship `builder-debug.yml` etc.).
5. **Create GitHub Release** — `gh release create` with all assets uploaded.

### Common failures

| Failure | Cause | Fix |
|---------|-------|-----|
| Asset basename collision | `builder-debug.yml` from multiple platforms | Already handled by drop step; if it reappears, expand the drop pattern |
| Release notes empty | CHANGELOG section missing or malformed | Check `prepare` job's CHANGELOG promotion |
| `gh release create` 403 | `contents: write` permission missing | Verify job permissions |
| Release marked prerelease incorrectly | `is_prerelease` output mis-derived | Check semver parser in `prepare` step |

## After the release

`sync-release-version.yml` fires on the `release: published` event, updates `site/src/data/latest-release.json`, commits to develop. Then `deploy-site.yml` redeploys. If the site doesn't update within ~5 min after release, check those two workflows.

## Recovery

If the release pipeline fails partway:

```bash
# Re-run only failed jobs (preserves successful ones)
gh run rerun <run-id> --failed

# Cancel a stuck run
gh run cancel <run-id>

# For a fully-broken release, see the release-revoke skill
```

**Do not bypass the pipeline** — manually running `npm publish` outside the workflow loses OIDC trusted publishing, lockfile sync, and CHANGELOG promotion guarantees.
