# browser-relay.spec.ts — index

L3 spec for the browser relay (change: add-browser-relay, test-plan F1–F5 + F10). Requires the harness booted with `PI_E2E_SEED=1 PI_BROWSER_RELAY_FAKE=1` — the docker image has no Chrome, so the plugin boots enabled and seeds one socket-less `Fake` instance with a single tab (`tabId: 1`); ports come from `.pi-test-harness.json`.

VARIANT HARNESS (change: stabilize-browser-e2e, 4.2): the faucet is opt-in by necessity — a live relay makes `isLiveViewActive()` true for every session, so the `content-view` slot renders the live-browser tile and occludes the chat for every other spec (systemic cause S2). A file-level `test.skip(PI_BROWSER_RELAY_FAKE !== "1")` therefore gates the whole file, and it runs on its OWN CI leg: the `e2e-browser-relay` job in `.github/workflows/ci-e2e-browser.yml` (same label gate + PR-advisory, `PI_E2E_SEED=1` + `PI_BROWSER_RELAY_FAKE=1`, runs only this file, uploads `blob-report-relay`). Every shard skips it, so that leg is the file's only automated coverage.

F1–F4 drive the settings surface: F1 cannot-open-Chrome notice + no `Connect` + the Fake row showing 1 tab; F2 the token is write-only (input clears on save, `hasToken` flips, no `tok123` in a later `GET /api/browser/profiles`); F3 the kill switch closes the Fake (its row disappears, a `browser-disabled-reason-*` row renders) and re-enabling re-seeds it; F4 a `browser_relay_input {kind:"evaluate"}` sent on the page's own `/ws` audits a `denied` row via the `auditSeq` refetch signal.

F5/F10 mount the live-view tile: selecting a session makes the content view render, the tile subscribes over the CORE `/ws` (never `/ws/browser-ext/` or `/ws/browser-cdp/`), `browser_relay_frame` JPEGs render as an `<img>`, and clicking Close dismisses via the plugin store → the tile unmounts → `browser_relay_unsubscribe`.

Two robustness rules learned from the harness: `gotoSettings` warms the shell first and retries the deep link (a cold container's client bootstrap otherwise bounces `/settings/plugins/<id>` to the dashboard), and timeouts are generous because the seeded >120 folders saturate Chrome's 6-connection-per-origin pool. `PW_CHANNEL=chrome` runs it against a system Chrome when the bundled chromium build has no headless shell.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 for the browser relay (change: add-browser-relay, test-plan F1–F5 + F10). Needs the
