# package-queue.ts — index

Package operation FIFO scheduler singleton — single source of truth for install/remove/update ops across client. Exports `PackageQueue` class + `packageQueue` singleton, types `PackageScope`, `PackageAction`, `PackageOperationStatus`, `EnqueueRequest`, `RunningOp`. Owns one running op + pending queue + per-`source` status map; advances on `package_operation_complete` WS event; retry-once on 409; source-fallback matching during null-opId window. See change: fix-local-path-install-spinner.
