## Context

See proposal.md — Why. The current state that shapes the approach:

- **Repo default token is write.** `gh api repos/{owner}/{repo}/actions/permissions/workflow` returns `default_workflow_permissions: write`.
  - Six workflows declare a top-level `permissions:` block: `ci.yml`, `ci-e2e-browser.yml`, `nightly.yml`, `nightly-tests.yml`, `deploy-site.yml`, `sync-release-version.yml`.
  - Seven do not: `publish.yml`, `_electron-build.yml`, `_smoke.yml`, `ci-electron.yml`, `ci-smoke.yml`, `ci-e2e-electron.yml`, `ci-gateway-platform.yml`.
  - Some jobs in those seven declare job-level blocks: `publish.yml` has seven, and `ci-e2e-electron.yml` `runtime-overlay-e2e` has one.
- **publish.yml job map** (`.github/workflows/publish.yml`):

  | Job | Permissions | Cache / secrets | Note |
  |---|---|---|---|
  | `resolve` (:38) | default | — | — |
  | `ci-checks` (:88) | default | `cache: pnpm` (:109) | runs `pnpm install` / `lint` / `test` / `build`; nothing it builds ships |
  | `smoke` | default | — | calls `_smoke.yml` |
  | `tag-and-push` | `contents: write` (:136) | `cache: pnpm` (:150) | — |
  | `publish` | `contents: write`, `id-token: write` (:240–242) | `cache: pnpm` (:256) | — |
  | `electron` (:521) | default | — | `uses: _electron-build.yml` at :539 |
  | `runtime-asset` | `contents: read` (:559) | `cache: pnpm` (:584) | uploads `electron-runtime-*`, which `github-release` attaches to the Release |
  | `github-release` | `contents: write` (:604) | — | — |
  | `runtime-release-assert` | `contents: write` (:766) | — | — |
  | `site-redeploy` | `actions: write` (:803) | — | — |
  | `discord-announce` | `contents: read` (:866) | `secrets.DISCORD_RELEASE_WEBHOOK` (:871) | — |
- **Reusable workflows** run with the caller job's token. A called workflow's own `permissions:` can only narrow the caller's grant. They receive secrets only through the caller's `secrets:` mapping or `secrets: inherit`.
  - `_electron-build.yml` restores `cache: pnpm` at :138, then runs `pnpm install --frozen-lockfile` at :153.
  - Its callers are `publish.yml` `electron`, `ci-electron.yml` `build` and `nightly.yml` `electron`. None passes `secrets:` today.
- **In-flight coupling.**
  - `openspec/changes/macos-notarization/tasks.md:9,13` adds `CSC_LINK`/`APPLE_*` secrets and a keychain step to `_electron-build.yml`'s macOS legs.
  - `windows-authenticode-signing` adds Azure Trusted Signing secrets plus OIDC (`tasks.md:10`). Its tasks do not name the workflow file (*unverified where it lands*).
- **Cache mechanics.** `actions/setup-node` `cache: pnpm` caches the `pnpm store path` directory: content-addressed files plus the per-package index. Its key is derived from the `pnpm-lock.yaml` hash (*stated assumption; verify against setup-node source at implementation*).
  - Per GitHub's cache-access restrictions (docs.github.com, "Caching dependencies to speed up workflows" → "Restrictions for accessing a cache"; *re-confirm at implementation*), a run can restore caches created on its current ref or on the default branch. A tag-push or dispatch run can therefore restore entries saved in the `develop` scope. PR runs save into their own ref scope, which `develop` cannot read.
  - `ci-checks` and `smoke` check out the resolved `ref` (`github.sha`, `publish.yml:46`): the tag commit on tag-push runs, the branch HEAD on dispatch.
  - `publish` and `runtime-asset` check out the tag, whose lockfile is a deterministic version bump of the dispatching branch's lockfile. Its key is therefore precomputable.
