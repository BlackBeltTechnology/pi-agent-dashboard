# registry-shed-sidebar-convergence.spec.ts — index

L3 #F7 (close-registry-frame-shed-gaps). Drives `POST /api/test/force-shed` (needs `PI_E2E_FORCE_SHED=1`), ends one session and REST-spawns another during the blackout, asserts `droppedFrames.statusReconcileQueued` advanced and the UI is wrong (B rowless, A still live), then drains: B gets a row (reconciled `session_added`), A leaves the live list for its ended bucket, `statusReconcileSent` advanced, URL unchanged. Scoped per-row by cwd. `afterEach` always releases the process-wide injector.
