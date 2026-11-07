# pi-env.d.ts — index

Ambient fallback declarations for current `@earendil-works/pi-*` hosts (fork aliases removed — see change: drop-mariozechner-pi-fork); `ExtensionAPI` mirrors custom `sendMessage(...,{triggerTurn,deliverAs})` used by hidden dashboard Retry, plus `appendEntry(customType, data)` for durable custom session entries (subagent-admission refusals). See changes: fix-retry-error-lifecycle, bound-subagent-fanout-under-host-pressure.
`ExtensionAPI.exec` resolves pi's `ExecResult` shape `{ stdout, stderr, code, killed, truncated }`. See change: update-pi-core-1-5-adopt-apis.
