# model-proxy-routes.ts — index

OpenAI- + Anthropic-compatible proxy endpoints fronting model registry via pi-ai `streamSimple`. Exports `registerModelProxyRoutes`, `ModelProxyRouteDeps`, `ModelProxyRegistry` (requires `firstAvailable`), `ProxyModel`, `ProxyStreamEvent`, `ProxyStreamOpts`, `StreamSimpleFn` — zero `any`. Endpoints: `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/messages`.

Both POST routes run ONE pipeline `handleCompletion(format, …)`; the wire formats differ only in a `CompletionFormat` adapter (`OPENAI_FORMAT` / `ANTHROPIC_FORMAT`: `invalid` 400 check, `newMessageId`, `toUpstream` message/tool conversion, per-response `sseEncoder` owning its tracker, `toResponse`). Stages: validate → registry (503 `MODEL_PROXY_RUNTIME_MISSING`) → `resolveRequestedModel` (400/404) → `acquireSlot` (503 `SERVER_FULL` / 429 + `Retry-After`) → `runCompletion` → `streamEvents` (SSE) | `collectEvents` (JSON) → `failCompletion`; `logOutcome` writes the optional request log.

`resolveRequestedModel`: label = request.model → firstAvailable(preferredModels) → defaultModel (else 400); alias-expand (`modelAliases`, exact key); first-slash `parseModelId`; `registry.find`; preferred fallback; else 404.

Disconnect = `reply.raw` "close" with `!writableFinished` — NOT `request.raw` "close" (Node 24 fires it once the body is consumed, before the listener attaches → abort never fired). Mid-stream throw (headers already sent) → format's `error` event + `reply.raw.end()`, never `reply.code(500)` (was `ERR_HTTP_HEADERS_SENT` + hung client). Parallel isolation, abort, mid-stream failure covered by `__tests__/model-proxy-parallel-isolation.test.ts`. See change: fix-and-prefer-model-proxy-resolution, fix-model-proxy-stream-lifecycle.
