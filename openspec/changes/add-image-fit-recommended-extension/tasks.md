## 1. Manifest entry

- [x] 1.1 Add a `pi-image-fit` entry to `RECOMMENDED_EXTENSIONS` in `packages/shared/src/recommended-extensions.ts`: `id: "@blackbelt-technology/pi-image-fit"`, `source: "npm:@blackbelt-technology/pi-image-fit"`, `displayName: "pi-image-fit"`, `status: "optional"`, `fallbackDescription` (name 1568 px / 4 MiB / quality-85 defaults + silent-quality-loss caveat), `unlocks: ["Automatic image downscaling on Read (saves tokens, avoids provider image-size limits)"]`. No `dashboardPlugin`, no `toolsRegistered`, no `autowired`.
- [x] 1.2 Confirm `BUNDLED_EXTENSION_IDS` is unchanged (entry NOT added).

## 2. Tests

- [x] 2.1 Update `packages/shared/src/__tests__/recommended-extensions.test.ts`: change the exact-set assertion from six to seven ids, adding `@blackbelt-technology/pi-image-fit`; update the test title accordingly.
- [x] 2.2 Run `npm test` for the shared package; verify the manifest shape, npm-prefix, and bundled-subset invariant tests all pass.

## 3. Verification

- [x] 3.1 Type-check the shared package (`tsc --noEmit` or `npm run build` for `packages/shared`).
- [x] 3.2 Manually verify the card renders: start the dashboard, open the Packages tab, confirm a `pi-image-fit` card appears with enriched description + install affordance, and no `+plugin:` badge.
- [x] 3.3 Update docs per the Documentation Update Protocol: add/append the manifest change to the `src/shared/recommended-extensions.ts` row in `docs/file-index-shared.md` (note new `pi-image-fit` entry) and add an FAQ line if relevant.