- **Threat model.** The attacker gains code execution in any job of a `develop`-scope run — for example a dependency's lifecycle script, a dev-tool compromise, or test code merged to `develop`. That job holds only a read token, but the runtime cache token lets it save an entry for a key no legitimate run has saved yet. A later release run restores that entry and executes it while holding `contents: write`, `id-token: write` (npm OIDC), or while building release assets. The attack escalates from read-only CI to release credentials.
- **Existing contract tests.**
  - `packages/shared/src/__tests__/publish-workflow-contract.test.ts` is line-scanning by design; its header rejects a YAML library.
  - `pnpm-migration-contract.test.ts:110–122` (X5) asserts `/cache:\s*pnpm/` textually on `ci.yml`, `publish.yml`, `_electron-build.yml`, `_smoke.yml` and `ci-e2e-electron.yml`.
  - `nightly-tests-workflow-contract.test.ts` and `site-deploy-workflow-contract.test.ts` import `yaml` (root devDependency `yaml ^2.9.0`, `package.json:143`).

## Goals / Non-Goals

**Goals:**
- No job holds a write token unless it declares one.
- No code restored from a dependency cache executes in a job that holds a write scope, `id-token`, or a non-`GITHUB_TOKEN` secret, or that builds an artifact attached to a release.
- Both invariants are machine-checked on every PR, so a new workflow, job, caller or secret cannot regress them silently.
- Every remaining CodeQL alert of the two classes has a recorded, reproducible disposition.

**Non-Goals:**
- Removing caches from unprivileged, non-release jobs. Their worst case is a wrong test or gate result, or a poisoned dev/nightly artifact that is never attached to a release.
- Integrity-pinning the electron `@electron/get` download cache or other tool caches (not `actions/cache`-restored).
- Changing the repository-level default token setting.
- Correcting the pre-existing "bit-for-bit identical" wording of the reusable-workflow artifact scenario (carried verbatim).

## Decisions

### D1 — pnpm store integrity does not neutralise a poisoned cache

pnpm 11.15.1 (`packageManager`, `package.json:10`) verifies an imported package in `checkPkgFilesIntegrity` (pnpm `dist/worker.js:8030`) → `verifyFile` (`:8109`):

- It compares each file only against the `digest` recorded in the store's own package index entry.
- It re-hashes only when the file's `mtimeMs` exceeds the index's `checkedAt` by more than 100 ms (`checkFile`, `:8143`).
- The import path shown re-derives nothing from the lockfile's tarball `integrity`; it trusts the index digests.

The index lives inside the cached store directory. A writer of the cache writes a self-consistent index plus files, sets matching mtimes, and passes verification. `sideEffects` entries (post-install build outputs) are verified the same way.

**Alternative rejected:** dismissing all alerts on integrity grounds.

### D2 — Least privilege via explicit top-level `permissions: contents: read`

Add a top-level `permissions: contents: read` to each of the seven workflows that lack one. Existing job-level blocks stay unchanged, and they override the top level.

Read is sufficient for every job that loses write:

- `actions/checkout` needs `contents: read`.
- `actions/upload-artifact` and `download-artifact` within a run use the runtime token, not `GITHUB_TOKEN`. In-repo evidence: `ci.yml` uploads under a top-level `contents: read` (`ci.yml:84`), `runtime-asset` uploads under `contents: read`, and `github-release` downloads with no `actions:` scope today.
- `resolve` uses `git ls-remote` against a public origin.
- A grep for `gh (pr|issue|api|release|run)`, `git push`, `GITHUB_TOKEN`, `github.token`, `actions/github-script` and `secrets.` finds nothing across `_smoke.yml`, `_electron-build.yml`, `ci-electron.yml`, `ci-smoke.yml`, `ci-e2e-electron.yml`, `ci-gateway-platform.yml`, or `publish.yml`'s demoted jobs (`resolve`, `ci-checks`, and the `smoke` / `electron` callers). `resolve` runs only `git ls-remote`, and `ci-checks` runs install / lint / test / build at `publish.yml:101–117`.

