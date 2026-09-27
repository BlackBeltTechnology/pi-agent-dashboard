# DOX — packages/server/src/runtime-overlay

Files in this directory. One row per source file. Server side of the Electron runtime overlay. See change: electron-runtime-overlay-updates.

| File | Purpose |
|------|---------|
| `runtime-health.ts` | `/api/health.runtime` (D10). `buildRuntimeHealth({env, serverVersion, readRequest, readState, localSnapshot?})` → `RuntimeHealth {origin, id, version, updatable, source?, channel?, pin?, pending?, gitSha?, dirty?, lastFailure?}`; identity from `PI_DASHBOARD_RUNTIME_ID`/`_ORIGIN`; non-Electron → `npmGlobal`, not updatable; `updatable` only electron and origin ≠ devMonorepo; never throws. `createRuntimeHealthProvider` caches: handler does no fs (CodeQL), Electron refresh every 2 s, git snapshot once. `owner` = `PI_DASHBOARD_ELECTRON_INSTANCE` (switch ownership). `redactRuntimeHealth` for unauthenticated non-local callers: local id → `local`, drops `gitSha`/`dirty`/`lastFailure`/`owner`. Test: `__tests__/runtime-health.test.ts` (E20). |
