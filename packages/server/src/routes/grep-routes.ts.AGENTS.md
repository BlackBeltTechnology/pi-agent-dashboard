# grep-routes.ts — index

`GET /api/grep`: cwd admitted via `admitFileCwd` (pinned / workspace folders / worktrees of known repos); refusal 403 `unknown session path` + `code: "cwd_unknown"`, undecidable 503. Match filter anchors `[cwd, canonCwd?]`. `routeAdmission` dep (default = `sessionManager` session cwds). See change: core-file-cwd-admission. Earlier: See change: split-editor-workspace.
