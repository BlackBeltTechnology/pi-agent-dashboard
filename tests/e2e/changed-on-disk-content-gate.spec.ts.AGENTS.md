# changed-on-disk-content-gate.spec.ts — index

L3 spec (change: gate-changed-on-disk-by-content, test-plan F16–F18). External writers are `docker exec` shell commands (`resolveContainer()`), because only those produce the raw `touch` / identical in-place rewrite / identical tmp+rename events the watcher sees.

- F16: `gcd-<token>.ts` open in the session pane (`/session/:id/editor?file=`). `touch`, identical rewrite, identical atomic rename → no `changed-on-disk-banner`; a different write → banner.
- F17: `gcd-<token>.md` in `md-edit-toggle` Monaco; own Save (`md-save-btn`) → no banner (rebaselined from write `sha1`); a later external write → banner.
- F18: ~30 MiB `gcd-big-<token>.md` → `too-large-preview` naming 10 MB; `PUT /api/config { editor: { largeFileLimitMb: 64 } }` (no restart) → `md-edit-toggle` appears live, no reload.

Self-isolating: unique token per run, files removed and the editor limit reset to 10 in `afterEach`. See change: gate-changed-on-disk-by-content.
