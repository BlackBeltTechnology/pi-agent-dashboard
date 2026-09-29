# bridge-register.ts — index

Shared bridge registration: `findBundledExtension(baseDir)` + `registerBridgeExtension(path)`; non-destructive cleanup, AppImage guard. Used by server startup and Electron wizard. `registerBridgeExtension` always drops other same-identity entries (even when target already registered), keeps target position, skips write when unchanged, writes durably (fsync + rename) (E15). See change: electron-runtime-overlay-updates. `{strict: true}` rethrows write failures.
