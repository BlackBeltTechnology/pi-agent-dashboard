## Why

Plugin apps (`add-plugin-app-host`) can embed per folder, but a plugin cannot say *which* folders an app belongs to. A team building a JUDO-type tool wants one app on every JUDO project, and a customer team wants one app on one specific repo. Today the dashboard has no notion of a folder's project type or identity (no identity file reader, no type field anywhere in `packages/`), so each plugin would hand-roll detection, and deep links open the app on any folder.

## What Changes

- **NEW** folder project identity, owned by core:
  - **Declared**: `<cwd>/.pi/dashboard/project.json` `{ "schemaVersion": 1, "id"?: string, "type"?: string }`. Committed with the repo, survives moves and clones, kept in the dashboard's own `.pi/dashboard/` namespace.
  - **Detected**: a plugin manifest MAY declare `projectTypes: [{ type, markers: [...] }]`, root-anchored relative path patterns. Core matches the rules of enabled plugins in one bounded, symlink-free walk.
  - **Precedence**: a declared `type` wins. Without one, every type whose markers match is reported.
- **NEW** core endpoint `GET /api/folder/project?cwd=…` → `{ id: string|null, types: string[], source: "declared"|"detected"|"none", truncated?: true }`.
  - It sits behind the network guard and the shared tri-state cwd admission (403 / 503).
  - It never raises an operator prompt and never writes.
- **NEW** runtime client helpers: a per-folder project cache (`loading` / `ready` / `error`, with a 60 s error retry), a hook, and predicate factories `folderHasProjectType(type)` / `folderHasProjectId(id)`. A plugin exports the result as a folder-scoped claim `predicate`.
- **CHANGED** folder slot consumers (`sidebar-folder-section`, `worktree-card-section`) re-evaluate on a slot-claims version bump. Today they do not, so a late answer would never show.
- **NEW** `<EmbeddedApp projectScope={{ type? , id? }}>`: on a folder that does not match, the app does not mount. A *Not available for this folder* state with Back renders instead, which closes folder-route deep links. Scaffolded scoped apps get no standalone entry.
- **NEW** `dashboard-plugin-scaffold` mode `new` can scaffold an embedded app with scope `global`, `project-type` (type + marker rules) or `project-specific` (project id), all inside the existing single batch.
  - For `project-specific`, after the final summary confirm, it merges the id into a chosen folder's identity file.
  - It never replaces a different existing id.
- **NEW** `demo-plugin` gains a second, project-scoped demo app as the reference consumer. The existing demo app is unchanged.

## Non-goals

- Loading a plugin from inside a project repo or enabling plugins per folder. Plugins stay global by design (`addons-hub-folder-view` non-goal; local scope is unbuilt in `external-dashboard-plugins`). A project-specific app is a global plugin gated on a project id.
- A JUDO (or any) `project-init` profile, and `project-init` writing the identity file.
- Changing the app-kit `AppHost` interface, or scoping standalone `/apps/<id>/` hosts.
- Session-scoped slot gating by project type.
- Reconciling with the team plugin's own `projects` registry; it keeps working unchanged.

## Capabilities

### New Capabilities
- `folder-project-identity`: identity file format, detection matching and bounds, precedence, the `/api/folder/project` endpoint, the client cache and the predicate factories.

### Modified Capabilities
- `plugin-embedded-app`: ADDED requirement for `projectScope` and the *Not available* states.
- `dashboard-plugin-loader`: ADDED requirement validating and preserving the manifest `projectTypes` field.
- `dashboard-plugin-skill`: ADDED requirement for embedded-app scaffolding with a scope in mode `new`.
- `dashboard-shell-slots`: ADDED requirement that folder-scoped slot consumers re-evaluate on slot-claims invalidation.

## Impact

- `packages/shared`: manifest type `projectTypes`; `FolderProject` wire type.
- `packages/dashboard-plugin-runtime`:
  - manifest validator (whitelist);
  - `folder-project.ts` (cache, hook, predicate factories);
  - folder slot consumers subscribe to the claims version;
  - `EmbeddedApp` `projectScope`.
- `packages/client`: `usePluginEnabledSet` clears the folder project cache when the enabled set changes.
- `packages/server`: new `routes/folder-project-routes.ts` (admission via `admitCwd`, identity file read, marker walk) registered in `server.ts`.
- `packages/demo-plugin`: additional scoped demo app.
- `packages/dashboard-plugin-skill`: scaffold skill app scope + templates.
- `docs/plugin-apps.md`: project-scoped apps section.
- Compatibility: additive.
  - An older dashboard ignores `projectTypes`: `validateManifest` (`packages/dashboard-plugin-runtime/src/manifest-validator.ts:356`) does not reject unknown top-level fields, and its return whitelist drops them.
  - Plugin clients compile into the dashboard build against its runtime, so a consumer of the new API fails the build on an older runtime rather than silently ungating.
- Rollback: revert. The only in-repo consumer is part of this change. Leftover identity files are inert.

## Discipline Skills

- `security-hardening`: the endpoint reads files under an untrusted cwd and parses an untrusted identity file; marker patterns come from plugin manifests; the scaffold writes into a user folder.
- `performance-optimization`: marker walks run per visible folder; entry and pattern budgets, single walk, early stop.
- `doubt-driven-review`: new public plugin API (manifest field, predicate factories, `EmbeddedApp` prop) before it stands.
- `review-code`: before commit.
- Not triggered: `observability-instrumentation` beyond a debug log for scan truncation; indeterminate admissions reuse the existing `cwdAdmissionLogger`.
