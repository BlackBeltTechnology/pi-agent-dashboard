# electron-build-pipeline — delta

## ADDED Requirements

### Requirement: Bundle-mode stamp written by every `bundle-server.mjs` run
At the end of every run, `packages/electron/scripts/bundle-server.mjs` SHALL write a file `resources/server/.bundle-mode.json` recording the install mode of the produced bundle. The file SHALL be a JSON object with exactly these fields:

| Field | Type | Meaning |
|---|---|---|
| `mode` | `"full"` \| `"source-only"` | `full` when `npm install --omit=dev` ran; `source-only` when `--source-only` was passed. |
| `bundledAt` | ISO-8601 string | UTC timestamp captured at the start of the bundle run. |
| `npmInstallSucceeded` | boolean | `true` only when `mode === "full"` AND `npm install` exited with status 0. Always `false` for `mode === "source-only"`. |
| `bundleScriptCommit` | string \| null | Output of `git rev-parse HEAD` from the repo root, best-effort; `null` if git is unavailable or the script runs outside a checkout. |

The stamp SHALL be written under both code paths — source-only short-circuit and full-install completion — so no produced bundle is ever stampless.

#### Scenario: Source-only build stamps the bundle
- **WHEN** `node packages/electron/scripts/bundle-server.mjs --source-only` completes successfully
- **THEN** `resources/server/.bundle-mode.json` SHALL exist with `mode === "source-only"` and `npmInstallSucceeded === false`

#### Scenario: Full build stamps the bundle
- **WHEN** `bundle-server.mjs` runs without `--source-only` and `npm install --omit=dev` exits 0
- **THEN** `resources/server/.bundle-mode.json` SHALL exist with `mode === "full"` and `npmInstallSucceeded === true`

#### Scenario: Stamp is not a security boundary
- **WHEN** any consumer reads the stamp
- **THEN** the stamp SHALL be treated as a non-authenticated hint; consumers SHALL NOT use it for trust decisions, only for diagnostic / user-experience purposes

#### Scenario: Stamp survives forge packaging
- **WHEN** `electron-forge package` copies `resources/server/` into the installer
- **THEN** `.bundle-mode.json` SHALL be present in the unpacked installer's `resources/server/` directory and SHALL be readable at runtime via `path.join(process.resourcesPath, "server", ".bundle-mode.json")`
