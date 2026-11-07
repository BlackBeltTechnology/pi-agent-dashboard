# pi-path-compare.ts — index

Mirror of pi 1.5 `getPathComparisonKey`/`pathsEqual` (`utils/paths.js`). `nativePathApi()` (win32 vs posix, read at call time), `piPathComparisonKey(p, pathApi?)` (resolve; lower-case on win32), `piPathsEqual(a, b, pathApi?)`. No fs access. Users: `nearestRecordedEntry`, server `resource-toggle-trust.ts`, `pi-trust-resource-digest.ts`. See change: update-pi-core-1-5-adopt-apis.
