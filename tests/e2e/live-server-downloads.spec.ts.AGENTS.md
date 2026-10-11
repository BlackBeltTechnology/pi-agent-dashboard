# live-server-downloads.spec.ts — index

L3 live-server iframe sandbox downloads. Routes `/api/live-server/start` + `/live/**` (no real loopback server).
- #F1: click `#export` in frame → page `download` event, `tuning.json`, body `{"k":1}`.
- #X1: frame `localStorage` → `SecurityError`, `window.origin` → `"null"` (D7 opaque origin holds).
- No-gesture download blocking NOT asserted: Chrome 155 permits it with `allow-downloads` alone.
- Run: attach mode needs `PI_E2E_SEED=1 PI_TEST_PEERS=both PI_E2E_OAUTH=1` on test-up + `PW_CHANNEL=chrome` if bundled Chromium absent.

See change: live-viewer-allow-downloads.
