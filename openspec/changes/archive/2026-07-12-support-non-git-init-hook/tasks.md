# Tasks — Support the worktree-init hook in non-git directories

## 1. Config-root resolver (server)

- [x] 1.1 Add `resolveConfigRoot(cwd: string): string | null` in `packages/server/src/git-operations.ts` (next to `resolveMainPath`): git repo → `resolveMainPath(cwd)`; else `cwd` when `cwd/.pi/settings.json` exists; else `null`. → verify: unit tests pass.
- [x] 1.2 Unit tests (`packages/server/src/__tests__/git-operations.test.ts`): git repo → returns `resolveMainPath`; non-git dir with `.pi/settings.json` → returns `cwd`; non-git dir without it → `null`; degenerate git (`isGitRepo` true, `resolveMainPath` stubbed `null`) → `null` AND does NOT fall through to the `cwd/.pi` check; no upward walk (child of a `.pi`-bearing parent, itself non-git and without its own `.pi/settings.json`, → `null`). → verify: `npm test` green for the file.

## 2. Route wiring (server)

- [x] 2.1 In `packages/server/src/routes/git-routes.ts` `GET /api/git/worktree/init-status`: replace the `isGitRepo` guard + `resolveMainPath` with `resolveConfigRoot`; rename the local `repoRoot` variable to `configRoot` (both routes) since for a non-git dir it holds a `cwd`, not a repo root; on `null` return `{ success: true, data: { hasHook: false } }`. Rest (readInitHook / isTrusted / evaluateGateCached) unchanged. → verify: route test below.
- [x] 2.2 In `POST /api/git/worktree/init`: same swap; on `null` treat as no-hook (nothing to run), not `not_a_repo`. → verify: route test below.
- [x] 2.3 Confirm worktree create/remove/lifecycle routes are untouched — they keep `isGitRepo` + `resolveMainPath`. → verify: grep shows `resolveConfigRoot` used only in the two init routes.

## 3. Route tests (server)

- [x] 3.1 `packages/server/src/__tests__/routes-git-worktree-init.test.ts`: non-git dir + valid `worktreeInit` → init-status returns `{ hasHook: true, trusted: false }` (untrusted), NOT `not_a_repo`. → verify: test passes.
- [x] 3.2 Non-git dir with no `.pi/settings.json` → init-status `{ hasHook: false }` (success), NOT `not_a_repo`. → verify: test passes.
- [x] 3.3 Non-git dir + trusted hook → gate evaluated → `{ hasHook: true, needsInit, trusted: true }`; `POST /init` runs the trusted hook. → verify: test passes.
- [x] 3.4 `POST /init` on a non-git dir with an UNTRUSTED hook → `{ success:false, code:"init_untrusted", data:{ hook, hash } }` and NO gate/run spawn. → verify: test passes + spies assert no spawn.
- [x] 3.5 `POST /init` on a non-git dir with NO `.pi/settings.json` → `{ success:true, data:{ ran:false, skippedReason:"no_hook" } }` (existing envelope), NOT `not_a_repo`. → verify: test passes.
- [x] 3.6 Git repo path regression: existing init-status / init tests still green (behavior identical). → verify: full `npm test` green.

## 4. Manual / QA

- [x] 4.1 Point a non-git directory (`.pi/settings.json#worktreeInit` present, gate `"false"`, echo run) at the dashboard; confirm the row shows the run-hook path (change-A button) once trusted, and NOT the amber project-init Initialize button. → verify: browser check on the folder row.

## 5. Discipline checkpoint

- [x] 5.1 `security-hardening`: verify TOFU still gates every execution on the non-git path — untrusted non-git hook reports presence only (init-status) AND `POST /init` returns `init_untrusted` without spawning. → verify: tests 3.1 + 3.4 assert `trusted:false` / `init_untrusted` + no spawn.
- [x] 5.2 `security-hardening`: document the widened read/disclosure surface (hook body readable for any `validateCwd` dir with `.pi/settings.json`, bounded by `networkGuard` + `validateCwd`) — already captured in design.md "Disclosure surface"; the no-upward-walk guarantee applies to the NON-git branch (config root is exactly `cwd`) — git worktrees still resolve via `resolveMainPath` to the main repo root, which may sit outside `cwd` (unchanged from today). → verify: `resolveConfigRoot`'s non-git branch only stats `cwd/.pi/settings.json`, no upward/parent read.
