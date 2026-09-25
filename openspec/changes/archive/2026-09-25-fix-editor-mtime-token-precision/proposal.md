## Why

Saving from the split editor pane's Edit tab (`.md`/`.mdx`, `.csv`) always fails on filesystems with sub-millisecond mtimes (macOS APFS, most Linux filesystems). `GET /api/file` returns `mtime: Math.round(stat.mtimeMs)`, while `POST /api/file/write` compares the token against full-precision `stat.mtimeMs`. The two never match, so every save returns `409` and shows the changed-on-disk banner. Its Refresh reloads the unchanged disk content, and the user's edits are lost. The Instructions editor is unaffected because `/api/file/md-read` already returns full precision.

## What Changes

- `GET /api/file` returns `mtime` at full precision (`stat.mtimeMs`), matching `/api/file/md-read` and the write-side conflict check.
- No client change is needed. Viewers already echo the token back verbatim.
- Out of scope, for possible follow-ups: suppressing the pane banner for the dashboard's own writes, and a "keep mine / overwrite" choice on 409.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `internal-monaco-editor-pane`: the `/api/file` response contract adds a full-precision `mtime` concurrency token, which `/api/file/write` accepts as-is.

## Impact

- Code: `packages/server/src/routes/file-routes.ts` (the `/api/file` file branch).
- Tests: `packages/server/src/__tests__/file-write-endpoint.test.ts`, which gains a read→write round-trip on a fractional-mtime file.
- API: `mtime` stays a JSON number but may now be fractional. It is only used as the write concurrency token, so the change is backward compatible.
- Deploy: server only. Run `curl -X POST http://localhost:8000/api/restart`. No client build is needed.
- Rollback: revert the one-line change.

## Discipline Skills

None apply. This is a one-line server contract fix with no auth, untrusted-input, latency, or irreversible surface. The write authorization boundary (`isWritableMdTarget`) and the 409 semantics are unchanged.
