# Test Plan — electron-runtime-release-pipeline

Stage: design   Generated: 2026-09-28   (rows moved from electron-runtime-overlay-updates; ids kept)

---

## Scenarios

| # | Scenario | Technique | Level | Disposition | Input | Trigger | Observable |
|---|---|---|---|---|---|---|---|
| X10 | Crash detection preserved end-to-end | fault-injection | electron | automated | packaged app on overlay X; kill the server PID | observe the app | Loading/recovery page appears (existing crash handling), same as the bundled runtime |
| X11 | Full npm update cycle | end-to-end | electron | automated | packaged app 0.9.0 bundled; local verdaccio serving 0.9.1 with `runtime-lock.json` | Check → Update → Activate | `/api/health.runtime {origin:overlay, version:0.9.1}`; `settings.json` extension path under `versions/0.9.1`; first-party plugins listed in `/api/health.plugins[]` same as bundled |
| X12 | Broken overlay falls back to bundle | end-to-end | electron | automated | overlay 0.9.1 whose server exits at boot; no previous | Activate | `runtime.origin=bundled`; `lastFailure.version=0.9.1`; bundled extension re-registered |
| X16 | GitHub asset + beta dist-tag published | workflow assertion | ci | automated | release workflow on a prerelease tag | publish job | The asset + `.sha512` are attached; `npm dist-tag ls` shows `beta` = tag version; the manifest version equals the tag |
| X17 | Unpublished bundled plugin blocks the release | workflow assertion | ci + L1 | automated | a release X where one `bundledPlugins` package is absent from the registry at X | release gate step (task 2.2) | The release fails naming the missing package; no runtime asset is attached and dist-tags do not move |

## New infra needed

- **Local npm registry fixture for X11** (verdaccio) inside the electron E2E job, serving a fake 0.9.1 with `runtime-lock.json`.
