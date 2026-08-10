# folder-head-watcher.ts — index

Per-folder `fs.watch` on gitdir HEAD, modeled on `openspec-change-watcher.ts`; `attach/detach/detachAll/size`, debounce, graceful-degrade-on-throw (failedOnce set, attach returns false=retry-later). Resolves gitdir via `resolveGitDir` (worktree-aware). Exports `matchesHeadFile(name)` = name==="HEAD". Trigger-only: HEAD event → `onChange(cwd)` → poll `refreshOne` (single broadcast path, never bypasses diff cache). See change: refresh-folder-header-branch.
