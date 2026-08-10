# collapse-retried-errors.ts — index

ChatView duplicate-collapse helpers. `findRetriedErrorIds` flags failed `toolResult` superseded by successful same-tool retry. `findActiveInteractiveToolResultIds` hides running toolResult paired with pending `interactiveUi`. `findSurfaceSuppressedErrorIds` collapses trailing failed toolResult when error-lifecycle `surfaceActive`. See change: unify-error-retry-lifecycle.
