## Why

The published `@blackbelt-technology/pi-agent-dashboard@0.8.0` tarball ships `packages/{server,shared,extension}/tsconfig.json`. All three `extends: "../../tsconfig.base.json"`. The root `package.json` `files` list does not include `tsconfig.base.json`. Once jiti loads the server source, it follows the `extends` chain and fails: `File '../../tsconfig.base.json' not found`. As a result, `pi-dashboard start` / `restart` crash on every 0.8.0 install. `/api/restart` still works, but only when a server is already running.

The gap has existed since the monorepo restructure (`8ce152cae`). It became fatal in 0.8.0, which added `jiti ^2.7.0`. v0.7.0 declared no jiti.

CI did not catch it for two reasons:
- `scripts/verify-published-imports.mjs` checks only `packages/*` workspaces (`listWorkspaces`). It never checks the root package, which is the one that is broken.
- The check resolves JS/TS import specifiers only. It ignores tsconfig `extends` references.

## What Changes

- Add `tsconfig.base.json` to the root `package.json` `files`.
- Extend `verify-published-imports.mjs`:
  - Check the root package (when it is not `private`) for the tsconfig-extends rule only. Its full import check is a follow-up (~250+ pre-existing meta-package findings).
  - Read the keyed-object `npm pack --json` payload npm emits at a workspace root. It was previously read as 0 files, a vacuous pass.
  - For every shipped `tsconfig*.json`, resolve a relative `extends` (string or array) against the packed file set. Report a missing target as `dangling-tsconfig-extends` (error).
- Add fixture coverage: a known-bad fixture (shipped tsconfig whose `extends` target is absent) must fail; a known-good one must pass.
- Add a CHANGELOG `## [Unreleased]` → Fixed entry. Cut a 0.8.1 patch release through the `release-cut` skill, which is outside this change's tasks.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `publish-correctness-verification`: the check resolves shipped tsconfig `extends` references (packages/* and the root package) and reads the root's keyed pack payload.

## Discipline Skills

- `review-code`: before commit, per project doctrine.
- No others apply. There is no auth or untrusted input, no latency budget, no new endpoint, and no irreversible step. The 0.8.1 publish is handled by `release-cut`.

## Impact

- `package.json` (`files`), `scripts/verify-published-imports.mjs`, `scripts/__tests__/verify-published-imports.test.mjs`, `CHANGELOG.md`.
- Tarball grows by one small JSON file.
- Compatibility: this is additive. The root package enters the CI check for tsconfig `extends` only.
- Rollback: revert the commit. There are no runtime or data changes.
