## Why

CodeQL reports 18 open `actions/cache-poisoning/poisonable-step` alerts on `develop`:

- `_electron-build.yml` — 10 alerts, including #367 at the "Install the Electron prebuilt" step (`node install.js`) from PR #800.
- `_smoke.yml` — 4 alerts.
- `publish.yml` `ci-checks` — 4 alerts (:111–114).

It also reports 15 open `actions/missing-workflow-permissions` alerts:

- `publish.yml` ×4
- `_electron-build.yml` ×2
- `_smoke.yml` ×2
- `ci-electron.yml` ×2
- `ci-e2e-electron.yml` ×2
- `ci-gateway-platform.yml` ×2
- `ci-smoke.yml` ×1

Nobody has triaged either class. Every workflow PR that adds a step re-fails the CodeQL check, and the noise hides real alerts.

The two classes are coupled, and the risk is real. The repository's default workflow token is **write** (`gh api repos/{owner}/{repo}/actions/permissions/workflow` → `default_workflow_permissions: write`). Every job without a `permissions:` block therefore holds a write `GITHUB_TOKEN`, and `actions/checkout` persists that token into `.git/config` while `pnpm install` runs. In `publish.yml` that covers `resolve`, `ci-checks`, `smoke` (→ `_smoke.yml`) and `electron` (→ `_electron-build.yml`).

Each of these runs restores the `actions/setup-node` `cache: pnpm` store. GitHub lets a tag-push or dispatch run restore caches from the default-branch (`develop`) scope. Code that executes in any `develop`-scope run can therefore plant a store, and every later privileged run executes from it. The privileged jobs are:

- `publish` — `contents: write` + `id-token: write` (npm OIDC).
- `tag-and-push` — `contents: write`.
- The `electron` release build — its installers ship.
- `runtime-asset` — its tarballs are attached to the GitHub Release.

pnpm's store integrity check does not neutralise this (see `design.md` D1). It verifies each file only against the digest recorded in the store's own index, and that index travels inside the cached store.

## What Changes

- **Least-privilege tokens.** Each workflow named by a `missing-workflow-permissions` alert has no top-level `permissions:` block. Each gains `permissions: contents: read`: `publish.yml`, `_electron-build.yml`, `_smoke.yml`, `ci-electron.yml`, `ci-smoke.yml`, `ci-e2e-electron.yml`, `ci-gateway-platform.yml`. Existing job-level blocks stay unchanged:
  - `publish.yml`: `tag-and-push`, `publish`, `runtime-asset`, `github-release`, `runtime-release-assert`, `site-redeploy`, `discord-announce`;
  - `ci-e2e-electron.yml`: `runtime-overlay-e2e`.
- **Release-privileged jobs stop restoring the dependency cache.** A job is release-privileged when it holds any `write` permission, `id-token: write`, or a non-`GITHUB_TOKEN` secret (including `secrets:` passed to a reusable workflow, or an `environment:`), or when its output is attached to a release. Every such job drops `cache:` from `actions/setup-node` and installs from the registry against the frozen lockfile. Today that means:
  - `publish.yml` `tag-and-push`, `publish` and `runtime-asset`;
  - the `electron` call into `_electron-build.yml`.

  `_electron-build.yml` gains a boolean `workflow_call` input `use_dependency_cache`. Its default is `false` (fail-closed). `publish.yml` passes `false` explicitly; `ci-electron.yml` and `nightly.yml` pass `true`.
- **A contract test pins both rules.** A new repo-wide, YAML-parsing test (`yaml`, already a root devDependency) fails in these cases:
  - a workflow leaves any job on the repository-default token;
  - a release-privileged job restores a cache through a cache-enabling `with:` key or `actions/cache`;
  - a release-privileged caller of `_electron-build.yml` does not pass `use_dependency_cache: false`, or the dev callers stop passing `true`;
  - an `_electron-build.yml` cache is not input-gated, or the input default is not `false`;
  - a non-shipping `publish.yml` job uploads an `electron-*` artifact, which `github-release`'s glob would attach.

  The existing `pnpm-migration-contract.test.ts` X5 assertion is updated to accept the input-gated cache expression in `_electron-build.yml`.

  It parses the YAML instead of running regexes over it — the lesson from #800's trigger guard.
