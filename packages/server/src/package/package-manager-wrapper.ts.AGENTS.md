# package-manager-wrapper.ts — index

Thin serialized adapter around pi's `DefaultPackageManager`. Exports `PackageManagerWrapper`, `OperationRequest`, `OperationResult`, `MoveRequest`, `ProgressEvent`, `translatePathSource`, `diagnosePiPackageManager`, `ModuleResolutionError`, `AlreadyAtDestinationError`, `InvalidMoveRequestError`, `UnsupportedSourceForDestinationError`, `PackageOperationBusyError`, `PackageEntry`. Wraps spawns in `SafePackageManager` (OS-aware adapter, registry-resolved executors) to fix Windows cmd flashes. Busy-lock single-flight; `run`/`move`/`listInstalled`/`checkUpdates`/`runExclusive`; per-cwd cached PM; session reload on success.


## reset-override-to-npm

Adds `reset(ResetRequest{source,publishedSource,scope,cwd?})` \u2192 `resetId`, and `InvalidResetRequestError`. `executeReset` mirrors `executeMove`: install `publishedSource` FIRST, then remove local `source` (same scope); install-fail leaves local intact + reports failure; remove-fail after install \u2192 `partialSuccess`. Emits one complete event `action:"reset"`, `moveId=resetId`. `PackageAction` union += `"reset"`. See change: reset-override-to-npm.
