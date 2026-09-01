# DOX — packages/server/src/pairing

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `browser-gateway.ts` | WebSocket gateway for browser clients. Exports `BrowserGateway` interface, `createBrowserGateway`,… → see `browser-gateway.ts.AGENTS.md` Replays the current `reachability` on connect so a browser disconnected during a change converges without a reload. See change: warn-unreachable-trusted-networks. |
| `notify-log.ts` | Bounded per-session notify log. Exports `NOTIFY_LOG_CAP=50`, `createNotifyLog(cap?)` (`append`/`get`/`hydrate`/`isEmpty`, oldest-first eviction) and `fromLegacyPromptRequest(msg)` (pre-split `prompt_request{prompt.type:"notify"}` → entry; reads `component.props.message`/`level`, falls back to `prompt.question`, normalizes level). Transcript history ONLY — never feeds `hasPendingPromptRequests` / `hasPendingAsk` / the `currentTool` fold; retained after session end. See change: split-notify-from-prompt-request. Also exports `NotifyLogStats` + `getStats()` — cap evictions counted per session (silent transcript loss), surfaced on `/api/health#notifyLog`. |
| `paired-devices.ts` | Paired-devices registry (D5). `PairedDeviceRegistry(path?)` persists `~/.pi/dashboard/paired-devices.json`… → see `paired-devices.ts.AGENTS.md` |
| `pairing.ts` | QR/copy-string pairing manager (D6/D12). `PairingManager({registry,getFingerprint,getReachableUrls,now?})`:… → see `pairing.ts.AGENTS.md` |
| `subagent-resync-routing.ts` | Requester-scoped resync delivery (C5): correlate a bridge reply back to the browser that asked. Exports `ResyncRequesterRegistry` (`record`/`take`/`forget`, TTL `RESYNC_REQUEST_TTL_MS` 30000, bounded, take-once) and `resyncRequestIdOf(data)` reading the bridge-echoed `__resyncRequestId`. Unknown/expired token → `broadcastEvent` falls back to the ordinary fan-out. See change: reduce-subagent-details-payload. |
