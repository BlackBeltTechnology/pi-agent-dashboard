# move-tracker.ts — index

In-flight package-move state tracker, keyed by `moveId`. Exports `MovePhase`, `MoveState`, `moveTracker` singleton. Listens for `package_operation_complete` WS event; advances phase `running`→`success`|`error`|`partial-success`; auto-clears success after 3s; keeps partial-success visible for user cleanup. Decoupled from `package-queue` (moveId-keyed, partial-success semantics). See change: unify-package-management-ui.


## reset-override-to-npm

`MoveState.kind?: "move"|"reset"` (default move). reset-to-npm reuses the exact moveId-keyed + partial-success machinery; only running/success copy differs (`Resetting\u2026`/`Reset complete`). `register()` accepts `kind`. See change: reset-override-to-npm.
