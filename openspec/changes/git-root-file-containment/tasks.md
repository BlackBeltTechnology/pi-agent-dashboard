## 1. Shared containment helper

- [ ] 1.1 Add `packages/server/src/lib/path-containment.ts` exporting `within(p, base)`, `gitRoot(cwd)` (cached, `git rev-parse --git-common-dir` → `dirname`, fallback `cwd`), and a **parameterized** `isAllowed(resolved, { anchors: string[] })` (anchors = the site's base cwds, e.g. `[cwd]` or `[cwd, ...pinnedDirs]`).
- [ ] 1.2 `isAllowed`: for each anchor, layer ① `within(resolved, anchor)` (logical); layer ② `gitRoot(anchor) !== anchor && within(realpath(resolved), realpath(gitRoot(anchor)))`. Allow if ANY anchor passes. Async (realpath). **No loopback gate — widening is unconditional (D6).**
- [ ] 1.3 `gitRoot`: spawn `git -C cwd rev-parse --path-format=absolute --git-common-dir`, then `dirname`; on any error return `cwd`. **Normalize the result with `path.resolve` (native separators + drive case) before returning (G2).** Cache keyed by `realpath(--git-common-dir)`, not bare cwd (G3) — or skip caching (layer ② is cold).
- [ ] 1.4 Unit-test the helper directly: cwd-inside allow, worktree→parent allow, `/etc/passwd` reject, git-absent → cwd-only, symlink-escape reject. **Add (G2) a Windows-style mixed-separator case** (forward-slash git root vs backslash resolved) asserting `within` matches after normalization.
- [ ] 1.5 Document known limitations (G4): submodule session → layer ② no-op (anchor falls inside `.git/modules`); `--separate-git-dir` → may under-contain. Both fail closed; no test required, note in the helper doc-comment.

## 2. Route all guard sites through the helper

- [ ] 2.1 `file-routes.ts` — route `/api/file` (124), `/api/file/raw` (222), `/api/file/render` (325) through `isAllowed(resolved, { anchors: [cwd] })`; keep 403 + `"path outside working directory"`.
- [ ] 2.2 `file-routes.ts` — `/api/file/exists` (172): `isAllowed(resolved, { anchors: [cwd, ...preferencesStore.getPinnedDirectories()] })`; **preserve** its `"unknown cwd"` / `"path outside cwd"` strings (D7). Do NOT fold pinned dirs onto the other routes.
- [ ] 2.3 `system-routes.ts` — route the `target.startsWith(cwdWithSep)` guard (≈ line 174) through `isAllowed(target, { anchors: [cwd] })`; keep status + `"path outside working directory"`.
- [ ] 2.4 Confirm no other hand-rolled `startsWith(cwd` containment remains (`grep -rn "startsWith(cwd" packages/server/src`).

## 3. Tests

- [ ] 3.1 `file-absolute-containment.test.ts`: keep `/etc/passwd` + encoded-traversal rejections; add (a) worktree cwd reading a parent-root file → 200, (b) symlink escaping git root → 403, (c) cwd with no git → behaves as cwd-only, (d) `/api/file/exists` still honors pinned dirs + keeps `"unknown cwd"` / `"path outside cwd"` strings.
- [ ] 3.2 `file-raw-render-endpoints.test.ts`: containment message unchanged; raw route honors the widened rule.
- [ ] 3.3 `npm test 2>&1 | tee /tmp/pi-test.log` green; `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` empty.

## 4. Follow-up (separate change — do NOT do here)

- [ ] 4.1 File a change for the link-origin defect: worktree sessions must emit *their own* tree's absolute path, not the parent-root copy. Reference this change's "Out of Scope" note.
