# Tasks — Guard client fetch helpers against non-JSON responses

## 1. Shared helper (TDD)
- [x] 1.1 Write `packages/client/src/lib/__tests__/fetch-json.test.ts` first: 2xx JSON passthrough; 504 + HTML body → `ApiHttpError` (status 504, no `Unexpected token`); 200 + `text/html` → `ApiHttpError`; empty/502 body → typed error not `SyntaxError`; `bodySnippet` bounded to ≈200 chars. Verify the tests fail.
- [x] 1.2 Add `packages/client/src/lib/fetch-json.ts`: `class ApiHttpError extends Error` (`status`, `statusText`, `contentType`, `bodySnippet`) and `fetchJson<T>(input, init?)`. Validate `res.ok` then `content-type` includes `application/json`; on failure read bounded body text and throw `ApiHttpError` with message `HTTP <status> <statusText>`. Make 1.1 pass.
- [x] 1.3 (Optional) Export a `fetchJsonResponse` variant returning `{ res, json }` after the content-type guard, for callers that branch on status.

## 2. Fix the reported path — git-api.ts
- [x] 2.1 Route `fetchWorktrees`, `fetchGitHead`, `fetchBranches` through `fetchJson`. Keep the existing `json.success` / `json.data` unwrap.
- [x] 2.2 Migrate the remaining unguarded `res.json()` helpers in `git-api.ts` to `fetchJson`; leave `checkoutBranch` (409-dirty) and the `LifecycleResult` status-branching helpers intact (use the response variant if they call `res.json()` unguarded).
- [x] 2.3 Verify (test or manual) that a non-JSON response to `/api/git/worktrees` yields a `loadError` containing `HTTP <status>` in `WorktreeSpawnDialog`, not `Unexpected token '<'`.

## 3. Follow-on migration (same change, incremental)
- [x] 3.1 Migrate unguarded `res.json()` in `browse-api.ts`, `editor-api.ts`, `known-servers-api.ts`, `providers-api.ts`, `tools-api.ts` to `fetchJson`.
- [x] 3.2 Spot-check the other `lib/*-api.ts` modules; migrate any remaining unguarded `.json()` calls.

## 4. Verify
- [x] 4.1 `npm test` green (new + existing client lib tests).
- [x] 4.2 `npm run quality:changed` clean.
- [x] 4.3 `openspec validate guard-client-fetch-json` passes.
- [x] 4.4 Manual: open `+Worktree Session` against a backend forced to return a non-JSON error (e.g. proxy 502) and confirm the dialog shows the HTTP status.
