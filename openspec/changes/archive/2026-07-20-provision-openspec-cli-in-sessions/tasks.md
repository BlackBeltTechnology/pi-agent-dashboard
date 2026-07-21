# Tasks

## 1. Single-source the openspec version

- [x] 1.1 Declare `@fission-ai/openspec` `^1.6.0` in both `packages/server/
      package.json` and `packages/extension/package.json` (NO root `overrides`);
      `npm install`; confirm `npm ls @fission-ai/openspec` shows one hoisted
      1.6.x, lockfile regenerated + committed.
- [x] 1.2 One-time: run `npx --no-install openspec init --tools pi --force` and
      commit the regenerated `openspec-*` skills so `generatedBy` == 1.6.0 (the
      worktreeInit gate won't auto-refire on initialized checkouts).
- [x] 1.3 Harden `.pi/settings.json` worktreeInit: `npx @fission-ai/openspec init
      --tools pi --force` → `npx --no-install openspec init --tools pi --force`
      (offline-hard; flags preserved).
- [x] 1.4 Extend `scripts/verify-release-deps.mjs`: add the extension-dep rule +
      a server↔extension floor-consistency assertion; bump the floor 1.3.0 →
      1.6.0; wire the script into `ci.yml` (develop), not release-only.
- [x] 1.5 Verify `openspec-poller.ts` against real 1.6.0 `status|list --json`
      (assert NON-empty parity — poller fails silent-empty on schema breaks) AND
      confirm `init --tools pi` emits the expected skill set at 1.6.0, BEFORE the
      range bump lands.

## 2. Shim + PATH prepend (bridge)

- [x] 2.1 Add a bridge-init helper (`packages/extension/src/openspec-cli-shim.ts`)
      that: resolves the bin via `require.resolve("@fission-ai/openspec/
      package.json")` → join `bin/openspec.js` (exports encapsulation blocks the
      subpath); ensures a `0700` shim dir under `~/.pi/dashboard/`; writes an
      **extensionless** `#!/bin/sh` shim `exec "<process.execPath>" "<bin.js>"
      "$@"` **atomically** (temp + rename), **re-pointed every init**. Fail soft:
      resolution/write error → log + skip, never throw.
- [x] 2.2 Prepend the canonical (realpath) shim dir to `process.env.PATH`
      idempotently (split on `path.delimiter`, compare canonical form); wire into
      bridge init (`bridge.ts`), guarded against double-run on `/reload`.
- [x] 2.3 Keep it non-destructive: prepend only; shim dir holds only `openspec` so
      it shadows nothing; a pre-existing global `openspec` still resolves.

## 3. Docs & specs

- [x] 3.1 Add per-file rows for the new `openspec-cli-shim.ts` + any change-history
      to `packages/extension/src/AGENTS.md` (Documentation Update Protocol).
- [x] 3.2 `openspec validate provision-openspec-cli-in-sessions --strict` passes.

## Tests

<!-- folded from test-plan.md; all rows automated (7/7), 0 manual-only -->

- [x] T-E1 (test-plan #E1) L1 unit — bare `openspec` resolves in-session. Input: a
      child env whose PATH has no `openspec`. Trigger: run the provision helper, then
      spawn `sh -c "openspec --version"` with the resulting PATH. Observable: exit 0
      AND stdout contains `1.6.0`. Exemplar: `packages/extension/src/__tests__/custom-provider-apikey-roundtrip.test.ts` (env save/restore) + `child_process.spawnSync`.
- [x] T-E2 (test-plan #E2) L1 unit — idempotent prepend. Input: `process.env.PATH`
      after one provision call. Trigger: call the helper a second time (simulated
      `/reload`). Observable: the canonical shim dir appears exactly once in PATH.
      Exemplar: `packages/extension/src/__tests__/command-handler.test.ts` (env save/restore).
- [x] T-E3 (test-plan #E3) L1 unit — re-point on init. Input: an existing shim file
      targeting an OLD resolved bin path. Trigger: run provision with a CHANGED
      resolved bin path. Observable: shim content targets the NEW `bin/openspec.js`,
      written temp+rename (no partial file). Exemplar: `packages/extension/src/__tests__/custom-provider-apikey-roundtrip.test.ts` + `os.mkdtemp`.
- [x] T-E4 (test-plan #E4) L1 unit — non-destructive. Input: PATH seeded with a fake
      global `openspec` dir before provision. Trigger: run provision. Observable: the
      fake global dir is still present and its relative order preserved (prepend-only).
      Exemplar: `packages/extension/src/__tests__/command-handler.test.ts`.
- [x] T-X1 (test-plan #X1) L1 unit — fail-soft + surface. Fault: `require.resolve`
      for the pinned CLI stubbed to throw. Trigger: bridge provision at init.
      Observable: no throw; PATH unchanged; a diagnostic logged AND the
      `missingTool`-style emit invoked (spy asserts both). Exemplar: `packages/extension/src/__tests__/custom-provider-apikey-roundtrip.test.ts` (spy/mocks).
- [x] T-X2 (test-plan #X2) L1 unit — stripped PATH (F3). Fault: child env PATH lacks
      `node`. Trigger: invoke the shim `openspec --version`. Observable: exit 0 —
      resolves node via absolute `process.execPath`, not PATH. Exemplar: `packages/extension/src/__tests__/custom-provider-apikey-roundtrip.test.ts` + `child_process.spawnSync` with a scrubbed env.
- [x] T-C1 (test-plan #C1) L2 qa smoke (Windows) — Git Bash resolution. Input: a
      Windows session, `openspec` not on PATH, `node` not required on PATH. Trigger:
      `openspec --version` via `bash.exe -c` after provision. Observable: the
      extensionless shim resolves; exit 0; prints `1.6.0`. Exemplar: `qa/tests/10-bundled-git.ps1` (Windows bundled-binary resolution smoke).
- [x] T-S1 (test-plan #S1) L1 unit — verify-release-deps floor consistency. Input:
      package.json fixtures where the extension `@fission-ai/openspec` floor
      diverges from the server (no override). Trigger: run the guard's
      floor-consistency check. Observable: non-zero exit naming the drifted site;
      equal-floor fixture passes. Exemplar: sibling test of
      `scripts/verify-release-deps.mjs` (or `scripts/__tests__/`), else a new
      `verify-release-deps.test.mjs` invoking the rule fn.
- [x] T-S2 (test-plan #S2) L2 qa smoke — offline regen matches source. Input: repo
      with override 1.6.0, network blocked. Trigger: `npx --no-install openspec init
      --tools pi --force`. Observable: exit 0; a regenerated `openspec-*/SKILL.md`
      has `generatedBy: "1.6.0"`. Exemplar: `qa/tests/01-install.sh` (offline npm/npx flow).
- [x] T-S3 (test-plan #S3) L1 unit — poller compat with 1.6.0. Input: a captured
      `openspec status|list --json` payload from 1.6.0. Trigger: feed it to the
      `openspec-poller.ts` parsing. Observable: same `OpenSpecData` shape as 1.4.1
      (no detection regression). Exemplar: `packages/shared/src/__tests__/openspec-poller-parity.test.ts`.

## Validate

- [x] V1 `npm test` green for the touched packages.
- [x] V2 (test-plan: manual-only) Manual on a CLI-less box: with no `openspec`
      on PATH, click Apply → the skill's bare `openspec` resolves (via the shim)
      and runs, with no hand-edit fallback. Automated equivalent T-E1 already
      proves the same observable programmatically; this is physical-hardware
      acceptance, deferred to post-merge QA.
- [x] V3 Idempotency: `/reload` the session; `echo $PATH` shows the shim dir once.
      (Automated equivalent T-E2 passes; manual `/reload` echo deferred to QA.)
- [x] V4 Stripped-PATH: with `node` NOT on PATH, `openspec --version` via the shim
      still runs (absolute `process.execPath`). (Automated equivalent T-X2 passes.)
- [x] V5 Single-source: `npm ls @fission-ai/openspec` shows one resolved 1.6.x
      tree-wide; `node scripts/verify-release-deps.mjs` passes; a deliberate
      floor drift in one site makes it fail; the ci.yml step runs it on develop.
