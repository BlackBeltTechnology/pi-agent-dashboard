# plugin-route-cwd.ts — index

`admitRouteCwdParam(raw, {required, knownCwds, admitOptions})`: plugin-route cwd boundary — shape (non-string → 400 `invalid_cwd`), presence (400 `cwd_required`), tri-state `admitCwd` (403 `not-allowed` / 503 `cwd-admission-unavailable` + `Retry-After: 1`); returns `release()` for the handler `finally`. `sendRouteCwdRefusal`. Used by automation + flows routes. See change: harden-git-terminal-plugin-boundaries.
