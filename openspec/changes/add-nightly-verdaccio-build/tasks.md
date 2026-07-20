## 1. Verdaccio config + publish script

- [ ] 1.1 Create `.github/verdaccio/config.yml`: `uplinks.npmjs` → `https://registry.npmjs.org/`; `packages['@blackbelt-technology/*']` = `access $all` + `publish $all` + **no `proxy`**; `packages['**']` = `access $all` + `proxy npmjs`; `listen: 0.0.0.0:4873` bound only via CI loopback usage.
- [ ] 1.2 Create `scripts/nightly-verdaccio-publish.mjs`: (a) bump every workspace + root to `<base>-nightly.<YYYYMMDD>.<sha7>` (where `<base>` = the **next patch** of the current `package.json` version, e.g. `0.6.1` → `0.6.2`) via `npm pkg set version`; (b) run `scripts/sync-versions.js`; (c) `npm install --package-lock-only`; (d) `node scripts/verify-lockfile-versions.mjs`; (e) publish all 31 non-private workspaces to `--registry $REGISTRY` in the same order as `publish.yml` (sub-packages first, root last).
- [ ] 1.3 Reuse the publish allowlist: import/derive the package list the same way `publish-allowlist-complete.test.ts` enforces, so a new workspace can't be silently omitted.
- [ ] 1.4 Unit test `scripts/__tests__/nightly-verdaccio-publish.test.mjs`: version-slug format `X.Y.Z-nightly.<8digits>.<7hex>`; publish set equals the non-private workspace set; ordering invariant (every pkg appears after its `@blackbelt-technology/*` deps; root last).

## 2. Bundle-completeness assertion

> Source-list guard already landed: `packages/shared/src/__tests__/bundled-plugins-complete.test.ts`
> asserts `BUNDLED_PLUGINS` in `bundle-server.mjs` == the non-fixture runtime plugins in
> `packages/*` (both directions: no missing, no stale). Task 2 adds the complementary
> *built-bundle* assert (verifies `resources/plugins/` on disk after a real build).

- [ ] 2.1 Create `packages/electron/scripts/assert-bundled-plugins-complete.mjs`: enumerate `packages/*plugin*` with a `package.json`, drop `pi-dashboard-plugin.fixture === true` and non-runtime authoring pkgs (`dashboard-plugin-skill`), compare against `resources/plugins/` in the built bundle; exit non-zero listing any missing plugin. Reuse the same criterion as the unit guard.
- [ ] 2.2 Decide the runtime-plugin predicate explicitly (manifest field, not a hardcoded denylist) so `kb-plugin` inclusion/exclusion is a data decision, not drift.
- [ ] 2.3 Unit test: fixture excluded; a synthetic missing plugin → non-zero exit + names it; complete set → exit 0.

## 3. Reusable-workflow wiring

- [ ] 3.1 `_electron-build.yml`: add input `registry_url` (string, default `""`).
- [ ] 3.2 When `registry_url != ""`: add steps to install + start Verdaccio (background), wait for `:4873` health, run `scripts/nightly-verdaccio-publish.mjs`, and set `npm_config_registry=${registry_url}` in `$GITHUB_ENV` for subsequent steps.
- [ ] 3.3 Add the `assert-bundled-plugins-complete.mjs` gate step after the bundle is built, before artifact upload.
- [ ] 3.4 Verify no regression to the two existing callers: `publish.yml` (no `registry_url` → public npm path unchanged) and `ci-electron.yml` (`source_only_bundle` path unchanged).

## 4. Nightly workflow

- [ ] 4.1 Create `.github/workflows/nightly.yml`: `on: { schedule: [{cron: '0 7 * * *'}], workflow_dispatch: {} }`.
- [ ] 4.2 `resolve` job: compute `<base>-nightly.<YYYYMMDD>.<sha7>` where `<base>` = **next patch** of the `package.json` version (increment the patch component; e.g. `0.6.1` → `0.6.2`), suffixed with `<YYYYMMDD>` + `github.sha` (`sha7`). Next-patch (not the version verbatim) so the nightly sorts ABOVE the last release instead of below it — a `X.Y.Z-nightly.*` prerelease sorts below `X.Y.Z`. Patch is the minimal forward step: it never over-claims a feature/breaking bump the way next-minor would.
- [ ] 4.3 `verify-publish` job: `npm publish --dry-run` for all 31 workspaces (pack + validation, no network write) as a cheap pre-gate.
- [ ] 4.4 `electron` job: `uses: ./.github/workflows/_electron-build.yml` with `version`, `ref: github.sha`, `legs: all`, `source_only_bundle: false`, `registry_url: http://localhost:4873`, `artifact_retention_days: 7`.
- [ ] 4.5 `report` job (`if: failure()`): open or update a single GitHub issue labelled `nightly` with the failing leg + run URL.
- [ ] 4.6 Explicitly NO `publish`/`github-release`/`tag-and-push` jobs.

## 5. Safety contract test

- [ ] 5.1 Create `packages/shared/src/__tests__/nightly-workflow-contract.test.ts` asserting `nightly.yml`: no public `npm publish` (any `npm publish` line must carry `--registry http://localhost`); no `softprops/action-gh-release`; no tag `git push`; no version-bump `git commit`.
- [ ] 5.2 Assert `_electron-build.yml` still has no `npm publish` / no Release / no tag push (the pre-existing invariant is untouched by the `registry_url` addition).

## 6. Validate (manual, tracked)

- [ ] 6.1 `workflow_dispatch` the nightly once; confirm all 6 legs green, artifacts uploaded, zero npmjs writes (check the org's npm package versions before/after — no new version appears).
- [ ] 6.2 Confirm the plugin-completeness gate behaves: temporarily point it at a bundle missing a plugin and see it fail (then revert).
- [ ] 6.3 Confirm the failure path opens the tracking issue (force a leg failure in a scratch branch).
- [ ] 6.4 After one clean manual run, enable the `cron` trigger.

## 7. Tests / Scenarios

- [ ] 7.1 Scenario (edge): a brand-new workspace added to the repo → publish set includes it automatically (allowlist-derived), Verdaccio serves it, bundle resolves it.
- [ ] 7.2 Scenario (error): Verdaccio down / publish fails on one leg → that leg fails, others unaffected, tracking issue names the leg.
- [ ] 7.3 Scenario (fidelity): a scoped dep bumped in working tree but not published to public npm → nightly resolves the working-tree copy from Verdaccio and the bundle runs; the same build against public npm would ETARGET (documents why Verdaccio, not source-only).
