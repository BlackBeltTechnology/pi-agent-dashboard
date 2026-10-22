# file-write-binary-routes.ts — index

Save cwd admitted via `admitFileCwd` (async `resolveHandler`, guarded cwd threaded to `isWritableHandlerTarget`; `Outcome.headers` applied in `send`): refusal 403 `unknown session path` + `code: "cwd_unknown"`; undecidable 503 + `Retry-After: 1` + shared body, nothing written. `routeAdmission` dep (default = `sessionManager` session cwds). See change: core-file-cwd-admission.
