# Proposal

## Why

`scripts/nightly-verdaccio-publish.mjs` regenerates the lockfile with npm (step (c), `npm install --package-lock-only`, `:193`). Since `adopt-pnpm-for-dev-ci` the repo root has no `package-lock.json`, only `pnpm-lock.yaml`, so that step never touches the lockfile that the next step, `verify-lockfile-versions.mjs`, reads. The script passes today only because its one caller, `_electron-build.yml`, regenerates `pnpm-lock.yaml` itself before calling it (`:261-263`). Run standalone, it fails at step (d) with a drift report on every workspace cross-ref. That is what the `schedule-release-rehearsal` spike hit (run 45135895853): its new `verify-publish` job calls the script with no earlier regeneration. The spike attributed the failure to npm 12. The drift has a different cause: the leftover npm call writes a lockfile nobody reads. Under npm 12 defaults the same call would instead stop earlier with `EALLOWREMOTE` (the `xlsx` remote tarball, `packages/server/package.json:113`; see `fix-npm12-remote-tarball-install`), which is why the spike added `--allow-remote=all`; either way step (c) never updates `pnpm-lock.yaml`.

## What Changes

- Step (c) of `nightly-verdaccio-publish.mjs` runs `pnpm install --lockfile-only`, the command the release already runs (`publish.yml:185`) and `_electron-build.yml:263` runs. The npm call goes away.
- On Windows, `pnpm` is spawned through a shell (resolved via PATHEXT), as `npm` already is (`:153-158`).
- The script header comment and its `AGENTS.md` row name the pnpm command.
- A unit test pins step (c) to the pnpm command, its position between steps (b) and (d), and fails if `npm install --package-lock-only` returns to the script.
- `schedule-release-rehearsal` gains a `blocked_by` entry on this change. Its tasks that assume an npm step (c) lose their target once this lands: 3.1 (add `--allow-remote=all`), 6.63 (a test pinning that flag, which would contradict this change's test), 6.81 (the `allow-remote-probe` matrix) and the step (c) part of spike 1.1, plus the matching D8 text. That change re-plans them before it resumes (not done here); ship-it's dependency gate holds it at entry until this change is archived.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `nightly-verification`: ADDED requirement that the nightly publish script regenerates `pnpm-lock.yaml` with pnpm before its lockfile gate, so it works without a caller pre-step.

## Impact

- Code: `scripts/nightly-verdaccio-publish.mjs` (step (c), the Windows spawn helper, the header comment).
- Tests: `scripts/__tests__/nightly-verdaccio-publish.test.mjs`.
- Docs: `scripts/nightly-verdaccio-publish.mjs.AGENTS.md`, `scripts/__tests__/nightly-verdaccio-publish.test.mjs.AGENTS.md`, `.pi/skills/ci-troubleshoot/references/common-failures.md` (its lockfile-drift recipe still uses npm).
- CI: `_electron-build.yml` nightly legs keep working; their pre-step makes the script's regeneration a no-op. `nightly.yml` is not edited.
- Planning: `openspec/changes/schedule-release-rehearsal/dependencies.yaml` (new `blocked_by` entry, committed with this change's planning artifacts).
- No runtime, server, client or published-package behaviour changes.
- The script now needs `pnpm` on PATH (it already needed `npm` and `node`). Its one caller sets pnpm up (`_electron-build.yml:174`).

## Discipline Skills

None apply: a CI-script command swap with no auth, untrusted input, latency budget, endpoint or irreversible step.