Residual: nothing pins "read-scoped jobs make no write API call". A later PR adding one fails loudly with a 403 at runtime, not at lint. Accepted — the failure is safe, and visible.

**Alternatives rejected:**
- Flipping the repository default: invisible to review and to the test.
- Job-level blocks on every job: a new job silently inherits write.
- `persist-credentials: false` alone: does not close the missing-permissions alerts.

### D3 — "Release-privileged" predicate and the enforced rules

**Effective permissions** of a job are its job-level `permissions:`, else the workflow's top-level block. Privilege is evaluated **per call site**: a reusable callee's job is privileged for a call when the calling job is. The shorthands are normalised: `write-all` means write on every scope, while `read-all` and `{}` mean no write. A job that has neither block is "default"; rule 0 forbids that state. For a reusable callee the effective permissions are those of the calling job.

A job is release-privileged when any of these holds:

- **(a)** Its effective permissions grant `write` on any scope, or `id-token: write`.
- **(b)** It can see a non-`GITHUB_TOKEN` secret. That covers three cases:
  - it references `secrets.<NAME>` with `NAME ≠ GITHUB_TOKEN`;
  - it is a `uses:` job carrying a `secrets:` key (a mapping or `inherit`);
  - it declares an `environment:`, since environments can inject secrets the job text does not name.
- **(c)** It is named in the test's ships-in-release list: `publish.yml` → `runtime-asset`, `electron`.

Predicate (a) intentionally includes `actions: write` and `issues: write`. A cache restored into any write-token job lets planted code use that token.

Classification today:

- **`publish.yml`** — `tag-and-push`, `publish`, `github-release`, `runtime-release-assert`, `site-redeploy` by (a); `discord-announce` by (b); `runtime-asset`, `electron` by (c).
- **Elsewhere, cache-free** — `nightly-tests.yml` `report`, `nightly.yml` `report`, `sync-release-version.yml` `sync`, and the `deploy-site.yml` `build` / `deploy` jobs. The deploy-site jobs are privileged through its top-level `pages: write` + `id-token: write` (`deploy-site.yml:24–27`). Adding a `setup-node` cache to the site build therefore trips rule 1, and the failure message names the inherited top-level grant.

The test enforces these rules over every workflow:

0. **Explicit tokens.** Every job's effective permissions are explicit: the workflow has a top-level block, or the job has its own. The seven workflows listed in D2 have a top-level block exactly equal to `{contents: read}`.
1. **No cache in privileged step-jobs.** A release-privileged job with `steps:` SHALL NOT use any step whose `uses` matches `^actions/cache(/|@)` (cache, restore, save). Local composite actions are out of scope; none exist (`.github/actions/` is absent), and the test header says so. None of its steps SHALL carry a non-empty value under a known cache-enabling key: `cache`, `enable-cache`, `bundler-cache`, `cache-from`, `cache-to`. An expression counts as non-empty. The key list is a deny-list, and its limit is stated in the test header.
2. **Callers of `_electron-build.yml`.**
   - A release-privileged caller SHALL pass the boolean `use_dependency_cache: false`, compared as a parsed YAML boolean, not a string.
   - `ci-electron.yml` `build` and `nightly.yml` `electron` SHALL pass the boolean `true`. This positive side keeps the dev-cache path exercised.
3. **Callee `_electron-build.yml`.**
   - Input `use_dependency_cache` exists with `type: boolean` and `default: false`.
   - The cache is gated in one of two accepted forms:
     - the gated expression, compared with whitespace inside `${{ }}` normalised;
     - the D4 fallback pair: complementary `if:`-gated `setup-node` steps, where only the step gated on `inputs.use_dependency_cache` carries `cache`.

     Any other non-empty cache key fails.
   - That gated step is exempt from rule 1 even when the callee job becomes (b), for example when signing secrets land. Rule 2 already forces every secret-passing caller, being (b) itself, to pass `false`, so the expression evaluates to `''`. Without the exemption, rules 1 and 3 would be jointly unsatisfiable once `macos-notarization` lands.
