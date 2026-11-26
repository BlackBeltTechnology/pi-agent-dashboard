# Proposal

## Why

The Windows `runtime-asset` leg of `publish.yml` failed in real releases (`tar -czf` failure, `EXDEV: cross-device link not permitted`; v0.11.0 needed nine publish attempts). That job runs only at release time, so its failures surface on the tag. `schedule-release-rehearsal` schedules the `nightly.yml` rehearsal but leaves the runtime-asset matrix out: the mechanism has never run, and three review cycles could not settle it on paper. This change adds the runtime-asset matrix to the nightly rehearsal once a spike has shown that it works.

This change was split out of `schedule-release-rehearsal` (owner decision B2, split clause). It is a proposal-only draft.

## What Changes

Intended scope, to be designed after the spike (see Planning status):

- Add a `runtime-asset` job to `.github/workflows/nightly.yml`. Its matrix copies the five flow-style lines of the release `runtime-asset` matrix (`publish.yml:609-613`: macos-14 arm64, macos-15-intel x64, ubuntu-latest x64, ubuntu-24.04-arm arm64, windows-latest x64) and is pinned to `RUNTIME_ASSET_TARGETS` (`scripts/lib/runtime-release.mjs:42-48`) next to the existing publish pin (`scripts/__tests__/runtime-release.test.mjs:70-75`), plus an equal-`os` check per `{platform, arch}` against `publish.yml`.
- Each leg checks out `github.sha`, installs and builds, starts its own loopback Verdaccio (`npm install -g verdaccio@6.11.1`, `node scripts/nightly-verdaccio-serve.mjs`), publishes the nightly version to it (`node scripts/nightly-verdaccio-publish.mjs`, `REGISTRY=http://localhost:4873`), then runs `node --import tsx scripts/build-runtime-asset.mjs --version <nightly> --out dist-runtime` with `npm_config_registry=http://localhost:4873`. No upload, no `shell:` key, no `continue-on-error`, no npm upgrade (the release `runtime-asset` job keeps the runner's npm, `publish.yml:600-640`).
- Intended requirement (draft, for the later spec delta in `nightly-verification`): `nightly.yml` builds the per-platform runtime asset with the release build script on every target of the release asset matrix; each leg resolves the server package and its runtime lock from its own loopback Verdaccio, never from the public registry; a leg fails, and is never skipped or `continue-on-error`, when the asset cannot be built. Draft scenarios: matrix matches the release; Windows leg runs the archive path; Windows leg uses no bash; asset resolves only from loopback; rehearsal asset is never shipped (no `upload-artifact`, no artifact name starting with `electron-runtime-`, the release asset prefix at `publish-workflow-contract.test.ts:757-762`).

Facts carried over from the `schedule-release-rehearsal` design (re-verify when planning):
- A per-leg republish is required. Every hosted job runs on its own VM, so `localhost:4873` in one job is not reachable from another, and GitHub service containers run only on Linux runners. The archived `add-nightly-verdaccio-build` design chose per-leg isolation (design.md:95).
- The job must not depend on `verify-publish`: `schedule-release-rehearsal` pins "no job other than `report` lists `verify-publish` in `needs`", so an `npm@latest` failure cannot skip other legs (its design D3, cycle-3 review finding).
- The job must be added to `report.needs`: `schedule-release-rehearsal` pins that `report.needs` lists every other job.
- `scripts/build-runtime-asset.mjs` takes `--version`, `--out` and an optional `--lock FILE` (`:6`, `:227-232`). Without `--lock` it runs `npm pack <server>@<version>` through the ambient npm config (`:150-157`). It imports `stageRuntime` (`runtime-stager.ts`), which requires `semver.valid(version) === version` (`:250-251`), runs `lockstepCheck` (`:277`, fails when any installed `@blackbelt-technology/*` package has another version, `:91-113`) and materialises first-party plugins (`:281`). The Windows paths are the GNU tar choice (`build-runtime-asset.mjs:42-53`), the `EXDEV` copy fallback (`:119-130`) and tar retries (`:191-200`). The script writes the asset name, size and sha512 to the step summary (`:236-238`).
- Loopback proof without new logging: the nightly version exists only in the leg's Verdaccio (the publish script refuses a non-loopback `REGISTRY`, `nightly-verdaccio-publish.mjs:147-151`; Verdaccio has no uplink for `@blackbelt-technology/*`, `.github/verdaccio/config.yml:33-37`), so `npm pack …server@<nightly>` succeeds only there, and `lockstepCheck` fails on any first-party package from elsewhere.
- Fidelity gaps against the release job: the release checks out a clean tag and installs with `--ignore-scripts` and no cache (`publish.yml:617-630`); the rehearsal leg must build and publish first, so it installs fully, with `cache: pnpm`, on a tree that `nightly-verdaccio-publish.mjs:183-195` has just mutated. The rehearsal lock resolves from Verdaccio URLs, not npmjs URLs. The tar, `EXDEV`, `.bin`-prune, hardlink and stager code is the same, on the same runner images. (Open owner question for this change's planning pass: add a clean `--ignore-scripts` reinstall before the asset build, or accept the gap.)
- `no-bash-on-windows.test.ts` selects a job only from block-style `- os:`/`platform:` lines or a literal `runs-on: windows-*` (`:92-111`, `:268-272`), so it skips flow-style matrices, including the release `runtime-asset` job today. Pin "no `shell: bash`" on the job block directly, or extend the lint (open owner question for this change's planning pass).
- Timeouts: release `runtime-asset` has `timeout-minutes: 45` (`publish.yml:615`); the nightly leg needs about 45 + 4-9 min of republish, so 60. Without a job timeout a hung leg burns up to 6 h.
- Cost estimate (`unverified`): 4-9 min republish (measured on electron legs, run 39560713514) plus 1.5-15.3 min asset build (v0.11.0; Windows 13.6-15.3), so about 6-24 min per leg and 30-120 runner-minutes for 5 legs, 2 of them macOS.
- CodeQL: `codeql-baseline.json` carries `actions/cache-poisoning/poisonable-step` entries for the Verdaccio steps of `_electron-build.yml`. A new job with `cache: pnpm` and `npm install -g verdaccio@6.11.1` in `nightly.yml` repeats that pattern and may raise new alerts that stop a headless ship-it at step 4.4b (`unverified`).
- Rollback must remove the job together with its pins (matrix pin, "no bash" pin, `report.needs` entry); a job deletion alone breaks them.
- The nightly slug is required: the publish script refuses any other version (`nightly-verdaccio-publish.mjs:64-65`, `:178-180`).

Alternatives already considered (carry into the design):
- Add a `build-runtime-asset` step to the `_electron-build.yml` legs. Rejected: an earlier electron-step failure hides the asset result; the callee is shared with `publish.yml`, `ci-electron.yml` and `ci-gateway-platform.yml`; its 6 legs include win32-arm64, which the release asset matrix does not have.
- Extract `_runtime-asset.yml` with a `registry_url` input, called by both `publish.yml` and `nightly.yml`. One definition, no drift. Not chosen so far because it edits the release job and its pins (`publish-workflow-contract.test.ts:757-762`) and the token-cache rule 4 scans reusable workflows that `publish.yml` calls (`workflow-token-cache-contract.test.ts:25-27`). Reconsider when planning.
- `--lock FILE` with a lock from `nightly-verdaccio-publish.mjs` (`:229`), still against the leg's Verdaccio: fallback if `npm pack` from Verdaccio fails.
- `--lock FILE` with no Verdaccio. Rejected: `npm ci` inside the stager still needs the first-party tarballs from a registry.

## Capabilities

### New Capabilities

None expected.

### Modified Capabilities

- `nightly-verification` (expected): an ADDED requirement for the `runtime-asset` job in `nightly.yml`. Not written yet; the spec delta follows the spike (Planning status).

## Planning status

Blocked. A spike must be RUN, and pass, before this change gets a design.md, spec deltas or tasks.md. `schedule-release-rehearsal` must have shipped first (the spike branch builds on its `nightly.yml`).

Spike design. On a throwaway branch of `develop`: in `.github/workflows/nightly.yml` delete the `electron`, `knip`, `install-load`, `smoke` and `report` jobs (so no `nightly` issue changes and the Electron matrix does not run), keep no `concurrency` block, and add the `runtime-asset` job as described in What Changes with all five legs. Push it and dispatch it with `gh workflow run nightly.yml --ref <branch>`.

Observable pass criterion, all of:
1. Each of the five `runtime-asset` legs is green.
2. Each leg's build step logs `[verify] lockstep`, `[materialize] first-party plugins` and `<asset> (<n> MiB) sha512=…` (`scripts/build-runtime-asset.mjs:183`, `:235`), and its step summary names `pi-dashboard-runtime-<nightly>-<platform>-<arch>.tgz` (`:236-238`).
3. Afterwards `npm view @blackbelt-technology/pi-dashboard-server@<nightly> version --registry https://registry.npmjs.org` fails with `E404`.

Record the run id and the per-leg durations. Open points the spike answers: `semver.valid` on the nightly slug (`runtime-stager.ts:250-251`); `lockstepCheck` and plugin materialisation against Verdaccio-published packages (`:277-281`); the Windows leg's tar and `EXDEV` paths against a Verdaccio-staged tree.

If the spike fails, the owner chooses: fix the blocker (stager, slug or publish script) in a separate change and retry; build with `--lock <file>` from the lock that `nightly-verdaccio-publish.mjs` generates (`:229`), still against the leg's Verdaccio; or drop the runtime-asset rehearsal and keep the class in the residual table of `docs/release-process.md`.

## Non-Goals

- No edit to the release `runtime-asset` job in `publish.yml` (unless the design chooses the `_runtime-asset.yml` extraction, which needs the owner).
- No upload or release of the rehearsal asset.
- No `npm@latest` in the runtime-asset legs: the release `runtime-asset` job keeps the runner's npm.
- No change to `_electron-build.yml`.
- No design, spec delta or task before the spike has passed.

## Discipline Skills

- `security-hardening`: a new scheduled job that installs global packages after a dependency cache restore (CodeQL `actions/cache-poisoning` pattern), and keeping the zero-public-write contract for it.
- `doubt-driven-review`: the job claims to rehearse a release path; the fidelity gaps must be stated, not implied.
- `observability-instrumentation`: the job's legs must appear by name in the `nightly` report.

## Impact

- Later: `.github/workflows/nightly.yml` (new `runtime-asset` job, `report.needs`), `scripts/__tests__/runtime-release.test.mjs` and `packages/shared/src/__tests__/nightly-workflow-contract.test.ts` (pins), `nightly-verification` spec (ADDED requirement), `docs/release-process.md` and `.pi/skills/ci-troubleshoot/references/release-pipeline.md` (the Windows `tar`/`EXDEV` class moves from "not covered" to covered).
- Now: none. This draft changes no file outside its own directory.
- Depends on `schedule-release-rehearsal` (`dependencies.yaml`).
