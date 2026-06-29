# Guard client fetch helpers against non-JSON responses

## Why

When a user opens the `+Worktree Session` dialog (`WorktreeSpawnDialog`), it loads its prerequisites with three parallel GETs — `fetchWorktrees`, `fetchGitHead`, `fetchBranches` in `packages/client/src/lib/git-api.ts`. Each does:

```ts
const res = await fetch(url);
const json = await res.json();   // no res.ok / content-type guard
```

If any of those requests comes back as **HTML instead of JSON** — e.g. a reverse-proxy / tunnel error page (`<html><head>…`, a 502/504/413 with no `<!DOCTYPE>`), a gateway timeout on a slow `git` shell-out, or a misrouted `/api/git/*` request — `res.json()` throws `Unexpected token '<', "<html> <h"... is not valid JSON`. That parse error propagates to the dialog's `setLoadError`, which renders it verbatim. The dialog is then stuck and the user sees no way to open a worktree, with a message that points at JSON syntax instead of the real HTTP failure.

The root cause is a transport-hygiene gap, not the worktree feature itself:

1. **No response validation before parse.** Across `packages/client/src/lib/*.ts` there are ~58 `.json()` calls in 15 files. `res.ok` is checked inconsistently (`git-api.ts`: 3 of 17 calls guard it) and **content-type is never checked anywhere**. Any non-JSON body — HTML error page, empty body, gateway interstitial — surfaces as a cryptic `Unexpected token '<'` parse error that hides the actual status code.
2. **The real diagnostic is discarded.** The HTTP status (401/403/404/502/504) and the response body that would tell the user "gateway timeout" or "auth required" never reach the UI. The user and the next agent both debug the wrong layer.

This is the second-most-confusing failure mode the dashboard produces (after a silent stuck spinner): a real infrastructure error masquerading as a client JSON bug.

## What Changes

- **Add a shared `fetchJson` helper** in `packages/client/src/lib/` that wraps `fetch` and, before parsing, validates the response: on `!res.ok` or a non-JSON `content-type`, it reads the body as text (bounded), and throws a typed `ApiHttpError` carrying `status`, `statusText`, `contentType`, and a short body snippet. Only a genuine `application/json` 2xx body reaches `res.json()`.
- **Migrate the client lib fetch helpers to `fetchJson`**, starting with `git-api.ts` (the reported failure) and extending to the other `lib/*-api.ts` modules that currently call `res.json()` unguarded. Helpers that already branch on `res.ok` for typed results (e.g. the 409-dirty checkout path, lifecycle results) keep their semantics — `fetchJson` exposes the raw `Response` where a caller needs status-specific branching.
- **Surface the real error.** `WorktreeSpawnDialog`'s `loadError` (and equivalent error surfaces) now show e.g. `HTTP 504 Gateway Timeout` instead of `Unexpected token '<'`, pointing at the proxy/transport layer. No new UI components — the existing `setLoadError` string just carries a meaningful message.
- **Tests** for `fetchJson` covering: ok JSON passthrough, non-2xx with HTML body, 2xx with HTML body (misrouted/SPA fallback), empty body, and the error message shape.

Non-goals: fixing any specific proxy/tunnel timeout config (that is deployment-side and confirmed per environment); changing server route behaviour (the Fastify git routes already return JSON correctly); adding retry logic.

## Capabilities

### New Capabilities
- `client-api-response-validation`: client fetch helpers SHALL validate HTTP status and content-type before parsing JSON, and SHALL surface a typed error carrying the real status/body when a response is not JSON.

### Modified Capabilities
<!-- none -->

## Impact

- New: `packages/client/src/lib/fetch-json.ts` (helper + `ApiHttpError`) and `packages/client/src/lib/__tests__/fetch-json.test.ts`.
- `packages/client/src/lib/git-api.ts` — route `fetchWorktrees` / `fetchGitHead` / `fetchBranches` and the remaining unguarded `res.json()` helpers through `fetchJson`; preserve the existing `res.ok`-branching helpers (checkout 409, lifecycle results).
- Follow-on (same change, lower priority): `browse-api.ts`, `editor-api.ts`, `known-servers-api.ts`, `providers-api.ts`, `tools-api.ts` and other `lib/*-api.ts` with unguarded `.json()`.
- `packages/client/src/components/WorktreeSpawnDialog.tsx` — no code change required; `loadError` now carries the real HTTP message via the helper.
