# SpawnErrorToastHost.tsx — index

App-level toast container for off-screen `spawn_error` events. Subscribes to `spawn-error-toast-bus` singleton on mount. Mounted in `App.tsx` next to existing `<Toast>`. Renders red toast cards top-right; dismiss button calls `dismissSpawnErrorToast(id)`. Testid `spawn-error-toast-host` + `spawn-error-toast-<id>`. See change: harden-worktree-spawn.
