## 1. Spike gaps (record in design.md "Context")

- [x] 1.1 Re-run the FilmCraft drop-order spike through the real post-install + shim in `sandbox="allow-scripts"` (skill `spike-craft-web-app-in-sandbox`), asserting each drop landed before the next
- [x] 1.2 Record the save round trip of a media `.fcproj` through the shim (paths in the saved bytes)
- [x] 1.3 Record behaviour for two media with the same base name

## 2. Implementation

- [x] 2.1 Profile fields `mediaProject` / `mediaMax*` + `profile-checks.ts` rules; FilmCraft `.fcproj` edit claim
- [x] 2.2 `.fcproj` parse + path collection + rewrite/restore module (pure, `packages/craft-web-plugin/src/shared/`): explicit field access, `Map` for the name map, project-folder confinement, 16 MiB project cap
- [x] 2.3 Shim `open-media` / `open-media-ack` + project open ordering; bump `SHIM_VERSION` and FilmCraft `minShimVersion`
- [x] 2.4 Client: sequential media read via `/api/file/raw`, bounds, missing-media notice; `routeAndSave` restore step before `workspaceSave`; undelivered media keep their original path
- [x] 2.5 `.fcproj` validator; manifest claim + drift test updates
- [x] 2.6 Docs: `docs/craft-web-plugin.md`, `packages/craft-web-plugin` DOX rows; EffectCraft no-go + upstream ask recorded

## 3. Tests (from test-plan.md)

Unit tests for the pure media-project module go in `packages/craft-web-plugin/src/shared/__tests__/media-project.test.ts` (new directory; vitest config of the plugin already covers `src/**`).

- [x] 3.1 Count bound: 63/64/65 referenced media — input: project with N media · trigger: plan delivery · observable: 64 planned, 65th counted missing (test-plan #E1); see `packages/craft-web-plugin/src/client/__tests__/save.test.tsx` for vitest layout
- [x] 3.2 Project cap: 16 MiB vs 16 MiB + 1 — trigger: parse · observable: over-cap rejected before `JSON.parse`, nothing planned (test-plan #E2); see `packages/craft-web-plugin/src/server/__tests__/format-validators.test.ts`
- [x] 3.3 Size bound: 64 MiB / +1 per medium, 5 x 64 MiB total — observable: 4 planned, rest missing (test-plan #E3); see `format-validators.test.ts`
- [x] 3.4 Bound order: b.mp4 then a.mp4, room for one — observable: b.mp4 delivered (test-plan #E4)
- [x] 3.5 Confinement table: six path forms from `edit/` — observable: only two planned and rewritten, four unchanged and counted missing (test-plan #E5)
- [x] 3.6 Collisions: `a/clip.mp4` + `b/clip.mp4` — observable: distinct vfs names and exact restore (test-plan #E6)
- [x] 3.7 Hostile JSON: `__proto__`/`constructor` keys — observable: no pollution, no throw (test-plan #E7)
- [x] 3.8 Restore: mapped, unmapped, undelivered paths — observable: only mapped changed, valid JSON (test-plan #E8)
- [x] 3.9 `.fcproj` validator: valid / text / wrong `format` / no `project` / empty — observable: only valid accepted (test-plan #E9); see `packages/craft-web-plugin/src/server/__tests__/format-validators.test.ts`
- [x] 3.10 Claims drift + profile checks: `.fcproj` claim, no `.ecproj`, `mediaMax*` bounds — observable: manifest test green, `profileErrors` names the app on a bad bound (test-plan #E10); see `packages/craft-web-plugin/src/__tests__/manifest.test.ts`
- [x] 3.11 Shim ordering: 3 `open-media` then `open` — observable: one ack per medium before the next message, project last (test-plan #F1); see `packages/craft-web-plugin/src/shim/__tests__/craft-shim.test.ts`
- [x] 3.12 Shim fallback: 2 media then project, no title signal — observable: no `opened` before the project drop (test-plan #F2); see `craft-shim.test.ts`
- [x] 3.13 Shim ignores `open-media` for an app without `mediaProject` — observable: no drop, no ack (test-plan #F3); see `craft-shim.test.ts`
- [x] 3.14 User drop during media delivery still refused — observable: refused, host drops unaffected (test-plan #F4); see `craft-shim.test.ts`
- [x] 3.15 Media read gate: 200/403/404/network error — observable: one delivered, three counted missing, open completes with a "3 missing" notice (test-plan #F5); see `packages/craft-web-plugin/src/client/__tests__/protocol.test.tsx`
- [x] 3.16 Sequential delivery: 4 media, ack delayed 500 ms — observable: at most one buffer held, project order, project last (test-plan #F6); see `protocol.test.tsx`
- [x] 3.17 Save restore point: save naming `/files/clip.mp4` — observable: `workspaceSave` gets the original path, validator runs on final bytes, rejection leaves disk unchanged (test-plan #F7); see `packages/craft-web-plugin/src/client/__tests__/save.test.tsx`
- [ ] 3.18 e2e missing medium: fixture with `clips/gone.mp4` and `clips/a.mp4`, Edit in FilmCraft then save — observable: "1 missing" notice, both paths verbatim on disk (test-plan #X1); see `tests/e2e/craft-web-editor.spec.ts`
- [ ] 3.19 e2e escaping reference: fixture referencing `../secret.txt` — observable: no `/api/file/raw` request for it, counted missing (test-plan #X2); see `tests/e2e/craft-web-editor.spec.ts`
- [ ] 3.20 e2e round trip: `edit/story.fcproj`, edit, Ctrl/Cmd+S — observable: FilmCraft JSON on disk naming `clips/a.mp4`, differs from fixture, no document data in frame URL (test-plan #R1); see `tests/e2e/craft-web-editor.spec.ts`
- [ ] 3.21 e2e memory: two tabs x 4 media of 64 MiB — observable: both ready and opened within 120 s, no crash event (test-plan #P1); see `tests/e2e/craft-web-editor.spec.ts`
- [ ] 3.22 Manual: real FilmCraft shows the project's media with thumbnail and duration, none offline (test-plan: manual-only) (test-plan #V1)
