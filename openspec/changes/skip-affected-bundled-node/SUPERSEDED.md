# PARTIALLY SUPERSEDED by `eliminate-electron-runtime-install`

Date: 2026-05-23
Superseder: `openspec/changes/eliminate-electron-runtime-install/`

## Reason

This change skipped a known-bad bundled Node version range
(nodejs/node#58515). Most of its scope concerns runtime-install behavior
on Electron — under the immutable-bundle architecture introduced by
`eliminate-electron-runtime-install`, the Electron arm always runs under
the single bundled Node and the system-Node fallback is removed
(`pick-node.ts` collapses to bundled-only). The version-skip logic for
the Electron path is therefore vestigial.

## Salvage

Standalone-arm-relevant work (the `isKnownBadNode` predicate, the
node-guard refusal range, the engine-strict bypass for the CI smoke
matrix) is salvaged into `eliminate-electron-runtime-install` Phase 1 /
Phase 9 via the inherited CI smoke matrix from
`enable-standalone-npm-install` (now archived).

Disposition: close once Phase 1 lands and the standalone CI matrix
continues to pass.

See `eliminate-electron-runtime-install/proposal.md` for details.
