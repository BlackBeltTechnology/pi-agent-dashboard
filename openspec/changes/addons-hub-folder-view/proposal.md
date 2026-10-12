## Why

In Directory Settings the user's real question is "what will a session started in this folder load?" Today no page answers it: the folder Packages page shows only folder installs plus a recommended panel repeating global state, and the answer is spread over five Resources pages. A global add-on can be switched off per folder only file by file, and nothing says dashboard plugins are always global. Separately, problems (stale or duplicate `packages[]` entries, plugins with missing requirements) have no single place on the Add-ons page. This is phase 3 of 3 of the Add-ons hub.

## What Changes

- **CHANGED** folder Add-ons page (`/folder/:cwd/settings/add-ons`) becomes "Add-ons in this folder":
  - an **effective-set strip**: from Global + added in this folder − turned off here = what sessions here load (features + own `.pi/` files), with "applies to new sessions started here";
  - **Added in this folder** group: folder-scope packages (a filtered package says how many of its resources load), and one summary row for loose `.pi/` files linking to Resources;
  - **From Global** group: global features with a per-folder **"on here"** switch that turns off the feature's AI-agent part for this folder only; plugin-backed rows state that the dashboard UI stays because plugins are global;
  - **Dashboard-only features** group, collapsed, explaining that they apply to every folder;
  - a short "How global and folder add-ons combine" explainer; a **Discover** tab for installing into this folder.
- **NEW** catalog folder mode: `GET /api/addons/catalog?scope=folder&cwd=…` returns per-feature folder state (`inherited`, `off-here`, `added-here`) and loose-file counts.
- **NEW** folder toggle: `POST /api/addons/:featureId/toggle` with `{ scope: "folder", cwd, enabled }` writes / removes a project-scope package delta `{ source, autoload: false, extensions: [], skills: [], prompts: [], themes: [] }`, through the existing folder trust gate.
- **NEW** global **Issues** tab on the Add-ons page: plugins with missing requirements or load errors, plus the `packages[]` health groups from `add-package-health-cleanup`, with a count on the tab and on the rail item.

Mockup: `mockups/extensions-hub/folder.html` (folder) and the Issues tab in `mockups/extensions-hub/index.html`.

Depends on: `addons-hub-feature-catalog` (catalog + toggle endpoint) and `add-package-health-cleanup` (health API; the Issues tab renders only plugin issues until it lands).

## Non-goals

- Per-folder plugin enable/disable (plugins are global by design).
- The "Plugin settings · this folder" rail group — owned by `add-voice-assistant-dashboard-plugin` (`folder-settings-plugin-sections`).
- Editing a folder package's resource filter from this page (Resources keeps per-file toggles).
- Implementing the `packages[]` health scanner (owned by `add-package-health-cleanup`).

## Capabilities

### New Capabilities
- `addons-folder-view`: folder Add-ons page — effective-set strip, groups, per-folder feature switch, folder catalog mode, folder toggle write form.
- `addons-issues`: global Issues tab aggregating plugin requirement/load problems and package health.

### Modified Capabilities
None — `directory-settings-page` already requires the Add-ons page to keep the folder manage surface; this change fills it.

## Impact

- Server: folder mode in `addons-catalog.ts` + `addons-routes.ts`; project-delta writer reusing `resource-activation-toggle.ts` package-delta helpers (`autoload: false`, identity matching) and `resolveToggleTrust`; ownership record so re-enable removes only dashboard-written deltas.
- Client: `DirectorySettings/PackagesPage.tsx` replaced by a folder Add-ons view; Issues tab + counts on the global page.
- Compatibility: project `.pi/settings.json` gains standard pi delta entries only; a teammate without the dashboard gets the same pi behaviour. Rollback = revert; existing deltas keep working in pi and remain visible/removable in Resources.

## Discipline Skills

- `security-hardening`: writes into a project's `.pi/settings.json` (possibly git-tracked) and goes through the folder trust gate.
- `doubt-driven-review`: the delta write/remove path before it stands.
- `review-code`: before commit.
