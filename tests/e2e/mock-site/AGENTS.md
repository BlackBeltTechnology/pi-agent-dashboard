# DOX — tests/e2e/mock-site

Config-owned by `playwright.mock-site.config.ts` (ignored by the default config). One row per file.

| File | Purpose |
|------|---------|
| `fixture.ts` | `makeE2eProject()` temp project: dashboard example mock + `2026-11-04-e2e-fixture` (ring lint, Tailwind mock/app classes, fixed child, phone edge ring), node_modules symlink, real plugin config. `MARKER`, `readMarker`, `REPO_ROOT`. See change: add-live-component-mock-site. |
| `global-setup.ts` | Starts repo Vite on the fixture config on a free port, waits for mockSite:true, writes `MARKER` (root, port, pid, url). No docker harness. See change: add-live-component-mock-site. |
| `global-teardown.ts` | SIGKILLs the site pid from `MARKER`, removes the fixture project. See change: add-live-component-mock-site. |
| `mock-site.spec.ts` | L3 rendered mock site (config `playwright.mock-site.config.ts`, `npm run test:e2e:mock-site`): ref ids (F13), ring lint (E20), no badge lag (P1), badge under bar (F1), tip (F2), phone 375px + edge badge (F3, F4), system theme + OS switch + bar colour (F5–F7), UI + CLI decisions (F8, F9), deep links incl. phone ring (F10, F11), copy + iframe click (F12), Tailwind + containment (F14, F15), discovery reload (F16), bad pane / duplicate / malformed (X5–X7). See change: add-live-component-mock-site. |
