# Proposal

## Why

`switch-source.ts local kb-extension` (the `switch-extension-source` skill) left the project overlay in `.pi/settings.json` as `{"source": "..", "extensions": []}`. pi 1.5.0 resolves project packages before global ones and keeps the first entry per extension file path. An empty `extensions` filter therefore disables the repo root's only manifest extension, `packages/extension/src/bridge.ts`. The global `<repo>/packages/extension` entry points at the same file, so its enabled copy is ignored. The result: every session started in this repo ran without the dashboard bridge. Seven spawns in a row failed with `REGISTER_TIMEOUT` (`~/.pi/dashboard/sessions/spawn-failures.log`, 2026-11-17 09:53–10:13Z) until the entry was removed by hand.

The same investigation found two more problems:
- `--overlay` never worked for any package except the bridge. A `+path` filter can only re-enable files that are already in the root manifest.
- `--overlay` writes an absolute `source`, which breaks the portability rule from #371 / #550.

No CI check catches an empty filter today.

## What Changes

- `purge()` in `.pi/skills/switch-extension-source/scripts/switch-source.ts` never leaves a non-delta project `packages[]` entry with `extensions: []`. Such an entry is removed when it has no other filter keys; otherwise only its `extensions` key goes. This applies to entries the switch touched and to the repo-root entry, and it also repairs a leftover from an earlier run. Other packages' deliberate empty filters are left alone. One deliberate difference from the original request: an entry that still has a non-empty `skills/prompts/themes` filter keeps that filter and loses only `extensions`. `packages` is removed whenever it ends up empty. The idea is the same as the prune in `packages/server/src/pi/resource-activation-toggle.ts`.
- **BREAKING (dev tooling only):** remove the `local --overlay` mode and `ensureProjectOverlay`. `local` always writes the global dir-path form. Passing `--overlay` exits non-zero with a message pointing to plain `local`.
- `npm` and `local` keep cleaning up old overlay entries: `purge()` still strips any `+packages/<dir>/…` path and then prunes.
- Fix a crash: a switch no longer writes, or tries to back up, a project settings file that does not exist.
- Make the script testable: export `purge`, `detect` and `cmdSwitch` (with injectable paths), and only run the command when the script is executed directly. This is the same pattern as `scripts/check-pi-settings-paths.mjs`.
- Extend `scripts/check-pi-settings-paths.mjs`: CI fails when a committed `.pi/settings.json` `packages[]` object entry has an empty `extensions`, `skills`, `prompts` or `themes` array and lacks `autoload: false`.
- Docs:
  - `SKILL.md` and `switch-source.ts.AGENTS.md` drop the overlay mode and explain the shadowing rule.
  - `docs/faq.md` gets a `REGISTER_TIMEOUT` entry naming this cause (written by DocScribe).
- Out of scope:
  - The hand-edited `.pi/settings.json` (the maintainer commits it separately).
  - GitHub issues and pushes.
  - The addons global all-empty disable (`packages/server/src/addons/settings-entries.ts:56`). It is deliberate and global-only.

Related: #371 and PR #550 (same file and filter mechanism). #1127 and #1128 have the same symptom from different causes.

## Capabilities

### New Capabilities
- `extension-source-switching`: how the dev skill moves a monorepo package between its npm and local working-tree sources across global and project pi settings. Covers exactly one source per package, pruning of emptied project entries, which modes are supported, and the repo check (`scripts/check-pi-settings-paths.mjs`) that rejects a committed empty resource filter.

### Modified Capabilities
(none)

## Impact

- Code:
  - `.pi/skills/switch-extension-source/scripts/switch-source.ts`
  - `scripts/check-pi-settings-paths.mjs`
- Tests:
  - New vitest project `.pi/skills/switch-extension-source` (registered in the root `vitest.config.ts`).
  - Extended `scripts/__tests__/check-pi-settings-paths.test.mjs`.
- Docs:
  - `.pi/skills/switch-extension-source/SKILL.md`, `*.AGENTS.md`, `docs/faq.md`.
- CI: `ci.yml` already runs the guard, so no workflow change.
- Runtime: none for distribution users. Only the dev skill and the repo's CI guard change.

## Discipline Skills

- `systematic-debugging`: the root cause was traced to pi's `applyPackageFilter` / `addResource` first-wins rule before any change was made. Tasks must keep the regression test that reproduces the shadowing entry.
- `doubt-driven-review`: ran on proposal and design during planning (3 cycles, fresh-context plus cross-model `@propose-review-1`). It removes a CLI mode and changes a CI gate.
- `review-code`: run before commit. The change touches a CI gate and removes a CLI mode.
- No `security-hardening`, `performance-optimization` or `observability-instrumentation` trigger: no auth, untrusted input, latency budget or new endpoint is involved.
