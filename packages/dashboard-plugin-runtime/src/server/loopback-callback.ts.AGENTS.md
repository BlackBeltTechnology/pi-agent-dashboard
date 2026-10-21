# loopback-callback.ts — index

`createLoopbackCallback({path='/callback',timeoutMs=300_000,signal,successHtml})` → `Promise<{redirectUri,state,waitForCode,close,server}>`. Binds `127.0.0.1:0`, self-generated 32-byte base64url `state`. State check FIRST (length-checked `timingSafeEqual`): mismatch/missing → 400 keep waiting (even with `error=`); other paths 404; state-matched `error=` rejects `LoopbackCallbackError{code}`; match → 200 page + resolve + close. Timeout/abort reject; `close()` idempotent. See change: expose-plugin-credential-and-oauth-seams.
