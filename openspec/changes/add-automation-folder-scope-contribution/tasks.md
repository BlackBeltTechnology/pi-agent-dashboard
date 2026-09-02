# Tasks

## 1. Folder-scope contribution collector

- [ ] 1.1 Add `folder-scope-contributions.ts` (mirrors `collectActionRegistry` in `action-registry.ts`): export `FOLDER_SCOPE_CONTRIBUTION_PREFIX = "automation.folderscope."` and `collectFolderScopeBases(entries, { warn }): string[]`.
- [ ] 1.2 `collectFolderScopeBases` accepts an entry value ONLY when it is a plain, non-null, **non-array** object with a `base` string non-empty after `trim()` that `path.resolve` accepts (wrap in try/catch); otherwise ignore. Warn **once per contribution key** (dedupe warned keys in a `Set`) — NOT per call, since the collector runs on every `listScopes()` read. Dedupe returned bases by resolved path.
- [ ] 1.3 Drop any contributed base whose resolved path equals the global home dir, so it does not double-arm as `folder` + `global`.

## 2. Union contributed bases into scope discovery

- [ ] 2.1 In `folderScopeBases()` (`index.ts:257`), after the session-cwd loop, union `collectFolderScopeBases(ctx.consumeAll(FOLDER_SCOPE_CONTRIBUTION_PREFIX), { warn: (m) => ctx.logger.warn(m) })` into the same `Set`.
- [ ] 2.2 Confirm no change to `listScopes()`, `engine.refresh()`, `reapStaleRuns()`, or `attachWatchers()` — they consume `folderScopeBases()` transitively.
- [ ] 2.3 Document (collector + `folderScopeBases()`): collection is load-order independent (re-read each `listScopes()`), but the arm is boot-anchored to `engine.start()` → `refresh()` + initial `attachWatchers()`; contributions are process-lifetime (no `unprovide`).

## 3. Tests — folded from test-plan.md (every `automated` row → one task)

- [ ] 3.1 **E1** collection: `[{key:"automation.folderscope.a", value:{base:"/repo"}}]` · `collectFolderScopeBases(entries)` · returns `["/repo"]` resolved, unioned into `folderScopeBases()`. see `src/__tests__/action-registry.test.ts` · (test-plan #E1)
- [ ] 3.2 **E2** bad shapes: values `{base:""}`,`{base:"  "}`,`{base:42}`,`["x"]`,`null`,`{}` · `collectFolderScopeBases(entries)` · all ignored → `[]`, one warn per bad key. see `src/__tests__/action-registry.test.ts` · (test-plan #E2)
- [ ] 3.3 **E3** valid+invalid mix: `[{k1:{base:"/a"}},{k2:{base:""}},{k3:{base:"/b"}}]` · collect · returns `["/a","/b"]`, k2 warned. see `src/__tests__/action-registry.test.ts` · (test-plan #E3)
- [ ] 3.4 **E4** dedup by resolved path: entries `{base:"/a"}`+`{base:"/a/"}` and session cwd `/a` · `folderScopeBases()` · exactly one `/a` scope. see `src/__tests__/engine.test.ts` · (test-plan #E4)
- [ ] 3.5 **E5** resolve throws: value `{base:"\u0000/bad"}` · collect · guarded (no throw), warned once. see `src/__tests__/action-registry.test.ts` · (test-plan #E5)
- [ ] 3.6 **E6** warn-once-per-key: one malformed `{badkey:{}}` · call collector 3× · warn emitted exactly once for `badkey`. see `src/__tests__/action-registry.test.ts` · (test-plan #E6)
- [ ] 3.7 **E7** home-dir drop: contributed base resolves to `homeDir`, global scanning on · `folderScopeBases()`/union · home base absent from folder set, arms under `global` only. see `src/__tests__/engine.test.ts` · (test-plan #E7)
- [ ] 3.8 **X1** unwatchable dir degrades: contributed base whose `fs.watch` throws EACCES · `attachWatchers()` · attach returns false, warned once, scan+arm still succeed. see `src/__tests__/automation-watcher.test.ts` · (test-plan #X1)
- [ ] 3.9 **X2** no automation dir: contributed base lacking `.pi/automation` · `engine.refresh()` scan · zero automations, no crash, watcher attach fails silently. see `src/__tests__/scanner.test.ts` + `automation-watcher.test.ts` · (test-plan #X2)
- [ ] 3.10 **I1** zero-session boot arm: tmp repo w/ enabled `.pi/automation/intake/automation.yaml`, `consumeAll`→`{base:tmpRepo}`, no session cwds · engine init → `start()`→`refresh()`+`attachWatchers()` · `intake` scanned+armed AND watcher attached to `<tmpRepo>/.pi/automation`. see `src/__tests__/engine.test.ts` + `automation-watcher.test.ts` · (test-plan #I1)
- [ ] 3.11 **I2** idempotent union: contributed base == a live session cwd · `folderScopeBases()`→`listScopes()`→refresh+attach · exactly one scope + one watcher. see `src/__tests__/engine.test.ts` · (test-plan #I2)
- [ ] 3.12 **I3** nav-pin never arms: a pinned dir in config, NOT contributed · `folderScopeBases()` · pinned path absent from scope set (not scanned/armed/watched). see `src/__tests__/engine.test.ts` · (test-plan #I3)
- [ ] 3.13 **S1** post-boot live-add not armed: `ctx.provide("automation.folderscope.x",{base})` after `engine.start()`, zero sessions, no file change · no trigger · base NOT armed (documented boundary). see `src/__tests__/engine.test.ts` · (test-plan #S1)

## 4. Verify + docs

- [ ] 4.1 `npm test` green (pipe to tmp + grep summary per project convention).
- [ ] 4.2 Add the `folder-scope-contributions.ts` row to `packages/automation-plugin/src/server/AGENTS.md`; update the `index.ts` row's `See change:` trail with `add-automation-folder-scope-contribution`.
