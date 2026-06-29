# Design — Guard client fetch helpers against non-JSON responses

## Context

Client lib modules (`packages/client/src/lib/*-api.ts`) each hand-roll `fetch` + `res.json()`. There is no shared transport helper, so error handling is per-call and uneven: some guard `res.ok`, none guard content-type. The failure reported in the field is `WorktreeSpawnDialog` showing `Unexpected token '<', "<html> <h"... is not valid JSON` — a reverse-proxy/gateway HTML error page parsed as JSON, masking the real HTTP status.

## Goals

- One small, well-tested helper that makes "parse JSON only when the response is actually JSON" the default.
- Preserve callers that intentionally branch on status (e.g. checkout 409-dirty, `LifecycleResult` unions) — do not force them through a lossy abstraction.
- Replace the cryptic parse error with the real status/body, with zero new UI surface.

## Decision: a `fetchJson<T>` helper + `ApiHttpError`

```ts
// packages/client/src/lib/fetch-json.ts
export class ApiHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly contentType: string;
  readonly bodySnippet: string;   // first ~200 chars, for diagnostics
}

/**
 * fetch + validate + parse. Throws ApiHttpError when:
 *   - res.ok is false, OR
 *   - content-type is not application/json
 * Otherwise returns the parsed JSON as T.
 */
export async function fetchJson<T = unknown>(input: RequestInfo, init?: RequestInit): Promise<T>;
```

Validation order:
1. Issue `fetch(input, init)`.
2. If `!res.ok` → read body text (bounded), throw `ApiHttpError` with status/statusText/content-type/snippet. Message: `HTTP <status> <statusText>` (+ snippet when the body is short/non-HTML).
3. Else if `content-type` does not include `application/json` → read body text (bounded), throw `ApiHttpError` (status 200 but wrong type — the SPA-fallback / misrouted case). Message names the actual content-type.
4. Else `return (await res.json()) as T`.

The thrown `Error.message` is the string the existing `setLoadError` / `catch (err) { err.message }` sites already render — so no UI change is needed to get a meaningful message. The structured fields (`status`, `bodySnippet`) are available for any caller that wants to branch.

### Why not just check `res.ok` inline everywhere

`res.ok` alone would not have caught the reported bug if the proxy returned the HTML with a 200 (SPA-fallback / misroute path). Content-type is the discriminator that distinguishes "JSON error from our server" from "HTML page from something in front of our server". Centralizing both checks once is cheaper and more uniform than editing ~58 call sites by hand, and it gives every future helper the guard for free.

### Callers that branch on status keep raw access

`checkoutBranch` returns `{ dirty: true }` on 409; lifecycle helpers map specific codes. These need the `Response`, not just parsed JSON. Two options, pick per-site:
- Keep those callers on raw `fetch` (they already guard `res.ok` / status) — `fetchJson` is additive, not mandatory.
- OR expose a `fetchJsonResponse` variant returning `{ res, json }` after the content-type guard, so status branching still benefits from the non-HTML guarantee.

Default: migrate the **unguarded** helpers to `fetchJson`; leave the status-branching helpers as-is unless they also call `res.json()` unguarded (then use the response variant).

## Migration scope (priority order)

1. `git-api.ts` `fetchWorktrees` / `fetchGitHead` / `fetchBranches` — the reported path. Verify the dialog now shows `HTTP <status>`.
2. Remaining unguarded `res.json()` in `git-api.ts`.
3. Other `lib/*-api.ts` with `ok=0` content-type=0: `browse-api.ts`, `editor-api.ts`, `known-servers-api.ts`, `providers-api.ts`, `tools-api.ts`.

## Risks / trade-offs

- **Behaviour change on malformed-but-2xx JSON**: previously a 200 with a truncated JSON body threw a parse error; now a 200 with a JSON content-type still goes to `res.json()` and throws the same native parse error. No regression — only non-JSON content-types are intercepted.
- **Bounded body read**: reading the error body adds one `await res.text()` on the error path only; capped to a snippet to avoid pulling a large HTML page into memory/UI.
- **Scope creep**: migrating all 15 files in one change is large. The spec mandates `git-api.ts` (the bug); the rest are listed as same-change follow-on and can land incrementally without reopening the capability.
