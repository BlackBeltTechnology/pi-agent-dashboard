# DOX — packages/system-one/src/backends

Backend transports. See change: add-system-one-registry.

| File | Purpose |
|------|---------|
| `attempt.ts` | `attemptScope(timeoutMs, caller?)`: per-attempt AbortController fired by the adapter's own timer or the caller signal; `aborted` promise, `timedOut()`, `dispose()`. `RawOutcome`. |
| `http.ts` | `callHttp`: `POST` TypeSafe body `{model, state, questions}`, `Authorization: Bearer` only with a resolved key, `redirect: "error"` (redirect = error; no remote bounce), http/https only. Non-2xx / bad JSON / transport → `error`; timer/abort → `timeout`. |
| `llm.ts` | `callLlm(caller, role, …)`: races `caller.call` against the adapter timer (15 s default) — enforced even when the caller ignores the signal. Missing `model` → role string. |
