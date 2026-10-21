# build-version.ts — index

Windows-safe build version helper. Exports `deriveWindowsBuildVersion(pkgVersion, runNumber)` → 4-integer `MAJOR.MINOR.PATCH.RUN_NUMBER` for PE VERSIONINFO resource (packager `resedit.js` rejects SemVer prerelease slugs). Pure function, env reads in caller.
