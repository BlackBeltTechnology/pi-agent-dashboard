## Why

`@blackbelt-technology/pi-image-fit` is a first-party, pure-JS pi extension that ships from this monorepo (`packages/image-fit-extension/`) and transparently downsizes oversize images before they reach the model — saving tokens and avoiding provider image-size rejections. It is fully published and installable, yet it is the only genuine first-party pi extension that is **not surfaced** in the dashboard's Recommended Extensions card. Users have no in-dashboard path to discover or one-click install it.

## What Changes

- Add a `pi-image-fit` entry to the `RECOMMENDED_EXTENSIONS` manifest in `packages/shared/src/recommended-extensions.ts` (mirrored in `src/shared/recommended-extensions.ts` if both exist).
  - `id: "@blackbelt-technology/pi-image-fit"`, `source: "npm:@blackbelt-technology/pi-image-fit"`.
  - `status: "optional"` (no tools registered; transparent `read`-tool interception only).
  - `unlocks`: image auto-downscaling on `Read` (1568 px long edge / 4 MiB / quality 85 defaults).
  - No `dashboardPlugin` (it has no companion dashboard plugin).
- Verify the manifest unit test (recommended ⊇ bundled invariant) still passes; do **not** add it to `BUNDLED_EXTENSION_IDS` (keep Electron bundle budget + SPDX scope unchanged for now).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `pi-image-fit`: add a new requirement that the extension be surfaced in the dashboard's curated `RECOMMENDED_EXTENSIONS` manifest (status `optional`, npm source), so it appears in the Recommended Extensions card and is installable/cross-referenced like other entries. Existing extension-behavior requirements are unchanged.

## Impact

- **Code**: `packages/shared/src/recommended-extensions.ts` (+ `src/shared/recommended-extensions.ts` if duplicated) — one new array entry.
- **UI**: `RecommendedExtensions.tsx` automatically renders the new card via `/api/packages/recommended`; no component change required.
- **Tests**: existing `recommended-extensions` manifest tests (recommended/bundled subset invariant) — confirm green.
- **No** changes to install plumbing, Electron bundling, server routes, or the extension package itself.
