# generate-runtime-lock.mjs — index

`--version X [--registry URL] [--out FILE]` → `packages/server/runtime-lock.json` (lockfile v3; gitignored, in server `files`). Root = server/web/extension/plugin-runtime + every `bundledPlugins` pkg at X (no meta). Server packed locally as `file:` then rewritten to registry tarball URL w/o integrity (self-reference). `npm install --package-lock-only --allow-remote=all` (npm 12 EALLOWREMOTE). `finalizeRuntimeLock` rejects root≠X, missing pkg, first-party≠X anywhere, leftover `file:`. Runs after every other pkg is published, before server. See change: electron-runtime-release-pipeline (R1).

`--server-dir DIR` packs a prepared server dir (E2E fixture's rewritten tarball) instead of packages/server; `--out` defaults to `<server-dir>/runtime-lock.json`.
