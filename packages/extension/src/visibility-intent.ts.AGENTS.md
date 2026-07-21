# visibility-intent.ts — index

Resolves `session_register` visibility fields. Exports `resolveVisibilityIntent`, `buildVisibilityRegisterFields`. `PI_DASHBOARD_VISIBLE` beats `PI_DASHBOARD_HIDDEN`; absent ⇒ undefined (server auto-hide heuristic). Emits `{ hasUI?, visibilityIntent? }` slice omitting absent fields. See change auto-hide-headless-worker-sessions.
