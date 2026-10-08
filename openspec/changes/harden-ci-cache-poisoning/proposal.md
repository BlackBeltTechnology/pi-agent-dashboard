## Why

CodeQL reports 17 open `actions/cache-poisoning/poisonable-step` alerts on `develop`. They cover every post-checkout step of `_electron-build.yml` (:152 … :522), `_smoke.yml` (:88 … :105) and `publish.yml` `ci-checks` (:111–114). PR #800 (`fix-ci-pipeline-followups`) adds one more instance, a darwin `node install.js` step. Nobody has triaged the class, so every workflow PR that adds a step re-fails the CodeQL check and the noise hides real alerts.

The shape CodeQL flags is real in one place. A privileged run checks out code and installs dependencies through `actions/setup-node` `cache: pnpm`. The cache is restorable from the default branch scope, and the default branch is `develop`. The privileged runs:

- `publish.yml` — triggered by tag push or `workflow_dispatch`.
- `nightly.yml` — `workflow_dispatch`.
- `ci-electron.yml` — `workflow_dispatch`.

`publish.yml`'s `publish` job holds `contents: write` and `id-token: write` (npm OIDC), and it runs `pnpm install` + `pnpm run build` after restoring that cache. `tag-and-push` (`contents: write`) and the `electron` release build (via `_electron-build.yml`) do the same. A cache entry poisoned by any run that can write the `develop` scope would therefore flow into a published npm package or signed installer. Most of the 17 alerts sit in jobs that hold no secret and no write token. There the residual risk is a wrong build, not an exfiltrated credential.

## What Changes

- **Release-privileged jobs stop restoring the dependency cache.** Every job that holds a write token, `id-token: write`, or a publish/sign secret drops `cache: pnpm` from `actions/setup-node`. Today that is `publish.yml` `tag-and-push` and `publish`, plus the `electron` call into `_electron-build.yml`, which builds the shipped installers. `github-release` holds `contents: write` but restores no cache today; the contract test keeps it that way. These jobs install from the registry against the frozen lockfile. `_electron-build.yml` gains a boolean `workflow_call` input (e.g. `use_dependency_cache`, default `true`). `publish.yml` passes `false`. `ci-electron.yml` and `nightly.yml` keep the cache.
- **A contract test pins the rule.** A new assertion in `packages/shared/src/__tests__/publish-workflow-contract.test.ts` fails when any job holding `contents: write`, `id-token: write`, or a non-`GITHUB_TOKEN` secret enables `cache: pnpm` / `actions/cache`. It also fails when `publish.yml` stops passing `use_dependency_cache: false` to `_electron-build.yml`. The test parses the YAML, not regexes over it (lesson from #800's trigger guard).
- **Triage the remainder with recorded reasons.** Alerts in unprivileged jobs are dismissed as `won't fix`, each with a comment pointing at this change's design rationale. Covered: `_smoke.yml`, `publish.yml` `ci-checks`, and `_electron-build.yml` under its cached callers. Dismissing an alert is a repository action, not a commit, so the procedure lands in `.pi/skills/ci-troubleshoot/SKILL.md` and future instances are triaged the same way.
- **Docs.** The `.github/workflows/AGENTS.md` rows for `publish.yml` and `_electron-build.yml` record the cache rule and the new input.

Out of scope: the other open CodeQL classes (`actions/missing-workflow-permissions` ×3 and the `js/*` alerts), and the pre-existing failing `job-object-windows` smoke.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `ci-cd-pipeline`: a new requirement — release-privileged jobs SHALL NOT restore a dependency cache, and the contract test pins it.
- `electron-build-pipeline`: `_electron-build.yml` gains the `use_dependency_cache` input, which the release caller sets to `false`.

## Impact

- `.github/workflows/publish.yml` — remove `cache: pnpm` from privileged jobs; pass `use_dependency_cache: false` to `_electron-build.yml`.
- `.github/workflows/_electron-build.yml` — new input; `cache:` becomes conditional (`${{ inputs.use_dependency_cache && 'pnpm' || '' }}`).
- `packages/shared/src/__tests__/publish-workflow-contract.test.ts` — the privileged-job/no-cache assertion.
- `.github/workflows/AGENTS.md`, `.pi/skills/ci-troubleshoot/SKILL.md`.
- **Cost:** release runs reinstall without a warm pnpm store. That adds an estimated few minutes per release job and per electron leg. Releases are infrequent, so this is accepted.
- **Compatibility / rollback:** workflow-only. Revert the commit to restore the cache. No runtime, package, or data migration.

## Open Questions

- **Does pnpm's store integrity check already neutralise poisoning?** pnpm verifies tarball integrity against `pnpm-lock.yaml` hashes when it imports from the store (`verify-store-integrity`, default on). If that also holds for cache-restored stores, a poisoned cache can only cause a failed install, not a tampered one. In that case the risk shrinks to build-output caches, and dismissing all 17 alerts may be the proportionate answer. Settle this in `design.md` from pnpm docs/source before tasks are written.
- **Should `_smoke.yml` under `publish.yml` (release gate) also drop the cache?** It holds no write token, but it gates the release.

## Discipline Skills

- `security-hardening` — CI supply-chain hardening (cache poisoning into release artifacts with publish credentials).
- `doubt-driven-review` — before the cache decision stands. The pnpm-integrity question above could make most of the change unnecessary.
- `review-code` — before commit.
