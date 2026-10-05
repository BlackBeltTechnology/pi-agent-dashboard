## Why

Follow-ups from shipped changes were deliberately left out of the change that found them and have sat as issues since August. Most are truth corrections (a docstring, source-of-truth specs the doctor skill and future changes consult, a workflow trigger whose docstring misdescribes when it fires) and one is a fail-open guard: the macOS upstream-floor tripwire passes with a `::warning::` when `minos` cannot be extracted at all, which is exactly the silent-disable shape `upgrade-electron-runtime` removed elsewhere (#533, flagged independently by the local review and CodeRabbit).

## What Changes

- **macOS floor canary (#533).** `verify-macos-floor.mjs` keeps the tolerant `::warning::` path for a genuinely novel Mach-O shape on the *produced* binary, but the build SHALL first assert that the extractor yields a **numeric** `minos` major for the installed Electron prebuilt. If the extractor is blind — or returns something unusable — on the binary we KNOW carries `LC_BUILD_VERSION`, the job fails with a message naming the extractor and the sample. Asserting merely "≥1 value returned" would not close the hole: `checkMinosFloor`'s `non-numeric` status also maps to `::warning::` + `exit 0`, so a canary that accepts `["n/a"]` leaves the tripwire just as dead.

  The prebuilt is **not present on the macOS legs today.** `electron@43.4.1` declares no `scripts` field at all — `install.js` (which populates `<electron-dir>/dist`) is exposed as `bin.install-electron`, not a lifecycle hook — so no install ever downloads it, and `pnpm-workspace.yaml`'s `ignoredBuiltDependencies: [electron]` entry is inert for it. `_electron-build.yml` runs `node install.js` explicitly on the `linux/arm64` leg only; electron-forge packages darwin from the `@electron/get` cache (`~/Library/Caches/electron`), never from `node_modules`. The macOS legs therefore gain the same explicit `node install.js` step, resolved through `packages/shared/bin/pi-dashboard-resolve-tool.cjs electron` (the sanctioned resolver — hoisted-vs-nested layout is absorbed in one place). Cost: one prebuilt download per macOS leg.

- **Floor check cannot be skipped on the lookup axis (#533).** `_electron-build.yml`'s main-binary lookup currently emits `::warning::Main binary not found — skipping otool check` and passes, which skips the script *and* the new canary. That branch becomes `::error::` + `exit 1`: a mounted DMG with no inner Mach-O is a broken build, not a tolerable shape.

- **`spa404Fallback` docstring (#577).** `packages/shell/vite.config.ts` says Pages serves the shell for any unknown path; on the `/app/` subpath Pages serves the repository-root `404.html` from `site/`. Comment corrected; behaviour is inert under hash routing.

- **Spec corrections (#578).** Five stale requirements, all text-only:
  - `ci-cd-pipeline` "CI workflow on push and PR" asserts `npm ci` → `npm run lint` → `npm test` → `npm run build`; `ci.yml` has been the pnpm sequence since the pnpm adoption.
  - `ci-cd-pipeline` "Release-gate runs lint+test+build and smoke before publish" describes `ci-checks` as `npm ci && npm run lint && …`; `publish.yml:109-112` runs the pnpm sequence with `pnpm/action-setup@v4` and `cache: pnpm`.
  - `ci-cd-pipeline` "Repo-lint pins the release-gate contract" clause 2 asserts the test pins `ci-checks` running `npm run lint`/`npm test`/`npm run build` — the same staleness one paragraph down; leaving it would make the capability self-contradictory.
  - `ci-cd-pipeline` "Release lockfile MUST mirror workspace versions" names `package-lock.json` and `npm install --package-lock-only`; the job regenerates `pnpm-lock.yaml` via `pnpm install --lockfile-only` (the `release-cut` skill and `scripts/sync-versions.js` already say pnpm — only the spec lags).
  - `marketing-site` "Public marketing site source" says Astro + Tailwind + MDX; the site is a hand-written static page built by `node site/build.mjs` with zero dependencies since `c52745af0`. Its token scenario also still asserts `pi-*` Tailwind colours resolving through `rgb(var(--pi-xxx) / <alpha-value>)` with a `:root.dark` selector — the tree has **zero** `--pi-*` variables and no `rgb(var(` anywhere in `site/`: tokens are `--bg-primary`/`--text-secondary`/`--accent*`/`--status-*` lifted verbatim from `packages/client/src/index.css`, and light mode is `[data-theme="light"]`, not `:root.dark`. Re-stated against the real tokens (the scenario *title* is preserved — renaming it makes `openspec archive` refuse the sync).

  Still stale, **out of scope** (noted, not fixed): `ci-cd-pipeline` "Build tools referenced by workflows MUST be declared dependencies" says "so that `npm ci` resolves it" (line ~208). The requirement's substance is package-manager-agnostic; only the verb is stale.

- **Dead `release:` trigger (#580).** `sync-release-version.yml` declares `release: [published, edited]` and its docstring calls it "the normal path". That is wrong in both directions: pipeline releases are created by `publish.yml` under the default Actions token, whose events never start a workflow — but `publish.yml:665` sets `draft: <is_prerelease>`, so **every prerelease is published by a human**, and a human-actor `release: published` event *does* start a run. The trigger is not dead; it is live on exactly the path the docstring calls exceptional, and dead on the path it calls normal.

  The trigger is removed anyway, because the run it starts is incomplete: `sync-release-version` commits with `GITHUB_TOKEN`, whose push cannot trigger `deploy-site.yml` — which is why `publish.yml` dispatches `sync-release-version` and then `deploy-site` as two separate steps (`publish.yml:697`, `:734`). A trigger that half-does the job is worse than no trigger. `workflow_dispatch` stays, and the docstring states the full manual recovery: dispatch `sync-release-version`, then dispatch `deploy-site`. The site-deploy contract test gains the assertion that the trigger does not return — in a `describe` that names `sync-release-version.yml` and with a message that names it, since the existing E10 block names only `deploy-site.yml`.

Out of scope: #579 (path-filter investigation — no evidence to act on).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `electron-build-pipeline`: "macOS deployment target is pinned" — the unextractable-`minos` clause becomes canary-guarded, the canary's sample is made to exist on the macOS legs, the binary-lookup miss becomes a failure, and the "three independent points" count becomes four.
- `ci-cd-pipeline`: "CI workflow on push and PR", "Release-gate runs lint+test+build and smoke before publish", "Repo-lint pins the release-gate contract", "Release lockfile MUST mirror workspace versions" — pnpm commands and `pnpm-lock.yaml`.
- `marketing-site`: "Public marketing site source" — static build, no framework, real token names; `sync-release-version` has no `release:` trigger and its manual recovery is two dispatches.

## Impact

- `packages/electron/scripts/macos-floor.mjs` — new pure canary predicate beside `extractMinosValues`/`checkMinosFloor`.
- `packages/electron/scripts/verify-macos-floor.mjs` — runs the canary (owns the `otool` exec) before the produced-binary check.
- `packages/electron/src/__tests__/macos-floor-check.test.ts` — canary verdicts, fixture-driven.
- `.github/workflows/_electron-build.yml` — new `node install.js` step on darwin legs, binary-lookup branch hardened, step comment.
- `packages/shared/src/__tests__/no-hardcoded-node-modules-paths.test.ts` — `SCAN_FILES` gains `_electron-build.yml` so the new resolver call cannot be hand-rolled back into a literal path.
- `packages/shell/vite.config.ts` (comment only).
- `openspec/specs/ci-cd-pipeline/spec.md`, `openspec/specs/marketing-site/spec.md`, `openspec/specs/electron-build-pipeline/spec.md` (via archive sync).
- `.github/workflows/sync-release-version.yml`, `packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts`, `.github/workflows/AGENTS.md` (ci.yml row still says `npm ci`), `packages/electron/AGENTS.md` (the `scripts/*` rows live here — there is no `packages/electron/scripts/AGENTS.md`).

## Discipline Skills

- `doubt-driven-review` — two cycles run during planning, single-model plus cross-model. Cycle 1 caught that the canary's sample path does not exist on the macOS legs, that the `marketing-site` token scenario was being "corrected" into a second falsehood, that the post-sync grep gate was unsatisfiable, and that the `release:` trigger is live for prereleases. Cycle 2 corrected the *mechanism* of the missing prebuilt (no `scripts` field, not a suppressed postinstall), showed a `≥1 value` canary still dies on `non-numeric`, and found the test-seam, `SCAN_FILES`, AGENTS.md-path and E10-naming gaps. All folded in.
- `review-code` — before commit. No untrusted input, endpoint, or latency budget.
