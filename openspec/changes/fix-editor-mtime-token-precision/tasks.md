## 1. Test first

- [x] 1.1 In `packages/server/src/__tests__/file-write-endpoint.test.ts`, add a round-trip test: create an editable `.md` in a session cwd, `fs.utimes` it to a fractional mtime (e.g. `1700000000.0005` s), `GET /api/file`, then `POST /api/file/write` with the returned `mtime`. Assert `200` and the new content on disk. Verify it FAILS on current code (409).
- [x] 1.2 In the same file, add a conflict test: load via `GET /api/file`, modify the file on disk, then POST with the stale token. Assert `409` and the file is untouched. Verify it passes both before and after the fix.

## 2. Fix

- [x] 2.1 In `packages/server/src/routes/file-routes.ts` (`/api/file` file branch), replace `mtime: Math.round(stat.mtimeMs)` with `mtime: stat.mtimeMs` and update the adjacent comment. Verify task 1.1 now passes.
- [x] 2.2 Grep `packages/` for other consumers of the `/api/file` `mtime` that assume an integer, and adjust any found. Verify with `rg -n "\.mtime\b" packages/client/src packages/*-plugin` showing no integer-dependent use.

## 3. Verify

- [x] 3.1 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep for failures. Verify there are no new failures.
- [x] 3.2 Restart the server (`curl -X POST http://localhost:8000/api/restart`). In the split editor, open a `.md` → Edit → change → Save. Verify the dirty dot clears, no changed-on-disk banner appears from the 409 path, and the file holds the edit. Repeat for a `.csv`. (manual QA — deferred, tested later)
- [x] 3.3 Update the `file-routes.ts` row in `packages/server/src/routes/AGENTS.md` (or the nearest `AGENTS.md`) with the full-precision `mtime` token and `See change: fix-editor-mtime-token-precision`.
