# @blackbelt-technology/pi-dashboard-forms-bpmn

Two complementary **pi skills** for turning structured definitions into
interactive, canvas-viewable UI — bundled for distribution cohesion, kept as
**separate, single-responsibility skills** (not merged).

| Skill | What it does |
|-------|--------------|
| **openforms-mui** | Runtime interpreter that renders/authors an OpenForms `FormSchemaJSON` as idiomatic, themed, accessible **MUI** (React). 14 field types, conditional logic, calculated fields, validation. Bundler-based (Vite) library under `.pi/skills/openforms-mui/tools`. |
| **bpmn-package-explorer** | Generate + view vendor-neutral **BPMN 2.0** process packages (plus DMN decisions and forms). **Buildless & offline**: vendored bpmn-js / dmn-js viewers, Node layout bundle, no `npm install`, no network. |

## Why bundled, not merged

The two capabilities live in different domains (forms vs. process models) and
have **opposite build philosophies** — openforms needs a bundler + React/MUI;
bpmn deliberately avoids all installs to stay offline. Merging would force the
buildless skill to pull React/MUI and lose its offline guarantee. The **package**
is the unit of cohesion; the skills stay focused. Their only real overlap —
rendering on the dashboard canvas — is documented by the dashboard `extension`
package's own `canvas-webapp` skill (present in any pi-dashboard session); the
two skills cross-reference it by name.

## Install

```bash
# from the monorepo checkout (global, available in every pi session):
pi install /Users/<you>/…/pi-agent-dashboard/packages/pi-forms-bpmn
# or project-scoped:
pi install -l ./packages/pi-forms-bpmn
# try ephemerally, no persistence:
pi -e ./packages/pi-forms-bpmn

pi config   # enable/disable individual skills
```

On install a **guarded postinstall** (`scripts/ensure-openforms-deps.mjs`)
installs the openforms `tools/` dependencies **only if missing** — a cheap no-op
otherwise. The bpmn skill needs nothing installed.

> **Note — `canvas-webapp` is not bundled here.** The canvas-render recipe
> ships with the dashboard's own `extension` package as the `canvas-webapp`
> skill, which is present in any pi-dashboard session (the only place the canvas
> exists). The two skills above cross-reference it by name — no copy is kept
> here, so there is no name-shadowing.

## Requirements

- Node **≥ 20.12** (bpmn layout bundle floor).
- A browser for the canvas viewers.

## Rendering on the pi-dashboard canvas

Both skills serve web content the dashboard shows in a `sandbox="allow-scripts"`
(opaque-origin, no `allow-same-origin`) iframe proxied under `/live/<id>/`. See
the dashboard `extension` package's `canvas-webapp` skill for the full recipe:
static build with `base:'./'` + a static server that sets
`Access-Control-Allow-Origin: *` (module fetch in an opaque-origin iframe is
CORS with `Origin: null`).

## Attribution

See `NOTICE`. openforms-mui is a clean-room re-implementation from the OpenForms
schema reference (Apache 2.0); bpmn-package-explorer vendors bpmn.io viewers
under the **bpmn.io License** (MIT + a watermark obligation that is retained —
the bpmn.io watermark must stay visible in every rendered diagram).
