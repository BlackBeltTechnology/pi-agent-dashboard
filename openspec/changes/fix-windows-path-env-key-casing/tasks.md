## 1. Helper (TDD)

- [ ] 1.1 Write `packages/shared/src/platform/__tests__/env-path-key.test.ts` covering the spec scenarios for win32 and POSIX: a `Path`-only env, merging `PATH`+`Path`, case-insensitive de-duplication, POSIX unchanged, idempotent, no mutation. Verify it fails.
- [ ] 1.2 Implement `normalizeEnvPathKey(env, platform?)` in `packages/shared/src/platform/env-path-key.ts` and export it from the platform barrel if one exists. Tests go green.

## 2. Wire into PATH mutators (TDD per site)

- [ ] 2.1 `ToolResolver.buildSpawnEnv` (`binary-lookup.ts`): add a win32 test with a `Path`-only env where the output has exactly one PATH key that keeps the inherited entries (fails first). Then normalize after the `ELECTRON_*` strip using `opts.platform`.
- [ ] 2.2 `ensureWindowsSystemPath` (`ensure-windows-path.ts`): add a test with a `Path`-only env, then normalize at entry.
- [ ] 2.3 `ensureBundledGitOnPath` (`ensure-bundled-git.ts`): add a test with a `Path`-only env where the output keeps the inherited entries after the bundled dirs, then normalize at entry.
- [ ] 2.4 `prependManagedNodeToPath` (`managed-node-path.ts`) and `prependSelectedNodeToPath` (`node-installs/child-path.ts`): add tests, then normalize the clone.
- [ ] 2.5 `prependResolvedBinDir` (`server/src/spawn-process/process-manager.ts`): add a test through `buildSpawnEnv(..., { spawnRuntime })`, then normalize the clone.

## 3. Verify & docs

- [ ] 3.1 Run `npm test` for the shared and server packages. Confirm POSIX snapshot/equality tests are unchanged.
- [ ] 3.2 Run `npm run quality:changed` (Biome ratchet).
- [ ] 3.3 Update `packages/shared/src/platform/AGENTS.md`: add an `env-path-key.ts` row and `See change: fix-windows-path-env-key-casing` on the touched rows. Update the `node-installs` and server `spawn-process` AGENTS rows.
- [ ] 3.4 Add a CHANGELOG `## [Unreleased]` entry: "Windows: tools on system PATH no longer resolve as missing (#720)".
- [ ] 3.5 Manual QA on Windows 11 with the Electron build. The Doctor `git source` check should show `host`, `/api/tools/git` should give `ok: true`, and a spawned session in a git repo should run `git status` successfully.
