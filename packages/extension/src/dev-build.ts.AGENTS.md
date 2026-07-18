# dev-build.ts — index

Dev build-on-reload helper. Exports `runDevBuild`, `DevBuildOptions`. Runs `npm run build` in package root, POSTs `/api/shutdown` to server port. Never throws; injectable `_execSync`/`_fetch` for tests.
