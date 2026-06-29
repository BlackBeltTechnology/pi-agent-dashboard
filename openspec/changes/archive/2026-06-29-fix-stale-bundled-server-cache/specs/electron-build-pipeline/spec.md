## ADDED Requirements

### Requirement: Bundle freshness invalidation

`build-installer.sh` SHALL re-invoke `bundle-server.mjs` whenever ANY of the following sources is newer than `resources/server/.bundle-stamp`, OR the stamp file does not exist:

- `packages/server/src/` (recursive mtime)
- `packages/shared/src/` (recursive mtime)
- `packages/extension/src/` (recursive mtime)
- `packages/dashboard-plugin-runtime/src/` (recursive mtime)
- `packages/dist/index.html` (Vite client output; `packages/client/vite.config.ts` `outDir: ../dist`)
- `packages/electron/scripts/bundle-server.mjs`

The watched workspace packages SHALL mirror `BUNDLED_WORKSPACE_PKGS` in `bundle-server.mjs` (`server`, `shared`, `extension`, `dashboard-plugin-runtime`).

`bundle-server.mjs` SHALL write `<resources/server>/.bundle-stamp` ONLY on successful exit (post-verify passed).

#### Scenario: First build, no stamp file

- **WHEN** `build-installer.sh` runs AND `resources/server/.bundle-stamp` does not exist
- **THEN** the script SHALL run `bundle-server.mjs`

#### Scenario: Server source modified after last bundle

- **WHEN** `packages/server/src/server.ts` has an mtime newer than `resources/server/.bundle-stamp`
- **THEN** `build-installer.sh` SHALL re-invoke `bundle-server.mjs`
- **AND** SHALL NOT skip with "Bundled server already present"

#### Scenario: Shared protocol package modified after last bundle

- **WHEN** any file under `packages/shared/src/` has an mtime newer than `resources/server/.bundle-stamp`
- **THEN** `build-installer.sh` SHALL re-invoke `bundle-server.mjs`

#### Scenario: Client rebuilt after last bundle

- **WHEN** `packages/dist/index.html` mtime > `.bundle-stamp` mtime
- **THEN** `build-installer.sh` SHALL re-invoke `bundle-server.mjs`

#### Scenario: Cache is fresh

- **WHEN** the stamp file exists AND every watched source has mtime <= stamp mtime
- **THEN** the script SHALL skip the bundler invocation

### Requirement: Client materialization post-condition

`bundle-server.mjs` SHALL fail loudly (non-zero exit, error message identifying the failed step) when ANY of:

- `clientSrc` (built client directory) cannot be located.
- `<SERVER_BUNDLE>/node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html` does not exist after the materialization step completes.

The script SHALL NOT print a warning and continue under these conditions.

#### Scenario: No built client

- **WHEN** `bundle-server.mjs` runs AND neither `dist/client/` nor `packages/client/dist/` nor `packages/dist/client/` contains `index.html`
- **THEN** the script SHALL exit non-zero
- **AND** the error message SHALL instruct running `npm run build` first

#### Scenario: Materialization step did not place pi-dashboard-web

- **WHEN** the bundler completes its materialization step AND `<SERVER_BUNDLE>/node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html` does not exist
- **THEN** the script SHALL exit non-zero
- **AND** SHALL NOT write the stamp file

#### Scenario: Successful bundle

- **WHEN** every step of `bundle-server.mjs` succeeds AND the post-verify check passes
- **THEN** the script SHALL write `<SERVER_BUNDLE>/.bundle-stamp` with content `<git-sha>-<unix-ts>` (or equivalent identifier)
- **AND** SHALL exit zero

### Requirement: Repo-lint covering committed bundles

A vitest under `packages/shared/src/__tests__/` SHALL assert that for every `resources/server/` directory present in the workspace, `node_modules/@blackbelt-technology/pi-dashboard-web/dist/index.html` resolves (file or symlink).

#### Scenario: Committed bundle missing materialization

- **WHEN** the lint test runs AND a `resources/server/` directory exists without the expected `pi-dashboard-web/dist/index.html`
- **THEN** the test SHALL fail with a message naming the offending directory
