# pi-version-skew.ts — index

Pi compatibility range reader. `readPiCompatibility` reads `piCompatibility` from `packages/server/package.json`. `readCurrentPiVersion` via `createRequire` + `fs.realpathSync` on registry-resolved bin path. Pure helpers: `parseVersion`, `compareVersions`, `isBelow`, `isAbove`, `computeCompatibility`. `BootstrapCompatibility` interface kept inline (return type for the pure helpers). `updateBootstrapCompatibility` + cache + CLI warning removed under R3. See change: eliminate-electron-runtime-install. `BootstrapCompatibility` gains `error?: string`; `computeCompatibility` sets `error` naming both versions when current below minimum. See change: restore-pi-version-skew-surface.

Exports `computePiBelowFloor(version, minimum)` → `{minimum}` iff parseable AND below, else `null`; `serverPiMinimum()` — cached `piCompatibility.minimum` from the server package.json. See change: update-pi-core-1-0-adopt-apis.


Local `isBelowFloor(version, minimum)` = `semver.lt` when both sides are valid SemVer (full identifier validation + pre-release precedence), else shared `isBelow`; backs BOTH floor checks: `computeCompatibility` error (`/api/health` advisory) and `computePiBelowFloor`. `computePiBelowFloor` → `null` unless `semver.valid(version)` (e.g. `0.99.9garbage`, `0.99.9-01` raise no flag). See change: update-pi-core-1-0-adopt-apis (review rounds 1-3).

`readCurrentPiVersion` by-name probe earendil-only; registry fallback reads whatever manifest the `pi` bin realpaths into (scope-agnostic). See change: drop-mariozechner-pi-fork.
