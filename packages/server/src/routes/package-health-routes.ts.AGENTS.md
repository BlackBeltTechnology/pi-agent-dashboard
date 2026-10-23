# package-health-routes.ts — index

`registerPackageHealthRoutes`. `GET /api/packages/health` (scan global `packages[]`). `POST /api/packages/cleanup {drop[]}`: runs under `runExclusive`, unknown source → 400 `{unknown}` before any write, `.bak` copy, atomic rewrite preserving other keys, then `invalidateAllPackageManagers()`. Empty drop → no-op, no backup. See change: add-package-health-cleanup.
