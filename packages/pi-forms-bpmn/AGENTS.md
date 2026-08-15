# DOX — packages/pi-forms-bpmn

pi package bundling two orthogonal, single-responsibility skills (NOT merged) plus
one shared canvas-render infra skill. Distribution cohesion only; each skill stays
focused. npm-workspace member of the pi-agent-dashboard monorepo.

## Files

| File | Purpose |
|------|---------|
| `package.json` | pi-package manifest. name `@blackbelt-technology/pi-dashboard-forms-bpmn`; `pi.skills` lists the 3 skill dirs; guarded `postinstall`→`scripts/ensure-openforms-deps.mjs`; `files` whitelist keeps tarball small (node_modules/canvas-dist excluded). Node ≥20.12. |
| `.gitignore` | Excludes working-copy artifacts: `**/node_modules`, `**/canvas-dist`, `**/dist`, `*.log`. |
| `README.md` | Why-bundled-not-merged rationale; install (`pi install`/`-l`/`-e` + `pi config`); canvas-webapp name-overlap caveat with the dashboard `extension` package; requirements. |
| `NOTICE` | Third-party attribution. OpenForms Apache-2.0 (clean-room schema, no vendored source); bpmn.io License (MIT + watermark obligation, do NOT disable); runtime dep licenses. |
| `scripts/ensure-openforms-deps.mjs` | Guarded postinstall. Installs `.pi/skills/openforms-mui/tools` deps ONLY if `node_modules/.package-lock.json` missing (nested tools/ is not a workspace member, so root install skips it). No-op otherwise; never fails the whole install. |

## Subfolders

- `.pi/skills/openforms-mui/` — MOVED from `~/.pi/agent/skills`. OpenForms→MUI runtime; bundler-based Vite lib under `tools/` (own package.json, React/MUI peer+dev). Owns its SKILL.md + `references/`. Canvas section points to `canvas-webapp`.
- `.pi/skills/bpmn-package-explorer/` — MOVED from `~/.pi/agent/skills`. Buildless/offline BPMN+DMN package generator/viewer; vendored bpmn.io viewers + Node layout bundle; `scripts/` CLIs; `assets/` vendored bundles + licenses.
- `.pi/skills/canvas-webapp/` — COPIED from `packages/extension/.pi/skills/canvas-webapp` (dashboard keeps its own copy). Shared infra: render a web app on the dashboard canvas (sandboxed opaque-origin iframe + relative-base static build + CORS static server). Carries a minimal `canvas-serve.mjs` in its SKILL.md.

## Notes

- **Not merged, bundled.** openforms (needs bundler+React/MUI) and bpmn (deliberately buildless/offline) have opposite build philosophies; merging would break bpmn's offline guarantee. The package is the cohesion unit.
- **canvas-webapp dup:** same-named skill also ships in the `extension` package. If both enabled on one machine, one shadows the other (identical content). Gate via `pi config`.
- After MOVE the two skills no longer auto-load from `~/.pi/agent/skills`; they load only when this package is installed (`pi install`). Register globally to keep them available everywhere.
