# DOX — packages/server/src/pairing

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `browser-gateway.ts` | WebSocket gateway for browser clients. Exports `BrowserGateway` interface, `createBrowserGateway`,… → see `browser-gateway.ts.AGENTS.md` |
| `notify-log.ts` | Bounded per-session notify log. Exports `NOTIFY_LOG_CAP=50`, `createNotifyLog(cap?)` (`append`/`get`/`hydrate`/`isEmpty`, oldest-first eviction) and `fromLegacyPromptRequest(msg)` (pre-split `prompt_request{prompt.type:"notify"}` → entry; reads `component.props.message`/`level`, falls back to `prompt.question`, normalizes level). Transcript history ONLY — never feeds `hasPendingPromptRequests` / `hasPendingAsk` / the `currentTool` fold; retained after session end. See change: split-notify-from-prompt-request. Also exports `NotifyLogStats` + `getStats()` — cap evictions counted per session (silent transcript loss), surfaced on `/api/health#notifyLog`. |
| `paired-devices.ts` | Paired-devices registry (D5). `PairedDeviceRegistry(path?)` persists `~/.pi/dashboard/paired-devices.json`… → see `paired-devices.ts.AGENTS.md` |
| `pairing.ts` | QR/copy-string pairing manager (D6/D12). `PairingManager({registry,getFingerprint,getReachableUrls,now?})`:… → see `pairing.ts.AGENTS.md` |
