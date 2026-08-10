# pi-dev-version-check.ts — index

pi.dev version-check client. Queries `https://pi.dev/api/latest-version`; returns `{version, packageName?}` or `undefined` on network error / non-2xx / `PI_OFFLINE` / `PI_SKIP_VERSION_CHECK`. Mirrors pi's self-update check. Exports `getLatestPiRelease`, `PiDevReleaseInfo`, `PiDevVersionCheckOptions` (`timeoutMs` 10s, `fetchImpl` test seam). See change: improve-pi-update-detection.
