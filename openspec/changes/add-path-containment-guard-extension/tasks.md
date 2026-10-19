## 1. Shared resolver extraction + dangling-symlink fix (D1, D6)

- [ ] 1.1 Write `packages/shared/src/__tests__/tool-path-resolve.test.ts` first and see it fail, modelled on `packages/extension/src/path-gate/__tests__/decide.test.ts` (test-plan #E24).
  - Input: `isPathWithinRoots` / `canonicalizeTarget` over a sibling prefix, root equality, an exact hit with a probe spy, a case-insensitive-probe fold, `path.win32` forms, a real temp tree where the link text `sub/../x` has `sub` as a symlink, and an env literal without `isSymlink`/`readlink`.
  - Trigger: call.
  - Observable: the sibling is outside; equality is inside; the probe is not called on an exact hit; folding happens only when the probe says so; win32 is correct; `sub/../x` resolves from the real target of `sub`; the legacy env does not throw and keeps the old result.
- [ ] 1.2 Create `packages/shared/src/tool-path-resolve.ts` (design D1):
  - move `ResolveEnv`, `defaultResolveEnv`, `resolveToolPath`, `resolveReadTarget` and `canonicalizeTarget` verbatim from `packages/extension/src/path-gate/resolve.ts`;
  - add `isWithinRoot` + `isPathWithinRoots`, built from decide.ts's `isWithin` / `fold` / `defaultVolumeProbe` and keeping exact-match-first, probe-on-miss.

  Verify: `npx tsc --noEmit -p packages/shared` is clean, and the extraction rows of 1.1 pass.
- [ ] 1.3 Turn `packages/extension/src/path-gate/resolve.ts` into `export * from` the shared module, and switch `decide.ts` to the shared containment, with no other edits. Verify: the regression run in task 1.6 passes, as the pure-move checkpoint.
- [ ] 1.4 Add path-gate regression tests to `packages/extension/src/path-gate/__tests__/decide.test.ts` first, and see them fail (test-plan #E23).
  - Input: path-gate roots = the temp repo; (a) a dangling `repo/link` → `other/new.txt`; (b) `repo/s` → `other/deep`, with `deep/link` → `../new.txt`.
  - Trigger: `decidePathAccess({access:"write"})`.
  - Observable: both return `verdict:"ask"` with canonical `<other>/new.txt`.
- [ ] 1.5 Add a loop test to `packages/extension/src/path-gate/__tests__/handler.test.ts` first, and see it fail (test-plan #X10).
  - Input: a symlink loop `repo/a` ↔ `repo/b`.
  - Trigger: `createPathGateHandler` handling `write repo/a`.
  - Observable: blocked as `error`, with exactly one `[path-gate] error` log line.
- [ ] 1.6 Run the regression suite (test-plan #E25).
  - Input: the unmodified `packages/extension/src/path-gate/__tests__/*.test.ts`.
  - Trigger: run after 1.3 and again after 1.7.
  - Observable: all pass, with no edits to the test files beyond the 1.4 / 1.5 additions.

  Exemplar: the existing suite itself.
- [ ] 1.7 Implement D6 in the shared `canonicalizeTarget`:
  - optional `isSymlink?` / `readlink?` on `ResolveEnv`, with defaults in `defaultResolveEnv`;
  - a dangling link's text resolved component by component (relative text from `realpath(dirname)`, absolute text from `path.parse(text).root`; split on `/` and `\` on win32);
  - a 40-hop counter shared across restarts, which throws when exceeded.

  Verify: 1.1, 1.4, 1.5, 1.6 and 1.8 pass.
- [ ] 1.8 Keep path-gate's latency test passing after D6 (test-plan #P2).
  - Input: the existing "P1 in-root p95 < 1 ms" test in `packages/extension/src/path-gate/__tests__/handler.test.ts`.
  - Trigger: run after 1.7.
  - Observable: p95 < 1 ms, unchanged.
- [ ] 1.9 Update the DOX rows: add a `tool-path-resolve.ts` row or sidecar under `packages/shared/src/`, and update the `resolve.ts` / `decide.ts` rows in `packages/extension/src/path-gate/AGENTS.md`. Run `node scripts/split-large-agents.mjs packages/shared/src/AGENTS.md --write` if the cap trips. Verify: `scripts/__tests__/repo-hygiene.test.mjs` passes.

## 2. Guard package scaffold

- [ ] 2.1 Add `packages/shared/src/path-containment-guard-name.ts`, exporting `PATH_CONTAINMENT_GUARD_EXT_NAME = "path-containment-guard"` (design D7), plus its DOX row. Verify: `npx tsc --noEmit -p packages/shared` is clean.
- [ ] 2.2 Create `packages/path-containment-guard/`:
  - `package.json` for `@blackbelt-technology/pi-path-containment-guard`:
    - `publishConfig.access: public`;
    - NO `pi.extensions`;
    - `exports` `"."` → `src/scope.ts` and `"./extension"` → `src/extension.ts`;
    - `files: ["src/", "!src/__tests__", "README.md", "!**/AGENTS.md", "!**/*.AGENTS.md"]`;
    - dependency `pi-dashboard-shared`;
    - optional pi peer plus a pi devDependency (design D2, modelled on `packages/untrusted-content-guard/package.json`).
  - `tsconfig.json`, `vitest.config.ts` (copied from `packages/untrusted-content-guard/vitest.config.ts`: node env, forks, `maxWorkers: PARALLEL_MAX_WORKERS`), a `README.md` stub and `AGENTS.md`.

  Verify: `pnpm install --prefer-offline` links the workspace.
- [ ] 2.3 Register the package:
  - in `.github/workflows/publish.yml` PACKAGES, after `pi-dashboard-shared`;
  - in the root `vitest.config.ts` projects;
  - in the `knip.json` workspaces.

  Verify: `publish-allowlist-complete.test.ts`, `publish-tarball-hygiene.test.ts` and `npx knip --reporter json` (zero issues under the package path) pass.

## 3. Guard: tests first, then implementation

Config tests go in `packages/path-containment-guard/src/__tests__/config.test.ts`, with exemplar `packages/team-plugin/src/extension/__tests__/guard.test.ts` (its `policyFromEnv` cases).

- [ ] 3.1 Test (test-plan #E1).
  - Input: `ALLOWED_ROOTS='["/w/repo","rel/dir","",7]'`, cwd `/w`.
  - Trigger: `read /w/repo/a.ts`, then `read rel/dir/x`.
  - Observable: the first is allowed; the second is rejected `path_outside_roots`.
- [ ] 3.2 Test (test-plan #E2).
  - Input: win32 flavour, `ALLOWED_ROOTS='["\\w\\repo"]'`.
  - Trigger: `read C:\w\repo\a.ts`.
  - Observable: rejected `config_invalid`.
- [ ] 3.3 Test (test-plan #E3).
  - Input: a symlink-loop root plus a real repo root.
  - Trigger: `parseGuardConfig`, then an in-root read.
  - Observable: no throw; `roots` = [canonical repo]; the read is allowed.
- [ ] 3.4 Test (test-plan #E4).
  - Input: `ALLOWED_ROOTS` ∈ {absent, `not json`, `{}`, `[]`, `["rel"]`}.
  - Trigger: an in-root `read`, and `bash`.
  - Observable: the reads are rejected `config_invalid`; `bash` is allowed.
- [ ] 3.5 Test (test-plan #E5).
  - Input: `DENIED_TOOLS` ∈ {absent, `[]`, `bash,write`, `{"a":1}`, `["bash",7]`, `["bash",""]`}.
  - Trigger: an in-root `read`, and `bash`.
  - Observable: absent and `[]` allow both; the other four reject both with `config_invalid`.

Decision tests go in `src/__tests__/decide.test.ts`, with exemplar `packages/team-plugin/src/extension/__tests__/guard.test.ts`; use real temp dirs for filesystem cases.

- [ ] 3.6 Test (test-plan #E6).
  - Input: roots `["/w/repo"]`, denied `["write"]`.
  - Trigger: `write /w/repo/a.txt`.
  - Observable: rejected `tool_denied`.
- [ ] 3.7 Test (test-plan #E7).
  - Input: denied `["Bash"]`.
  - Trigger: `bash`.
  - Observable: not rejected.
- [ ] 3.8 Test (test-plan #E8).
  - Input: root `/w/repo` (temp).
  - Trigger: `read` of the root itself, a child, `repo-old/a`, the parent, and `repo2`.
  - Observable: the first two allowed; the last three rejected `path_outside_roots`.
- [ ] 3.9 Test (test-plan #E9).
  - Input: root + cwd = temp repo.
  - Trigger: `read` of `~/.ssh/id_rsa`, `@/etc/hosts`, `file:///etc/hosts` and `@<repo>/a`.
  - Observable: the first three rejected; the `@<repo>/a` read allowed.
- [ ] 3.10 Test (test-plan #E10).
  - Input: root + cwd `/w/repo`.
  - Trigger: `read ../other/x.txt`.
  - Observable: rejected, with canonical `/w/other/x.txt`.
- [ ] 3.11 Test (test-plan #E11).
  - Input: `repo/link` → `other/`; a root given as `rootlink` → `repo`.
  - Trigger: `edit repo/link/f.txt`; `read repo/a` under root `rootlink`.
  - Observable: the edit is rejected; the read is allowed.
- [ ] 3.12 Test (test-plan #E12).
  - Input: dangling links `link` → `../other/new.txt`, `s/link` → `../new.txt` (with `s` → `other/deep`), and `abs` → absolute `other/new2.txt`.
  - Trigger: `write` each.
  - Observable: all three rejected `path_outside_roots`, each with the outside canonical path.
- [ ] 3.13 Test (test-plan #E13).
  - Input: `repo/new/deep` does not exist.
  - Trigger: `write repo/new/deep/a.txt`.
  - Observable: allowed.
- [ ] 3.14 Test (test-plan #E14).
  - Input: root `/w/repo/sub`, cwd `/w/repo`; tool ∈ {grep, find, ls} × path ∈ {absent, `""`, `null`, `sub/x`}.
  - Trigger: `decideGuard`.
  - Observable: the first three paths rejected (cwd); `sub/x` allowed.
- [ ] 3.15 Test (test-plan #E15).
  - Input: the curly-quote variant symlink → an outside file; the literal name is missing.
  - Trigger: `read repo/it's.txt`.
  - Observable: rejected `path_outside_roots`.
- [ ] 3.16 Test (test-plan #E16).
  - Input: root `/w/Repo`, target `/w/repo/a.ts`; the injected probe returns false or true.
  - Trigger: `read`.
  - Observable: false → rejected; true → allowed.
- [ ] 3.17 Test (test-plan #E17).
  - Input: {read, write, edit} × path ∈ {absent, `""`, `null`, `7`}; `grep {path:7}`; `read {path:"a\0b"}`.
  - Trigger: `decideGuard`.
  - Observable: every case rejected `invalid_path`.
- [ ] 3.18 Test (test-plan #E18).
  - Input: denied absent, then denied `["bash","powershell"]`.
  - Trigger: `bash cat /w/other/s`, `powershell`, and `mcp__srv__read_file {path:"/etc/passwd"}`.
  - Observable: with nothing denied, all are allowed; with the list, bash and powershell are rejected `tool_denied` and the MCP tool is allowed.
- [ ] 3.19 Test (test-plan #P1), timed like the "P1 in-root" case in `packages/extension/src/path-gate/__tests__/handler.test.ts`.
  - Input: 1000 `decideGuard("read")` calls of existing files in one temp root, after one warm-up call.
  - Trigger: timed loop.
  - Observable: p95 < 1 ms.

Handler tests go in `src/__tests__/extension.test.ts`, with exemplar `packages/untrusted-content-guard/src/__tests__/extension.test.ts`.

- [ ] 3.20 Test (test-plan #X1).
  - Input: an injected `realpathSync` that always throws `EACCES`.
  - Trigger: handler on `read`.
  - Observable: `{block:true}`, a reason starting `error`, and one stderr line.
- [ ] 3.21 Test (test-plan #X2).
  - Input: a symlink loop `repo/a` ↔ `repo/b`.
  - Trigger: `write repo/a`.
  - Observable: rejected `error` within the 5 s test timeout.
- [ ] 3.22 Test (test-plan #X3).
  - Input: a config dependency injected to throw while the factory runs.
  - Trigger: invoke the factory with a fake `pi`.
  - Observable: the factory returns; exactly one `tool_call` handler is registered; an in-root `read` and `bash` are both rejected `config_invalid`.
- [ ] 3.23 Test (test-plan #X4).
  - Input: `ctx.ui.confirm/select/input/notify` spies that throw when called.
  - Trigger: an out-of-root `write`.
  - Observable: rejected `path_outside_roots`, with zero spy calls.
- [ ] 3.24 Test (test-plan #X5).
  - Input: an out-of-root path containing `\n` and U+2028.
  - Trigger: `read`.
  - Observable: one stderr line, with the characters escaped.
- [ ] 3.25 Test (test-plan #X6).
  - Input: one call per code (`tool_denied`, `path_outside_roots`, `invalid_path`, `config_invalid`, `error`).
  - Trigger: the handler.
  - Observable: each reason starts with its code; the `— allowed roots:` suffix appears only on `path_outside_roots`.

Real-runner tests go in `src/__tests__/runner.test.ts`, using pi's exported `discoverAndLoadExtensions` + `ExtensionRunner` (`@earendil-works/pi-coding-agent` `dist/index.d.ts:9`; check the signatures). Exemplar for loader glue: `packages/dashboard-plugin-runtime/src/__tests__/loader-native-import.test.ts`.

- [ ] 3.26 Test (test-plan #X7).
  - Input: the guard loaded through pi's loader, denied `["bash"]`.
  - Trigger: emit `tool_call` for `bash` carrying `parentToolCallId`.
  - Observable: blocked `tool_denied`.
- [ ] 3.27 Test (test-plan #X8).
  - Input: the guard + a stub always-allow handler, registered guard-first and then stub-first.
  - Trigger: emit an out-of-root `read`.
  - Observable: blocked `path_outside_roots` in both orders; `rg "packages/extension|path-gate" packages/path-containment-guard/src` finds nothing.
- [ ] 3.28 Test (test-plan #X9), in `src/__tests__/jiti-safe.test.ts` for part (b), with exemplar `scripts/__tests__/jiti-cjs-transpile-safety.test.mjs`.
  - Input: `src/extension.ts` and `src/scope.ts`.
  - Trigger: (a) pi's loader on the entry; (b) jiti CJS transform plus an AST scan.
  - Observable: (a) no load errors and one handler; (b) zero `MetaProperty` nodes in code position.

Helper tests go in `src/__tests__/scope.test.ts`, which stays pure (no server/runtime imports).

- [ ] 3.29 Test (test-plan #E19).
  - Input: `withPathContainmentGuard(opts, base?)` with:
    - no base;
    - base `{extensions:["/p/own.ts"], extensionConfig:{team:{root:"/w"}}}`;
    - a base already holding the guard key;
    - roots `[]`, `["rel"]` and a win32 driveless root;
    - denied `["bash",""]`;
    - denied omitted.
  - Trigger: call.
  - Observable: the fragment shape is correct; the merge keeps both, with `extensions` = [own, guard] and the base deep-equal to its pre-call snapshot; every invalid case throws; omitted denied → no `deniedTools` key.
- [ ] 3.30 Test (test-plan #E20).
  - Input: the package `package.json`, the package root listing, and the import graph of `src/scope.ts`.
  - Trigger: read the manifest and import `scope.ts`.
  - Observable: no `pi.extensions`; no root `index.ts`/`index.js`; no `@earendil-works/*` module loaded.
- [ ] 3.31 Implement `src/config.ts`: `parseGuardConfig(env, platform?)`, the exported `isAcceptableRoot(p, platform)`, and env names derived from `PATH_CONTAINMENT_GUARD_EXT_NAME` (design D3). Verify: 3.1–3.5 pass.
- [ ] 3.32 Implement `src/decide.ts` `decideGuard(...)` over the shared resolver (design D3). Verify: 3.6–3.19 pass.
- [ ] 3.33 Implement `src/extension.ts`, the total factory: one `tool_call` handler, D4 reasons, and escaped stderr logs (design D3/D4). Verify: 3.20–3.28 pass.
- [ ] 3.34 Implement `src/scope.ts` `withPathContainmentGuard(opts, base?)`, with an uncast `import.meta.url` (design D5). Verify: 3.29–3.30 pass.

## 4. Spawn env namespace ownership (plugin-spawn-scope MODIFIED, D7)

- [ ] 4.1 Test (test-plan #E21), extending `packages/server/src/__tests__/plugin-spawn-scope-env.test.ts` first and seeing it fail. Exemplar for the contributor setup: `packages/server/src/__tests__/spawn-env-contributors.test.ts`.
  - Input:
    - (a) inherited `PI_EXT_GUARD_ALLOWED_ROOTS` + `_TOKEN` with `{guard:{allowedRoots:["/new"]}}`;
    - (b) `{guard:{}}`;
    - (c) an inherited `PI_EXT_OTHER_KEY`;
    - (d) both `path-containment` and `path-containment-guard` named;
    - (e) an inherited `PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS` with no config;
    - (f) a contributor supplying `PI_EXT_GUARD_TOKEN`.
  - Trigger: `buildSpawnEnv`.
  - Observable:
    - (a) only `["/new"]`, and no TOKEN;
    - (b) no `ALLOWED_ROOTS`;
    - (c) OTHER kept;
    - (d) both projected;
    - (e) absent;
    - (f) absent, and not in `contributedOut`.
- [ ] 4.2 Test (test-plan #E22), a new `packages/server/src/__tests__/path-containment-guard-spawn-chain.test.ts` modelled on `plugin-spawn-scope-env.test.ts`, with the guard package declared in `packages/server/package.json` devDependencies. Dependency hygiene is owned by Biome `noUndeclaredDependencies`, not knip (dead-code-detection spec).
  - Input: `withPathContainmentGuard({allowedRoots:["/w/repo"],deniedTools:["bash"]})`.
  - Trigger: `pluginSpawnToSessionOptions` → `sessionFlagsToArgv` + `buildSpawnEnv`.
  - Observable: argv has `-e <guard entry>`; env holds both guard vars as JSON.
- [ ] 4.3 Implement D7 in `buildSpawnEnv` (`packages/server/src/spawn-process/process-manager.ts`):
  - move the `extensionConfig` block after `applySpawnEnvContributors`;
  - strip every configured `PI_EXT_<normName>_*`, then `PI_EXT_PATH_CONTAINMENT_GUARD_*` unconditionally (name via `normalizeEnvSegment(PATH_CONTAINMENT_GUARD_EXT_NAME)`), all before any projection;
  - prune the removed names from `contributedOut`.

  Verify: 4.1, 4.2 and the existing plugin-spawn-scope tests pass.
- [ ] 4.4 Compatibility check: `rg -n "PI_EXT_" packages --glob '!**/__tests__/**' --glob '!packages/electron/resources/**'`. Confirm that each named spawn sets every key its extension reads, and record the result in the PR description:
  - `packages/goal-plugin/src/server/index.ts:109` and `packages/automation-plugin/src/server/engine.ts:788` (`pi-dashboard`: only `ASK_USER_PROMPT_TIMEOUT_SECONDS`);
  - `packages/team-plugin/src/server/conversations.ts:599` (`TOOLS`/`ROOT`/`SKILLS`/`RUN_ID`);
  - `packages/chat-gateway/src/server/gateway.ts:653` (`GUARD_POLICY`).

  Verify: the result is recorded.
- [ ] 4.5 Update the `process-manager.ts` row in the nearest `AGENTS.md`, marked `See change: add-path-containment-guard-extension`. Verify: repo-hygiene passes.

## 5. Docs, verification, follow-ups

- [ ] 5.1 Write the package `README.md`. It covers:
  - loading via `-e` / `scope.extensions` only, and why there is no `pi.extensions`;
  - the env contract and the fail-closed table;
  - the reason codes;
  - the trust boundary (co-loaded extensions);
  - the recommendation that `deniedTools` name every shell and code-executing tool (`bash`, `powershell`, `ctx_execute`-style sandboxes, subagent/spawn tools, `codemode`), plus `scope.noMcp: true`; neither `scope.tools` nor `--tools` confines nested `ctx.executeTool` or MCP tools;
  - respawning rather than `/reload`ing guarded sessions;
  - merging through `withPathContainmentGuard(opts, base)`;
  - keeping `allowedRoots` inside cwd to avoid path-gate prompts;
  - that image-fit listed before the guard gets its resized temp path rejected;
  - the no-symlink-follow (grep/find), Windows `\\?\` readlink (fails closed) and TOCTOU assumptions;
  - the install footprint.

  Fill the package `AGENTS.md` rows. Verify: `publish-tarball-hygiene` passes.
- [ ] 5.2 Delegate one `docs/` touch to DocScribe, in caveman style: a short `path-containment-guard` entry in the relevant security/plugin doc, linking the README and noting the path-gate dangling-symlink fix and the spawn namespace ownership. Verify the doc row exists.
- [ ] 5.3 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep the summary. Also run `npx biome check --error-on-warnings --max-diagnostics=200 packages/path-containment-guard packages/shared/src/tool-path-resolve.ts packages/shared/src/path-containment-guard-name.ts packages/extension/src/path-gate packages/server/src/spawn-process/process-manager.ts`. Verify: no failures and no Biome findings.
- [ ] 5.4 Run `review-code` over the diff, with the `security-hardening` lens: traversal, symlink (dangling links, loops, relative link text), case-folding, Windows drive letters, NUL, inherited env, and load-failure-on-reload. Verify there are no open blocker or major findings.
- [ ] 5.5 File a follow-up GitHub issue: "team-plugin guard: same dangling-symlink escape (`packages/team-plugin/src/extension/guard.ts:78-93`); migrate it to the shared `tool-path-resolve`". Verify: the issue URL is recorded in the PR description.
- [ ] 5.6 File a follow-up GitHub issue: "plugin-spawn-scope: `isSafeEnvString` keeps `""` array elements, contrary to the spec's non-empty element rule (`packages/dashboard-plugin-runtime/src/server/server-context.ts:484-486`)". Verify: the issue URL is recorded in the PR description.
