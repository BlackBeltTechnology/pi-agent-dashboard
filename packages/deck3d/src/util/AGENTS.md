# DOX — packages/deck3d/src/util

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `paths.ts` | `pkgRoot()` — walks up from `import.meta.url` to the nearest `package.json` (cached; falls back to `process.cwd()`). Keeps asset paths identical when running from `src/` (vitest) and from the bundled `dist/cli.js`. |
| `confine.ts` | `realInside(rootDir, file)`: REAL-path (symlinks followed) containment, used before reading any user-named file under a deck dir (`validateAssets`, `embedFiles`, serve `repinAssets`). See change: deck3d-pptx-import. |
| `cleanup.ts` | `closeQuietly(target)`: release a browser/page/sandbox in `finally` without letting a failing `close()` decide the outcome or mask the real error. See change: deck3d-pptx-import. |
