# SUPERSEDED by `eliminate-electron-runtime-install`

Date: 2026-05-23
Superseder: `openspec/changes/eliminate-electron-runtime-install/`

## Reason

This change addressed Node-binary resolution in `pick-node.ts` (the
system-vs-bundled selection logic with version-safety preferences).
Under the immutable-bundle architecture introduced by
`eliminate-electron-runtime-install`, there is only one Node binary —
the bundled one inside the `.app`/`.deb`/`.AppImage`/`.exe`. The whole
preference chain collapses to a single bundled path. The 6 remaining
tasks here are subsumed by Phase 4 task 4.4 of the superseder
("`pick-node.ts` — always return bundled node path; delete
`pickNodeForServer` system-vs-bundled logic").

## Salvage

The existing 28/34 completed tasks landed real fixes on `develop`
(`launch-source.ts` attach-first probe, `selectLaunchSource` ordering,
`ensure-windows-path.ts`). Those survive untouched.

The 6 outstanding tasks are absorbed into Phase 4 of the superseder.

Disposition: close once Phase 4 of the superseder lands.

See `eliminate-electron-runtime-install/proposal.md` "Supersedes /
interacts with in-flight work" table.
