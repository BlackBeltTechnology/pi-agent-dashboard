# Tasks — folder-resource-activation-toggle

## 1. Shared types
- [ ] 1.1 Add `enabled: boolean` to `PiResource` in `packages/shared/src/rest-api.ts`; add `"theme"` to its `type` union → verify: `tsc --noEmit` clean, existing `PiResource` consumers compile.

## 2. Server — derive activation state from pi's resolver
- [ ] 2.1 In `pi-resource-scanner.ts`, obtain pi's `PackageManager.resolve()` → `ResolvedPaths` for the scanned scope and set `PiResource.enabled` by matching resolved `path` → verify: unit test with a fixture whose `.pi/settings.json#skills` contains `-./.pi/notes.md` marks `notes` `enabled: false`, and an unmatched resource `enabled: true`.
- [ ] 2.2 Apply to both `local` and `global` result sets; default `enabled: true` when pi reports no entry → verify: test asserts both scopes carry `enabled`; a global fixture with a `-<path>` marks the global resource disabled.

## 3. Server — activation write endpoint (SettingsManager delegation)
- [ ] 3.1 Add `resource-activation-routes.ts` `POST /api/resources/toggle`; construct pi's `SettingsManager` for the scope and replay config-selector logic for a LOOSE resource: strip existing `!+-`-entry for `pattern = relative(baseDir, filePath)`, push `+<pattern>` (enable) / `-<pattern>` (disable), persist via the typed setter → verify: test toggles a loose extension off then on at local scope AND global scope, asserting the settings array contains `-<path>` then `+<path>`.
- [ ] 3.2 Package-resource path: find the package in `settings.packages`, convert string→object form, push `+/-<pattern>` into `pkg[type]` (partial-key object form); never uninstall → verify: test toggles a package-contributed skill, asserts object-form `{source, skills:["-<path>"]}` written and the package still installed.
- [ ] 3.3 Scope-bounded realpath guard (local → under `<cwd>/.pi/`, global → under `~/.pi/agent/`) + 404 when `filePath` not in the scanned set → verify: a `../` escape at local scope is rejected; a global toggle never writes a folder file.
- [ ] 3.4 Return `{ affectedSessions }` = running sessions governed by the scope; auth-gate through the existing package-routes chain → verify: response lists the right session ids; unauthenticated toggle rejected.

## 4. Server — one-click reload
- [ ] 4.1 Add `POST /api/resources/reload` reloading via the per-session `/reload` path; `local` filters `getConnectedSessionIds()` by session cwd, `global` reloads all → verify: test asserts a local reload targets only the folder's sessions and a global reload targets all.

## 5. Client — toggle + one-click reload (folder + global surfaces)
- [ ] 5.1 Add `resources-api.ts` `toggleResource` + `reloadResourceSessions` → verify: unit test hits both endpoints with correct scope-aware body shape.
- [ ] 5.2 Render per-resource enable/disable switch in the Resources surface (via `resource-tree`) for both local and global sections, bound to `PiResource.enabled`, optimistic update; reuse the same component on the global settings page → verify: component test toggles a local row and a global row, asserts scope-correct POST + row state flip.
- [ ] 5.3 After any toggle show a one-click "Reload N sessions" button (N from `affectedSessions`); click POSTs `/api/resources/reload`, clears pending state on success, hidden when N=0. Keep install/uninstall exclusively on Packages tab/section → verify: button appears with correct N, calls reload, disappears at N=0; Resources surface renders no uninstall control (existing `pi-resources-view` guard test still passes).

## 6. Spec + validation
- [ ] 6.1 Ensure `specs/pi-resources-view/spec.md` scenarios match the verified pi format (disable → `-<relPath>`, enable → `+<relPath>`) → verify: `openspec validate folder-resource-activation-toggle` passes.
- [ ] 6.2 Full gate: `npm run quality:changed` (biome `--changed` + `tsc --noEmit` + `npm test`) green.
