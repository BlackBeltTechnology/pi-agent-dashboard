# DOX — packages/deck3d/src/util

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `paths.ts` | `pkgRoot()` — walks up from `import.meta.url` to the nearest `package.json` (cached; falls back to `process.cwd()`). Keeps asset paths identical when running from `src/` (vitest) and from the bundled `dist/cli.js`. |
