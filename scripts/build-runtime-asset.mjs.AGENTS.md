# build-runtime-asset.mjs — index

`node --import tsx … --version X --out DIR [--lock FILE]`: runs consumer `stageRuntime` (npm source; server@X `runtime-lock.json`) → `pruneBinLinks` (`.bin` symlinks removed, any other symlink throws — consumer refuses link members) → `tar -czf` of root entries (relative paths, no `./`) → `pi-dashboard-runtime-<X>-<platform>-<arch>.tgz` + `.sha512` (`<hex>  <name>`). Exports `buildRuntimeAsset`, `stagerDeps`. See change: electron-runtime-release-pipeline (R3).
