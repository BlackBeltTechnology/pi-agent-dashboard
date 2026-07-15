## 1. Guard fix (server, plugin-only)

- [x] 1.1 Add `canonPath(p)` to `kb-routes.ts` — `resolve` then best-effort `realpathSync`, falling back to the resolved path for a non-existent path.
- [x] 1.2 Add `worktreeMainPath(cwd)` — `git -C <cwd> rev-parse --path-format=absolute --git-common-dir` → `dirname`; returns null on non-repo / git failure (server-derived, never client-supplied).
- [x] 1.3 Rewrite `rejectCwd` to (a) canonicalize both the query cwd and each known folder, (b) admit on direct canonical match, (c) else admit iff `worktreeMainPath(cwd)` canonicalizes to a known folder, (d) else `403`. Missing cwd still `400`.

## 2. Tests

- [x] 2.1 Admit a known cwd reached through a symlinked alias (Bug 1 / canonicalization).
- [x] 2.2 Admit a real `git worktree add` worktree whose main repo is the only known folder (Bug 2 / session-less worktree).
- [x] 2.3 Reject a worktree whose main repo is NOT known (trust boundary intact).
- [x] 2.4 Existing "rejects an unknown cwd" and "400 when cwd missing" stay green.

## 3. Docs

- [x] 3.1 Update `kb-routes.ts` route JSDoc to describe canonicalized matching + worktree-of-known-repo admission.
- [x] 3.2 Update the `kb-routes.ts` row in `packages/kb-plugin/src/server/AGENTS.md` (`See change: fix-kb-worktree-cwd-guard`).

## 4. Verify

- [x] 4.1 `kb-plugin` suite green (`npx vitest run`, HOME=ephemeral) — 55/55.
- [x] 4.2 `tsc --noEmit` + Biome clean on the changed files.
- [x] 4.3 Live check on the running dashboard: worktree `os-add-tunnel-providers` stats → `200` (was `403`); `/etc` → `403`; `/tmp` (symlink of a session `/private/tmp`) → `200`.
