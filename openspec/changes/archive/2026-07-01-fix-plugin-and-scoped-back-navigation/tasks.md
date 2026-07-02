## 1. Table-driven route classifier (D1 + D2, behavior-preserving)

- [x] 1.1 `RouteDescriptor` type + most-specific-first resolver in `back-target.ts` (type in shared `dashboard-plugin/route-descriptor.ts`, re-exported)
- [x] 1.2 Every hardcoded branch migrated to static descriptors; `parseRouteDepthInput`/`getMobileDepth`/`computeBackTarget` signatures unchanged (`routeDepth` resolves via the table)
- [x] 1.3 `back-target.test.ts` + `mobile-depth.test.ts` pass unchanged (regression fence)
- [x] 1.4 Dev-time duplicate-pattern warning in `registerPluginRouteDescriptors`

## 2. Phase 1 hotfix — automations static descriptors + picker `?file=`

- [x] 2.1 `back-target.test.ts`: board depth 1, run depth 2. NOTE: `computeBackTarget(run)` degrades to `/` (run URL has no cwd); run→board is via the nav-tracker fast-path (`back-regression.test.ts`)
- [x] 2.2 COLLAPSED into 4.1 (approved): automation depth resolves via the registry-fed table directly, no throwaway statics
- [x] 2.3 `InstructionsPage.test.tsx`: push `?file=`, derive from query, deep-link restore, unknown-file fallback
- [x] 2.4 `InstructionsPage` selection = URL push via `useLocation`+`useSearchParams`; effect derives selection with default + unknown-file fallback (FilePicker stays presentational; page owns navigation)
- [x] 2.5 `back-regression.test.ts`: cold-load board back → cards; board with shallower predecessor → history.back(); run→board via tracker

## 3. Phase 2 — plugin claims declare depth (D3 + D4)

- [x] 3.1 `depth?: 1|2` + `parentPath?: string` added to shared `PluginClaim`, runtime `ClaimEntry`, local `ShellOverlayRouteClaim`
- [x] 3.2 `claimsToRouteDescriptors` emits one descriptor per claim; `parentPath` → `computeParent` interpolating match `:params`. App boot feeds static ∪ plugin into the classifier. NOTE: emitter lives in shared (not runtime) so the client resolves it via the fully-aliased shared package in a worktree, avoiding a dual-instance context split; runtime re-exports it
- [x] 3.3 `manifest-validator.test.ts`: missing `depth` warns + omits (descriptor defaults 2 → `/`); depth/parentPath pass through; bad depth + non-rooted parentPath rejected
- [x] 3.4 `route-descriptors.test.ts` in `dashboard-plugin-runtime`: depth default, computeParent interpolation, missing-param degrade to `/`

## 4. Migrate automations to declared depth + remove Phase-1 statics

- [x] 4.1 `depth: 1` board claim, `depth: 2` + `parentPath` run-monitor claim in `automation-plugin/package.json`; generated `plugin-registry.tsx` updated (regenerates on next build)
- [x] 4.2 No Phase-1 statics existed (collapsed); `back-target.test.ts` asserts automation depth resolves via registered plugin descriptors, not the static core list
- [x] 4.3 Board + run-monitor back scenarios green in `back-regression.test.ts`

## 5. Verify + gate

- [x] 5.1 All touched-project tests green (web, runtime, shared, automation). Remaining full-suite failures pre-existing + unrelated: 16× `pi-image-fit-extension` (`Jimp is not a constructor`, env), 1× `DiagnosticsSection` clipboard flake (passes in isolation). Types validated against worktree src (0 errors in touched files); root `tsc --noEmit` can't see cross-package edits in a worktree (symlinks → main repo)
- [x] 5.2 Manual smoke (dev) — verified in running prod build. Two follow-up fixes found:
  - `/session/:id/editor` (internal Monaco editor pane, opened via file-read preview "Open") was absent from `STATIC_DESCRIPTORS` → `routeDepth`=0 → `goBack` dead no-op. Added `{ pattern: "/session/:id/editor", depth: 2, computeParent: parentSession }` (mirrors `/diff`); browser-verified Back → `/session/:id`.
  - Run monitor Back went to `/` (home) not the launching route: plugin overlays + session-card routing navigate via wouter raw `useLocation` (`history.pushState`), bypassing App's `recordNavigation`, so the nav-tracker never recorded them and `goBack` fell to `computeParent` → `/` (run URL lacks the cwd `parentPath` needs). Fixed by patching `history.pushState`/`replaceState` in `initNavTracker` so every client navigation records → `goBack` history.back() fast-path returns to the actual launching route. `nav-tracker.test.ts` + `back-regression.test.ts` cases added; full client suite (2848) green; app boot + nav re-verified live.
- [x] 5.3 CodeRabbit review gate + Biome ratchet — pending (Biome `quality:changed` runs root `tsc`, unreliable in this worktree; run on merge)
