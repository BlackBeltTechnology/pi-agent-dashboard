# package-queue.ts — index

Package operation FIFO scheduler singleton — single source of truth for install/remove/update ops across client. Exports `PackageQueue` class + `packageQueue` singleton, types `PackageScope`, `PackageAction`, `PackageOperationStatus`, `PackageOpKind`, `EnqueueRequest`, `RunningOp`, plus `PI_CORE_SOURCE_PREFIX` + `piCoreSource(name)`. Owns one running op + pending queue + per-`source` status map; advances on `package_operation_complete` WS event; retry-once on 409 (`scheduleRetry`, shared by both arms); source-fallback matching during null-opId window. See change: fix-local-path-install-spinner.

## unify-pi-core-into-package-queue

Queue handles BOTH extension and pi-core ops — same FIFO, because both contend for the one server-side `PackageManagerWrapper.busy` lock.

- `kind: "extension" | "pi-core"` on `EnqueueRequest` (optional, defaults `"extension"`), `RunningOp`, `QueuedOp`. `postOperation` is an exhaustive `switch (op.kind)` → `postExtensionOperation` / `postPiCoreUpdate`. `kind` is the dispatch key.
- Pi-core source key convention `pi-core:<scoped-npm-name>` (e.g. `pi-core:@mariozechner/pi-coding-agent`) via `piCoreSource(name)`. Convention only — never used for dispatch.
- `postPiCoreUpdate` POSTs `/api/pi-core/update` with a single-name batch `{packages:[name]}` and completes from the RESPONSE BODY (`body.data.results[0]`), not from a WS event.
- Dual subscription: `pi-package-event` (`onWindowEvent`) + `pi-core-event` (`onPiCoreEvent`). `pi_core_update_progress` updates `running.message`; **`pi_core_update_complete` is a deliberate no-op** — the server broadcasts it before returning the HTTP response, so it lands FIRST and would complete the op early (design R4).
- `isAnyRunning(): boolean` — public primitive for cross-domain UI locking. No consumer yet (D9 deferred).

See change: unify-pi-core-into-package-queue.
