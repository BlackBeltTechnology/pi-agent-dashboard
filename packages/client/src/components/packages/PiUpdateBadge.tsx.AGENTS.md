# PiUpdateBadge.tsx — index

Header badge counting available pi-core updates. Exports `PiUpdateBadge`. Reads `usePiCoreVersions().status`; hidden when status missing or `updatesAvailable === 0`. Click navigates to `/settings/packages` via `wouter`.
