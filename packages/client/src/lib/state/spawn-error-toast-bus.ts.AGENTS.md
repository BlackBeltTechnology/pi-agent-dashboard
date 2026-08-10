# spawn-error-toast-bus.ts — index

Module-singleton bus for off-screen `spawn_error` toasts. `pushSpawnErrorToast({cwd, code, message, requestId?})`, `subscribeSpawnErrorToasts(listener)`, `dismissSpawnErrorToast(id)`. 10 s auto-dismiss via `SPAWN_ERROR_TOAST_DURATION_MS`. De-dupes by requestId (filter prior entry on push). Message body truncated to 200 chars. `__resetSpawnErrorToastBusForTests()` test hook. See change: harden-worktree-spawn.
