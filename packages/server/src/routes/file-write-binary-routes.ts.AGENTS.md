# file-write-binary-routes.ts — index

Save cwd admitted via `admitFileCwd` (async `resolveHandler`, guarded cwd threaded to `isWritableHandlerTarget`; `Outcome.headers` applied in `send`): refusal 403 `unknown session path` + `code: "cwd_unknown"`; undecidable 503 + `Retry-After: 1` + shared body, nothing written. `routeAdmission` dep (default = `sessionManager` session cwds). See change: core-file-cwd-admission. Earlier: See change: extend-craft-web-to-all-apps (D6).

`sha1OfFile` reads via `openStateChecked`; `DashboardStateRefused` → 403 `target is not a writable handler file in scope` (no sha1). See change: close-security-map-high-findings (D1).
