# bridge-register.ts — index

Registers bundled bridge extension into `~/.pi/agent/settings.json`. Exports `registerBundledBridgeExtension()`. `findBundledExtension()` locates extension dir via `process.resourcesPath` (packaged) or dev path; rejects AppImage `/tmp/.mount_` paths. Delegates to shared `registerBridgeExtension`.
