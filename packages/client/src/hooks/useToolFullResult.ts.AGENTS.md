# useToolFullResult.ts — index

NEW. Fetch hook `useToolFullResult(sessionId, toolCallId) → { result?, error?, loading, fetchFull }`. Hits tool-result endpoint; 404 → error "result evicted". Consumed by `ToolCallStep` Show-full-output button. See change: adopt-pi-071-072-073-features.

Id URL-encoded (`encodeURIComponent`): nested ids carry `/`. See change: render-nested-tool-calls.
Structured stored results (`{content:[...]}`) formatted via `toDisplayString`, never `String(obj)`. See change: render-nested-tool-calls.
