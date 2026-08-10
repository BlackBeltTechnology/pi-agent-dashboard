# DOX — packages/server/src/model-proxy/convert

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `anthropic-in.ts` | Converts Anthropic Messages request into pi-ai Context. Exports `convertAnthropicMessages`, `convertAnthropicTools`. Handles text/image/tool_result user blocks, tool_use assistant blocks. Lifted from upstream pi-model-proxy. |
| `anthropic-out.ts` | Converts pi-ai events to Anthropic SSE + non-streaming responses. Exports `AnthropicBlockTracker` (content-block index counter), `eventToAnthropicSSE`, `eventToAnthropicResponse`. Maps stopReason `toolUse`→`tool_use`, `length`→`max_tokens`. |
| `index.ts` | Barrel re-exports for convert/ module. Re-exports OpenAI + Anthropic in/out converters and shared types (`OpenAIMessage`, `OpenAITool`, `AnthropicMessagesRequest`, `AnthropicTool`). |
| `openai-in.ts` | Converts OpenAI chat messages into pi-ai Context. Exports `convertOpenAIMessages`, `convertOpenAITools`. Handles system/user/assistant/tool roles, image_url data-URI parsing, tool_call argument JSON parse. |
| `openai-out.ts` | Converts pi-ai events to OpenAI SSE chunks + non-streaming responses. Exports `ToolCallIndexTracker` (id→index map for multi-tool-call), `eventToSSEChunks`, `eventToNonStreamingResponse`. Emits `reasoning_content` for thinking deltas. |
| `types.ts` | Local wire-protocol type defs for convert/ module. Exports `OpenAIMessage`, `OpenAIContentPart`, `OpenAIToolCall`, `OpenAITool`, `AnthropicMessagesRequest`, `AnthropicMessage`, `AnthropicContentBlock`, `AnthropicTool`. Pi-ai types referenced via `any`. |
| `UPSTREAM.md` | Upstream source record. Lifted from BlackBeltTechnology/pi-model-proxy (MIT), commit 179d450 (v0.40.1), lift 2026-05-07, pi-ai types 0.73.0. Local divergences: type imports → `any` (pi-ai runtime-resolved), tab → 2-space indent, stricter-tsconfig lint tweaks. |
