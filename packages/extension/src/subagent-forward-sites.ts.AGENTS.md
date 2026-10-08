# subagent-forward-sites.ts — index

The two subagent forward paths that call `sendEventForward` directly, extracted so strip PLACEMENT is testable. Exports `flushBufferedSubagentFrames` (strips drained frames), `serveSubagentResync` (sends the retained snapshot UNSTRIPPED, echoes `__resyncRequestId`, returns undefined on not-ready/unknown/evicted → `resyncNoop`). See change: reduce-subagent-details-payload.
