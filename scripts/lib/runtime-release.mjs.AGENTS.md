# runtime-release.mjs — index

Shared by runtime release scripts: `SERVER_PACKAGE`, `RUNTIME_BASE_PACKAGES` (no meta), `RUNTIME_ASSET_TARGETS` (native-runner legs; no win32-arm64), `runtimeAssetName` (= consumer `githubAssetName`), `bundledPluginPackages(repoRoot)`, `npmArgv`/`runNpm` (npm-cli.js beside `process.execPath`, no shell), `parseFlags`. See change: electron-runtime-release-pipeline.

`collectPluginRuntimeDeps({plugins, workspaces})` / `pluginRuntimeDeps(repoRoot)`: union of bundled plugins' third-party `dependencies` (no first-party/peer/dev/optional); identical specifier required across plugins + server-side workspaces (server, shared, extension, plugin-runtime — not web, a Vite bundle) else throw listing each; `:`/`/` specifiers rejected. Mirrors bundle-plugin-third-party-deps D1/D3. Task 2.6.
