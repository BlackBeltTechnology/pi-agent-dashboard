# pi-version-skew.ts — index

Pi compatibility range reader. `readPiCompatibility` reads `piCompatibility` from `packages/server/package.json`. `readCurrentPiVersion` via `createRequire` + `fs.realpathSync` on registry-resolved bin path. Pure helpers: `parseVersion`, `compareVersions`, `isBelow`, `isAbove`, `computeCompatibility`. `BootstrapCompatibility` interface kept inline (return type for the pure helpers). `updateBootstrapCompatibility` + cache + CLI warning removed under R3. See change: eliminate-electron-runtime-install. `BootstrapCompatibility` gains `error?: string`; `computeCompatibility` sets `error` naming both versions when current below minimum. See change: restore-pi-version-skew-surface.

Exports `computePiBelowFloor(version, minimum)` → `{minimum}` iff parseable AND below, else `null`; `serverPiMinimum()` — cached `piCompatibility.minimum` from the server package.json. See change: update-pi-core-1-0-adopt-apis.

`computePiBelowFloor` also flags a pre-release of the floor (`1.0.0-beta.1` vs `1.0.0`); build metadata does not lower precedence. Shared `isBelow` unchanged. See change: update-pi-core-1-0-adopt-apis (review B1/B2).

Local `isBelowFloor(version, minimum)` (pre-release-aware) backs BOTH floor checks: `computeCompatibility` error (`/api/health` advisory) and `computePiBelowFloor`. `computePiBelowFloor` also requires a whole-string SemVer (`STRICT_VERSION_RE`) — `0.99.9garbage` raises no flag. See change: update-pi-core-1-0-adopt-apis (review round 2 B1/B2).
