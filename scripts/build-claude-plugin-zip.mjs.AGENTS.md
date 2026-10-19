# build-claude-plugin-zip.mjs — index

Zips `packages/claude-plugin/` (manifest at zip root) to `pi-dashboard-claude-plugin-<v>.zip`; fails when `plugin.json` version ≠ `--version`. Called by `publish.yml` `github-release`. See change: add-claude-code-plugin.
