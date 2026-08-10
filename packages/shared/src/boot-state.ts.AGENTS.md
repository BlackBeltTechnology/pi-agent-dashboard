# boot-state.ts — index

Exit-intent vocabulary for the server boot record. Exports `ExitIntent` (`restart`/`shutdown`/`user-quit`/`idle`/`signal`), `BootRecord`, `BootState`, `BOOT_RING_SIZE` (8), `isRecoveryAllowed(intent)`. Suppresses recovery ONLY for `restart`+`shutdown` — the exits that leave sessions running AND announce a bridge quiesce longer than the reattach grace window; everything else defers to the liveness gate. See change: fix-recovery-exit-intent.
