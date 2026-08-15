# DOX — packages/pi-forms-bpmn

pi package bundling two orthogonal, single-responsibility skills (NOT merged).
Distribution cohesion only; each skill stays focused. npm-workspace member of the
pi-agent-dashboard monorepo. The canvas-render recipe is NOT bundled here — it
lives in the dashboard `extension` package's `canvas-webapp` skill (see Notes).

## Files

| File | Purpose |
|------|---------|
| `package.json` | pi-package manifest. name `@blackbelt-technology/pi-dashboard-forms-bpmn`; `pi.skills` lists the 2 skill dirs (openforms-mui, bpmn-package-explorer); guarded `postinstall`→`scripts/ensure-openforms-deps.mjs`; `files` whitelist keeps tarball small (node_modules/canvas-dist excluded). Node ≥20.12. |
| `.gitignore` | Excludes working-copy artifacts: `**/node_modules`, `**/canvas-dist`, `**/dist`, `*.log`. |
| `README.md` | Why-bundled-not-merged rationale; install (`pi install`/`-l`/`-e` + `pi config`); note that the canvas-render recipe lives in the dashboard `extension` package's `canvas-webapp` skill (not bundled here); requirements. |
| `NOTICE` | Third-party attribution. OpenForms Apache-2.0 (clean-room schema, no vendored source); bpmn.io License (MIT + watermark obligation, do NOT disable); runtime dep licenses. |
| `scripts/ensure-openforms-deps.mjs` | Guarded postinstall. Installs `.pi/skills/openforms-mui/tools` deps ONLY if `node_modules/.package-lock.json` missing (nested tools/ is not a workspace member, so root install skips it). No-op otherwise; never fails the whole install. |

## Subfolders

- `.pi/skills/openforms-mui/` — MOVED from `~/.pi/agent/skills`. OpenForms→MUI runtime; bundler-based Vite lib under `tools/` (own package.json, React/MUI peer+dev). Owns its SKILL.md + `references/`. Canvas section cross-references the dashboard extension's `canvas-webapp` skill.
- `.pi/skills/bpmn-package-explorer/` — MOVED from `~/.pi/agent/skills`. Buildless/offline BPMN+DMN package generator/viewer; vendored bpmn.io viewers + Node layout bundle; `scripts/` CLIs; `assets/` vendored bundles + licenses.

## Notes

- **Not merged, bundled.** openforms (needs bundler+React/MUI) and bpmn (deliberately buildless/offline) have opposite build philosophies; merging would break bpmn's offline guarantee. The package is the cohesion unit.
- **canvas-webapp not bundled here:** the canvas-render recipe lives ONLY in the dashboard `extension` package (its `canvas-webapp` skill), present in any dashboard session — the only context where the canvas exists. The two skills cross-reference it by name; no copy is kept here, so there is no name-shadowing. (It was briefly bundled at 0.7.0, then dropped once verified byte-identical to the extension copy.)
- After MOVE the two skills no longer auto-load from `~/.pi/agent/skills`; they load only when this package is installed (`pi install`). Register globally to keep them available everywhere.
