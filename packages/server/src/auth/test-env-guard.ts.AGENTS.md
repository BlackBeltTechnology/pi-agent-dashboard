# test-env-guard.ts — index

Exports `isUnsafeTestHomeScan()` — defense-in-depth against destructive PID-registry sweeps during vitest against real $HOME. Returns true when `VITEST` set AND HOME points at real user home. Callers warn + skip destructive work.
