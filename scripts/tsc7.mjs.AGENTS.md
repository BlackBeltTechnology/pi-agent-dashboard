# tsc7.mjs — index

Single wrapper for the TypeScript 7 compiler (`typescript-7` = npm alias of `typescript@7.0.2`). Resolves `typescript-7/package.json` via `createRequire`, spawns its `bin.tsc` with `process.execPath`, forwards argv/stdio/exit code; alias missing → exit 1, one stderr line naming `typescript-7` + `pnpm install`. Every type-check/`tsc` build calls it, never bare `tsc` (alias bin owns `node_modules/.bin/tsc`). Rollback = point `pkgName` at `typescript`. See change: migrate-typecheck-to-ts7.
