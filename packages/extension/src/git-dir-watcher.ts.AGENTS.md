# git-dir-watcher.ts — index

Non-recursive `fs.watch` on gitDir (+commonDir when different), `persistent:false`. Filename routing: `HEAD`/`packed-refs`/`*_HEAD` → fast lane; `index`/null → slow lane; else ignored. Attach failure (ENOENT/EMFILE/EACCES/EPERM) → `attach()` returns `false`; the 30 s tick's slow-lane probe still covers it. Exports `createGitDirWatcher`, `laneForGitDirFile`, `WatchFn`, `GitDirWatcher`.
See change: optimize-polling-hot-paths.