- **Triage the remainder with recorded reasons.** Once tokens are read-only, the remaining cache-poisoning alerts sit in jobs that hold no write token and attach nothing to a release:
  - `_smoke.yml`, including the `publish.yml` release-gate caller;
  - `publish.yml` `ci-checks`;
  - `_electron-build.yml`, whose CodeQL analysis cannot see the caller's input value.

  Each is dismissed as `won't fix` with a comment pointing at `design.md` D4/D5. Dismissal is a repository action, not a commit, so the procedure lands in `.pi/skills/ci-troubleshoot/SKILL.md`, and future instances are triaged the same way.
- **Docs.** The `.github/workflows/AGENTS.md` rows for the touched workflows record the permission default, the cache rule and the new input.

Out of scope:

- `persist-credentials: false` on privileged checkouts (a non-cache hardening; follow-up);
- the `js/*` and `py/*` CodeQL classes;
- the `${{ github.event.inputs.version }}` interpolation in `publish.yml` `resolve` (a separate injection finding; dispatch requires write access);
- the pre-existing failing `job-object-windows` smoke;
- changing the repository-level default token setting (a repo setting, not a commit; explicit per-workflow blocks make the files correct regardless).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `ci-cd-pipeline`:
  - ADDED — workflows SHALL declare explicit least-privilege token permissions.
  - ADDED — release-privileged jobs SHALL NOT restore a dependency cache, and repo-lint pins both rules.
  - MODIFIED — "Reusable Electron build workflow" gains the `use_dependency_cache` input (default `false`). The delta also lists the live `artifact_name_suffix` and `registry_url` inputs, and corrects the `ci-electron.yml` scenario to `source_only_bundle: false`. Main spec `ci-cd-pipeline/spec.md:109` has been stale since `fix-ci-electron-runnable-bundles`; `ci-electron.yml:118` passes `false`.
  - MODIFIED — "Publish workflow on version tags": the electron-call scenario adds `use_dependency_cache: false`.

## Impact

- `.github/workflows/publish.yml`:
  - top-level `permissions: contents: read`;
  - remove `cache: pnpm` from `tag-and-push`, `publish` and `runtime-asset`;
  - pass `use_dependency_cache: false` to `_electron-build.yml`.
- `.github/workflows/_electron-build.yml`:
  - top-level `permissions: contents: read`;
  - new input (default `false`);
  - `cache:` becomes `${{ inputs.use_dependency_cache && 'pnpm' || '' }}`.
- `.github/workflows/{_smoke,ci-electron,ci-smoke,ci-e2e-electron,ci-gateway-platform}.yml` — top-level `permissions: contents: read`.
- `.github/workflows/ci-electron.yml`, `nightly.yml` — pass `use_dependency_cache: true`.
- `packages/shared/src/__tests__/pnpm-migration-contract.test.ts` — the X5 `_electron-build.yml` cache assertion.
- `packages/shared/src/__tests__/workflow-token-cache-contract.test.ts` (new) plus its `.AGENTS.md` sidecar row.
- `.github/workflows/AGENTS.md`, `.pi/skills/ci-troubleshoot/SKILL.md`.
- **Cost:** release jobs reinstall without a warm pnpm store. That adds an estimated few minutes per release job and per electron leg. Releases are infrequent, so this is accepted.
- **Coupling:** the in-flight `macos-notarization` and `windows-authenticode-signing` changes add signing secrets to `_electron-build.yml`. Under this rule, any secret-passing caller must pass `use_dependency_cache: false`.
- **Compatibility / rollback:** workflow-only. A job that silently relied on the write default fails loudly with a 403 at its first run; the remedy is adding a job-level `permissions:` block. Reverting the commit restores both the cache and the old token scope; the dismissed alerts must then be re-opened (design.md Migration Plan). No runtime, package or data migration.

## Discipline Skills

- `security-hardening` — CI supply-chain hardening: cache poisoning into release artifacts, and least-privilege tokens.
- `doubt-driven-review` — before the cache decision and the permission scoping stand.
- `review-code` — before commit.
