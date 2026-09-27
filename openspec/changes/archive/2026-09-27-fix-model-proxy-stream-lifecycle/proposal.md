# Fix model-proxy stream lifecycle: system prompt, disconnect abort, mid-stream failure

## Why

New parallel-conversation isolation tests for the `/v1/*` model proxy found
**no cross-talk** between concurrent conversations. They did find three
defects in how a single stream is carried end to end:

1. **Client system prompts never reached the provider.** The `/v1` route
   adapters in `server.ts` (main listener + optional second port) built the pi-ai
   context as `{ system }`. pi-ai's `Context` field is `systemPrompt`, so the
   prompt was dropped without any error. The earlier runtime-generation change
   pinned this mismatch on purpose ("preserved rather than silently repaired").
   This change repairs it.
2. **A client disconnect never aborted the upstream call.** Both routes listened
   on `request.raw` "close". On Node 24 that event fires as soon as the request
   body is consumed, before the handler's awaits finish and the listener
   attaches. An abandoned stream therefore kept running upstream and kept
   spending tokens.
3. **An upstream error thrown mid-stream hung the client.** After the SSE
   headers were written, the `catch` called `reply.code(500).send(...)`. Fastify
   then threw `ERR_HTTP_HEADERS_SENT` (the `cli.ts` crash-safety handler
   suppresses it; a bare process exits), and the SSE stream was never ended.

## What Changes

- `model-proxy/streamer.ts`: new `callPiAiStreamSimple(fn, routeOpts)` maps the
  route `system` option onto `Context.systemPrompt`. Both `/v1` wirings in
  `server.ts` use it.
- `routes/model-proxy-routes.ts`: disconnect is detected from `reply.raw`
  "close" while `!writableFinished`, on both endpoints.
- `routes/model-proxy-routes.ts`: a throw after the headers are sent ends the SSE
  stream exactly as an upstream `error` event would (OpenAI: stop chunk +
  `[DONE]`; Anthropic: `event: error`). It never attempts a 500.
- New `__tests__/model-proxy-parallel-isolation.test.ts` covers the above
  against a real listening server with concurrent, provably overlapping streams.

## Capabilities

### Modified Capabilities

- `model-proxy`: abort requirement extended to both endpoints and to other
  conversations. The runtime-generation requirement now requires the system
  prompt to reach the provider. New requirements cover mid-stream failure and
  concurrent-conversation isolation.

## Impact

- Server only (`packages/server`), no client or protocol change. Restart the
  server (jiti), no build needed.
- Behaviour change visible to proxy clients: system prompts now take effect.
- Rollback: revert the commit. No persisted state or config is involved.

## Discipline Skills

- `systematic-debugging`: the abort defect was root-caused with a probe
  (`request.raw` "close" timing) before any fix. A suspected half-open-socket
  leak was measured, disproved, and reverted.
- `review-code`: inline review before commit (Biome clean on changed lines, tsc
  baseline unchanged, 254/254 model-proxy tests).
