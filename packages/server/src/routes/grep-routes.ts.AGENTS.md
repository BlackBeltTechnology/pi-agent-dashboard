# grep-routes.ts — index

`GET /api/grep`: cwd admitted via `admitFileCwd` (pinned / workspace folders / worktrees of known repos); refusal 403 `unknown session path` + `code: "cwd_unknown"`, undecidable 503. Match filter anchors `[cwd, canonCwd?]`. `routeAdmission` dep (default = `sessionManager` session cwds). See change: core-file-cwd-admission. Earlier: See change: split-editor-workspace.
Result filter uses `decidePassive` with the hoisted `grantSubjects` + `containmentAllows`. See change: codeql-file-containment-barrier.
Fallback scan is worker-bounded: `GrepTimeoutError` → 504 `{success:false,error:"search timed out"}`; any other `runGrep` rejection → 500 `{success:false,error:"search failed"}`, never 200. Optional `deps.grep {scanTimeoutMs, scanWorkerUrl}` test seam. See change: triage-codeql-alert-debt (#216).

Gate 2b: drop matches whose `(dev,ino)` is an always-refused file (`alwaysRefusedIdentities` once per request, one `stat` per distinct path, stat failure = drop). See change: close-security-map-high-findings (D1).
