# DOX — packages/google-plugin/src

Files in this directory. One row per source file. See change: add-google-connect.

| File | Purpose |
|------|---------|
| `__tests__/fakes.ts` | Test fakes. `memoryCredentials(initial,maxKeys)` (host key limit → `too_many_keys`), `fakeGoogleFetch` (token + revoke; records `calls`/`revokes`), `capturingLogger`, `account()`/`ownClient()` record builders, `makeHarness` (store + clients + `ConnectService` over a fake `ctx.oauth.startFlow`; `runFlow(i,{deliver})` drives login → code → persist; `reply` mutates the fake Google's answer). |
| `i18n.ts` | `catalog` — zh-CN + hu leaf keys (parity enforced); English at call sites. |
