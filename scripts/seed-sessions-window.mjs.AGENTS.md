# seed-sessions-window.mjs — index

E2E-only seed: writes >120 ended session `.meta.json`/`.jsonl` records across dummy dirs plus one out-of-window stub dir, so the windowed snapshot + `sessions_page` stub group are exercised. Exports `seedSessionsWindow(root)` (idempotent) + `SEED_SESSIONS_COUNT`/`STUB_SESSION_ID`/`STUB_DIR_CWD`. Called by `docker/test-entrypoint.sh` under PI_E2E_SEED. See change: fix-connect-snapshot-frame-loss.

`seedSessionsWindow(root, now = Date.now())`: timestamps relative to `now` (day-granular, window sessions 3 days back, stub ~1 day older) so the boot archive sweep (`archiveAfterDays`, default 30) never ages them out. Idempotent by session id (`hasRecord`), not filename, so a re-seed on a later day adds nothing; a half-written pair completes under the existing prefix + timestamp (`existingPrefix`/`prefixTime`); a recreated stub dates before the oldest window session on disk. See change: fix-sidebar-folder-visibility.