4. **Ships-in-release guard.**
   - In `publish.yml`, a job outside the ships-in-release list SHALL NOT upload an artifact whose `name` starts with `electron-` — the prefix that `github-release`'s `files: electron-*/**/*` glob attaches.
   - A reusable workflow called by such a job (`_smoke.yml`) SHALL NOT upload one either.

   This turns the hand-maintained list (c) into a checked one.

**Alternative rejected:** a regex scan of `cache: pnpm` lines. It misses `actions/cache`, indentation variants and job attribution — the #800 lesson.

### D4 — `_electron-build.yml` cache becomes an input (`use_dependency_cache`, boolean, default `false`)

`setup-node` `cache: ${{ inputs.use_dependency_cache && 'pnpm' || '' }}`. An empty string is setup-node's default "no caching" value (*verify at implementation*).

The default is **fail-closed**, pinned by rule 3. `ci-electron.yml` and `nightly.yml` pass `use_dependency_cache: true` explicitly, and `publish.yml` passes `false` explicitly (rule 2). A future caller that omits the input gets a cold install.

The `cond && 'a' || 'b'` idiom relies on GitHub expressions returning operand values, which GitHub documents as its ternary emulation. Task 0.1 confirms both this and the `''` behaviour on a real runner.

Setup-node behaviour: the cycle-2 reviewer reported that `actions/setup-node@v4` `src/main.ts` gates restore and save on `cache && isCacheFeatureAvailable()`, so `''` disables both. Task 4.1 re-confirms this before any workflow edit. **Fallback** if it does not hold: two `setup-node` steps with complementary `if: inputs.use_dependency_cache` / `if: ${{ !inputs.use_dependency_cache }}`, the second without a `cache` key. Rule 3 then pins both steps' `if:` instead of the expression.

`pnpm-migration-contract.test.ts` X5 asserts `/cache:\s*pnpm/` on `_electron-build.yml`. It is updated to accept the input-gated expression for that file; the intent "uses the pnpm cache" still holds where enabled.

CodeQL cannot evaluate the input, so `_electron-build.yml`'s alerts persist. They are dismissed with the reason: "release caller passes `use_dependency_cache: false`; the default is false; cached callers (ci-electron, nightly) run read-only and produce dev/nightly artifacts attached to no release; pinned by `workflow-token-cache-contract.test.ts`".

**Alternatives rejected:**
- Default `true`: fails open for any new release-path caller.
- A second cache-less copy of the build job: duplicates the single-definition matrix.

### D5 — Keep the cache in `_smoke.yml` and `publish.yml` `ci-checks`

After D2 both run with a read token, and their output is attached to no release: `publish` rebuilds from a cold install.

A poisoned store can make the gate pass or fail wrongly. Passing wrongly lets `publish` proceed on source whose tests would have failed. That is a release-integrity residual: what ships is built cold, but untested.

- On the dispatch path the gate tests the pre-bump commit (`github.sha`). The shipped tag commit is created afterwards by `tag-and-push`: version fields, synced specifiers, regenerated lockfile and changelog only. That commit is never itself gated — a pre-existing property, unchanged here.

Accepted, because release artifacts never execute cached code, and the source is the reviewed commit plus a mechanical bump.

Their alerts are dismissed `won't fix` with a link to this section.

**Alternative rejected:** an input on `_smoke.yml`. It costs warm time on a 7-leg matrix and protects against a gate bypass only.

### D6 — New contract test file

New file: `packages/shared/src/__tests__/workflow-token-cache-contract.test.ts`. It does not extend `publish-workflow-contract.test.ts`, which documents a deliberate line-scanning style.

It parses every `.github/workflows/*.yml` with `yaml` and runs repo-wide. Each failure message names the workflow, the job, the step where applicable, and the violated rule. Rules 0–4 are from D3, and a rule-4 failure also names the ships-in-release list.

