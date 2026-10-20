# plugins-tab-live.spec.ts — index

Browser E2E for `decouple-plugins-from-core` (test-plan #F6, task 8.86). Context A sits on Settings → Plugins; context B installs `/fixtures/plugin-live-pkg` through `POST /api/packages/install`. Asserts A shows the `e2e-live-plugin` row (`source: pi-package`) from the `plugins_changed` snapshot with 0 further `GET /api/plugins` after the initial load and no reload; removes the package in `finally`. Fixture: `docker/fixtures/plugin-live-pkg/package.json`. Written, NOT yet run against the docker harness.
