## Context

- `scripts/nightly-verdaccio-publish.mjs` main(): (a) `npm pkg set version=… --workspaces --include-workspace-root` (`:183-189`), (b) `node scripts/sync-versions.js` (`:191`), (c) `npm install --package-lock-only --no-audit --no-fund` (`:193`), (d) `node scripts/verify-lockfile-versions.mjs` (`:195`), (e) publish loop (`:197+`). Header comment repeats the steps (`:11-21`) and says the script runs inside `_electron-build.yml` (`:6`).
- The repo root has no `package-lock.json`; its lockfile is `pnpm-lock.yaml` since `adopt-pnpm-for-dev-ci` (commit c80a1ca61, 2026-07-21). The nightly script landed the same day (e108f6344, #375) and its step (c) was never ported.
- `verify-lockfile-versions.mjs` reads `pnpm-lock.yaml` (`:26`), parses its `importers:` block (`:68-74`) and fails unless every workspace cross-ref specifier is `^<root version>`.
- Callers:
  - `_electron-build.yml` nightly legs: `npm pkg set` (`:247`), `sync-versions.js` (`:259`), `pnpm install --lockfile-only` (`:261-263`), `verify-lockfile-versions.mjs` (`:265-267`), later `nightly-verdaccio-publish.mjs` (`:331-335`). The script's own (a)/(b) are no-ops there (same version) and (d) passes on the lockfile the workflow already regenerated. Last green nightly run: 2026-10-21.
  - `schedule-release-rehearsal`'s planned `verify-publish` job (its design D8, step 5) calls the script with no regeneration pre-step. The spike run 45135895853 (2026-11-23) failed at (d): every cross-ref still `^0.11.0`, expected `^0.11.1-nightly.20261123.bacb6fe`. npm printed "up to date" at (c).
- Windows spawn: `bin()` maps `npm` → `npm.cmd` and `run()` passes `shell: isWin && cmd === "npm"` (`:153-158`); `node` spawns directly. The existing test "the publish script spawns npm through npm.cmd + a shell on win32" pins that (`scripts/__tests__/nightly-verdaccio-publish.test.mjs:184`).
- Spec `monorepo-workspace-structure` "Package-manager role split": pnpm SHALL be the package manager for all CI tasks; npm survives only for `npm publish --provenance` in the release workflow, end-user runtime installs, and assembling the npm-layout runtime tree (`bundle-server.mjs`, runtime-lock generation). Step (c) is none of these. This change removes that npm-in-CI call. The script's other npm uses that the list also does not name (step (a) `npm pkg set`, the loopback `npm publish --no-provenance`) are out of scope.
- The only current caller is `_electron-build.yml:335`; it sets pnpm up with `pnpm/action-setup@v4` at `:174` (all legs incl. Windows). No `nightly.yml` job runs the script today. The planned standalone caller, `schedule-release-rehearsal`'s `verify-publish` job, sets pnpm up (its design D8 step 1, and `nightly.yml:86` today).
- `generate-runtime-lock.mjs`, which the script runs before publishing the server (`:229`), runs its own `npm install --package-lock-only` in a temp dir (`generate-runtime-lock.mjs:122`). That call is a permitted npm survivor (runtime-lock generation) and is not touched.

## Goals / Non-Goals

Goals:
- The script regenerates the lockfile that its own gate reads, so it works standalone.
- Same command as the release (`publish.yml:185`) and the electron legs (`_electron-build.yml:263`).

Non-Goals:
- No change to `nightly.yml`, `_electron-build.yml`, `publish.yml` or `verify-lockfile-versions.mjs`.
- Not the `xlsx` remote-tarball problem under npm 12 defaults (`fix-npm12-remote-tarball-install`). pnpm does not read npm's `allow-remote` setting, so step (c) no longer needs `--allow-remote=all`.
- Not re-planning `schedule-release-rehearsal`; this change only records the dependency.

## Decisions

### D1. Step (c) runs `pnpm install --lockfile-only`

Replace the npm call with `run("pnpm", ["install", "--lockfile-only"])`. No extra flags: `publish.yml:185` and `_electron-build.yml:263` pass none. In the electron legs the call is a no-op (the lockfile already matches). Alternative rejected: keep npm and add `--allow-remote=all` (schedule-release-rehearsal task 3.1). It still writes a `package-lock.json` the gate never reads, so step (d) keeps failing standalone.

### D2. Windows spawns `pnpm` through a shell

`pnpm/action-setup` installs pnpm through a shim that is likely not a native executable on Windows (`unverified`; no Windows runner was checked), so `execFileSync("pnpm")` fails with `spawnSync pnpm ENOENT` without a shell (same failure class as npm, comment at `:153-154`). `run()` passes `shell: isWin` for `pnpm` as it does for `npm`. `bin()` keeps mapping only `npm` → `npm.cmd`: with a shell, `pnpm` resolves through PATHEXT whether the shim is `pnpm.cmd` or `pnpm.exe`. Step (c)'s arguments are constant strings, so the shell adds no injection surface there. `shell: true` with an args array triggers Node's DEP0190 deprecation warning, as it already does for `npm`; accepted. Any future `pnpm` call through `run()` must keep its arguments constant or pre-validated, as step (a) does for the version (`NIGHTLY_VERSION_RE` check at `:178` before the shelled `npm pkg set`).

### D3. Pin the command in the unit test

Extend `nightly-verdaccio-publish.test.mjs` "nightly infra contracts" (static source assertions, as `:184-188`), with whitespace-tolerant regexes so a reformat does not break them: the main() source runs `pnpm` with `install` and `--lockfile-only`; that call sits after the `sync-versions.js` call and before the `verify-lockfile-versions.mjs` call; the source contains no `--package-lock-only`; the win32 shell condition covers `pnpm`. The behavioural scenarios (standalone run passes step (d), the electron legs, Windows) need a real run; `scenario-design` routes them in `test-plan.md` and the fold adds their tasks.

## Risks / Trade-offs

- Nightly electron legs stop writing a root `package-lock.json` at step (c) (gitignored, `.gitignore:68`). Electron Forge's package-manager detection (`@electron-forge/core-utils` `findUp` on `package-lock.json` before `pnpm-lock.yaml`) then sees pnpm there, as it already does in the non-nightly electron legs, which never ran step (c). Whether npm wrote that file on the runners is `unverified`; either way the nightly legs end up like the non-nightly ones.
- Drift masking: on a checkout whose `pnpm-lock.yaml` disagrees with its `package.json` files beyond the cross-refs, step (c) re-resolves those entries too and the gate still passes. Callers install with `--frozen-lockfile` first, which fails on such a checkout before the script runs.
- New hard requirement: `pnpm` on PATH. Without it step (c) fails (`spawnSync pnpm ENOENT` off Windows; a cmd.exe "not recognized" error with a non-zero exit on Windows, where it runs through a shell) and the script exits non-zero before publishing anything (fail-closed). Every caller sets pnpm up.
- `pnpm install --lockfile-only` re-resolves any specifier that no longer matches the lockfile, not only workspace cross-refs. The checkout is consistent before the bump because every CI install uses `--frozen-lockfile`, so only the cross-refs that steps (a)/(b) rewrote change.

- pnpm resolves the workspace from `pnpm-workspace.yaml`; a run outside the repo root would fail. The script already runs every command with `cwd: repoRoot` (`:158`).
- `pnpm install --lockfile-only` may contact the registry to resolve changed specifiers. The changed specifiers are workspace cross-refs, which pnpm links locally; the same call already runs in `publish.yml` and the electron legs. Network use is unchanged in kind.

## Migration / Rollback

- No data or config migration. Rollback is reverting this change's commit: the step (c) command, the `run()` shell condition and comment, the header comment and the new test cases go together.
- `schedule-release-rehearsal` must re-plan everything that assumes an npm step (c) before it resumes: tasks 3.1, 6.63, 6.81, the step (c) part of spike 1.1 and the D8 text. Its `blocked_by` entry makes ship-it's entry dependency gate hold it until this change is archived; it does not stop someone from applying those tasks by hand.

## Open Questions

None.
