# runtime-release.mjs — index

Shared by runtime release scripts: `SERVER_PACKAGE`, `RUNTIME_BASE_PACKAGES` (no meta), `RUNTIME_ASSET_TARGETS` (native-runner legs; no win32-arm64), `runtimeAssetName` (= consumer `githubAssetName`), `bundledPluginPackages(repoRoot)`, `npmArgv`/`runNpm` (npm-cli.js beside `process.execPath`, no shell), `parseFlags`. See change: electron-runtime-release-pipeline.
