## 1. Wrapper

- [x] 1.1 Add `installApiBaseFetch()` in `packages/client/src/lib/api/api-base-fetch.ts`: idempotent (`window.__piApiBaseFetch`), reads `getApiBase()` per call, rewrites only `string` inputs starting with `/api/` to `${base}${input}` when base is non-empty; everything else passes through
- [x] 1.2 Install it in `packages/client/src/main.tsx` AFTER `installDeviceAuthFetch()` and `installGrantChannelFetch()` (outermost), with a comment naming the ordering invariant

## 2. Tests

- [x] 2.1 Unit tests in `packages/client/src/lib/api/__tests__/api-base-fetch.test.ts` covering every scenario in `specs/cross-origin-client/spec.md` (rewrite, same-origin no-op, server switch, explicit URL/URL/Request/non-api passthrough, query+hash preserved, idempotent install)
- [x] 2.2 Credential-isolation test: install device-auth + grant-channel + api-base wrappers in `main.tsx` order; with base `http://remote:8000` assert no local bearer / grant header reaches the rewritten request; with base `""` assert bearer still attached

## 3. Docs + verification

- [x] 3.1 Add `api-base-fetch.ts` row to `packages/client/src/lib/api/AGENTS.md`; note the ordering invariant on the `main.tsx` row
- [ ] 3.2 Manual: client switched via ServerSelector to a remote → Quota strip/dialog shows the remote's providers; switch back to Local → local providers