## Risks / Trade-offs

- **A job silently needed write and now 403s.** → The D2 grep found no write use.
  - Pre-merge, dispatch `ci-electron.yml` (one leg), `ci-smoke.yml`, `ci-e2e-electron.yml` and `ci-gateway-platform.yml`. This exercises `_electron-build.yml` and `_smoke.yml` under a read token, with the same callee code the release uses.
  - `resolve` and `ci-checks` run before `publish`, so a 403 there leaves no partial release.
- **Release jobs still regenerate the lockfile.** `tag-and-push` (`publish.yml:178`) and `_electron-build.yml:220` run `pnpm install --lockfile-only`. That resolves metadata only and imports nothing from the store, so it is not a poisoning vector. The rule is "no cache restore", not "frozen install everywhere".
- **The cold-install release path is first fully exercised at the next release.** It cannot be rehearsed: `publish.yml` dispatch pushes a tag and publishes.
  - The cold `pnpm install --frozen-lockfile` path already runs on every cache miss in `ci.yml`.
  - If `electron`, `runtime-asset` or `github-release` fails after npm publish, recover per the `release-revoke` skill, or re-run failed jobs once fixed. The npm packages are already valid; only the release assets are missing.
- **Cold installs lengthen release runs** by a few minutes per job and leg (estimate, unmeasured). → Accepted; releases are infrequent.
- **The ships-in-release list goes stale.** → The test failure message and the `ci-troubleshoot` triage procedure name the list. A new release asset already requires touching `github-release`.
- **Residual: cached unprivileged jobs can be fed a poisoned store** and produce a wrong gate result or a poisoned dev/nightly artifact. → Accepted per D5. Release artifacts come only from cold-installed jobs.
- **The signing changes interact with rules 2–3.** A caller that passes signing secrets (or OIDC `id-token: write`) is release-privileged and must pass `use_dependency_cache: false`. A cached `ci-electron.yml` therefore cannot also receive signing secrets; it signs nothing, or it goes cold. The signing changes inherit these constraints:
  - Signing secrets on `_electron-build.yml` must be non-`required`. Required secrets would force the dev callers to pass them, making them (b) — and the rule 2 `true`/`false` pair then fails the test, loudly.
  - A callee job requesting `id-token: write` needs the caller job to grant it. A called workflow cannot exceed the caller's grant (*unverified, GitHub docs*).
  - Callee `secrets.*` reads need an explicit caller `secrets:` mapping, or they read empty and the `CSC_LINK != ''` gate silently skips signing. That is the signing changes' concern, noted for them.
- **Out of scope: `persist-credentials` on privileged checkouts.** `publish` runs dependency lifecycle scripts with a persisted `contents: write` token. That is a non-cache hardening, recorded as a follow-up.
- **The deny-list of cache keys is incomplete by construction.** → It is stated in the test header; new cache-capable actions are added when adopted.

## Migration Plan

1. Land the workflow edits, the X5 update and the new contract test in one commit.
2. Dispatch the four non-release workflows on the branch (see Risks), and confirm no 403 and that `ci-electron` and `nightly` legs still restore the cache.
3. After merge, wait for CodeQL to re-scan `develop`. Confirm that all 15 `missing-workflow-permissions` alerts close, and that the `poisonable-step` alerts still open are exactly the D4/D5 set: `_smoke.yml` ×4, `ci-checks` ×4, `_electron-build.yml` ×10. Do not dismiss on a mismatch; return here.
4. Dismiss the remaining cache-poisoning alerts per the `ci-troubleshoot` procedure. Trial the `gh api` dismissal command on one alert first.

**Rollback:** revert the commit, which restores the cache and the old token scope. Then **re-open every alert dismissed under this change**. The `ci-troubleshoot` procedure records the dismissed alert numbers in the PR description at dismissal time. Otherwise the reintroduced poisonable steps stay alert-suppressed, with no contract test left to catch them.
