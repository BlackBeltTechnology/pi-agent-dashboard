# seed-sessions-window.mjs — index

E2E-only seed: writes >120 ended session `.meta.json`/`.jsonl` records across dummy dirs plus one out-of-window stub dir, so the windowed snapshot + `sessions_page` stub group are exercised. Exports `seedSessionsWindow(root)` (idempotent) + `SEED_SESSIONS_COUNT`/`STUB_SESSION_ID`/`STUB_DIR_CWD`. Called by `docker/test-entrypoint.sh` under PI_E2E_SEED. See change: fix-connect-snapshot-frame-loss.
