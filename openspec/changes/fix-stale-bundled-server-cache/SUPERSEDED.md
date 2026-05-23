# SUPERSEDED by `eliminate-electron-runtime-install`

Date: 2026-05-23
Superseder: `openspec/changes/eliminate-electron-runtime-install/`

## Reason

This change addresses a failure mode (`~/.pi-dashboard/` cache going stale
relative to the bundled `.app` resources) that is a **property of runtime
extraction**. Under the immutable-bundle architecture introduced by
`eliminate-electron-runtime-install`, there is no runtime extraction —
the server runs directly from `process.resourcesPath/server/`. The
stale-cache failure mode cannot occur.

Disposition: close entirely. No tasks salvaged.

See `openspec/changes/eliminate-electron-runtime-install/proposal.md`
"Supersedes / interacts with in-flight work" table for the architectural
rationale.
