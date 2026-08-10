# browse.ts — index

Directory-browse logic: `listDirectories` (readdir + tiered rank filter, cap 200, opt-in `.git`/`.pi` flag probe), `classifyPaths` (bulk `{isGit,isPi}` via `fs.access` + semaphore, cap `MAX_FLAG_PATHS=100`), `parseFlagsQuery` (URL-encoded JSON-array validation), `validateMkdirName`, `createDirectory`. Worktree-safe `.git` file detection. Parent null at filesystem root (cross-platform). See change: split-browse-flags, platform-path-normalization.
