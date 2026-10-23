# secret-rotation.ts — index

`rotateSecretsOnce()` at start of `createServer` (after `decideBootTrustMode`): link-claimed `local/rotation.lock` (stale 30 s / dead pid, wait cap 35 s), `local/rotation-epoch` < `REQUIRED_ROTATION_EPOCH` (1) → new 0600 `local/token` + new `auth.secret` (`writeConfigFileSecure`) then epoch LAST. Failure = `RotationError` (step lock|token|secret|epoch, one-line `describe()`), server exits 1 before listening. `close-loopback-legacy-window` reuses the lock and raises the epoch to 2. See change: close-container-loopback-impersonation (D11).
