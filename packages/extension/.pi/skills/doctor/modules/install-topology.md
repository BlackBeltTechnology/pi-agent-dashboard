---
name: install-topology
scope: Detect the install topology and route fixes to the matching remediation.
symptoms:
  - how is this installed
  - electron read-only
  - docker install
  - npm global install
  - which topology
  - cant edit bundled files
depends-on:
  - env-node
derives-from:
  - process.execPath / resourcesPath (Electron marker, live)
  - /.dockerenv + PI_WORKSPACES env (Docker marker, live)
  - npm root -g (npm-global marker, live)
  - repo .git + package.json workspaces (dev marker, live)
---

## SCOPE
Detect npm-global / Electron bundle / Docker / dev-checkout and route every
fix to the topology-correct remediation, including the Electron bundle being
immutable.

## KNOWLEDGE
The same failure has a different fix per topology. Markers:
- **Electron bundle**: running under `process.resourcesPath`; server + pi live
  under `Resources/`. The bundle is READ-ONLY — never "just edit" a file there;
  the fix is "update the app".
- **Docker**: `/.dockerenv` present; `PI_WORKSPACES` mounts; fix = rebuild image
  or edit the mounted workspace, not the container FS.
- **npm-global**: pi/dashboard under `npm root -g`; fix = `npm i -g` upgrades.
- **dev checkout**: repo `.git` + workspace `package.json`; fix = local
  `npm install` / `npm run build` / source edits.

## CHECKS
- Electron: `node -e "console.log(process.resourcesPath || '')"` non-empty, or
  `process.execPath` inside an `.app`/`AppImage`.
- Docker: `test -f /.dockerenv` and `printenv PI_WORKSPACES`.
- npm-global: `npm root -g` contains the dashboard/pi package.
- dev: `git rev-parse --show-toplevel` resolves to a repo with `packages/`.

## FIX ROUTING
- **Electron** → immutable: direct the user to update/reinstall the app; do NOT
  propose editing bundled files. See `docs/electron-bootstrap-flow.md`.
- **Docker** → rebuild image (`docker compose up -d --build`) or edit the
  mounted workspace.
- **npm-global** → `npm i -g <pkg>@<version>`.
- **dev** → `npm install`, `npm run build`, `POST /api/restart`, `npm run reload`.

## DERIVES-FROM
Live: `process.resourcesPath`, `/.dockerenv`, `PI_WORKSPACES`, `npm root -g`,
repo `.git`. Hash sidecar: `install-topology.knowledge.hash`.
