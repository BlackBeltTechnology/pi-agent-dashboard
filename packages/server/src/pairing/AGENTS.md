# DOX — packages/server/src/pairing

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `browser-gateway.ts` | WebSocket gateway for browser clients. Exports `BrowserGateway` interface, `createBrowserGateway`,… → see `browser-gateway.ts.AGENTS.md` |
| `paired-devices.ts` | Paired-devices registry (D5). `PairedDeviceRegistry(path?)` persists `~/.pi/dashboard/paired-devices.json`… → see `paired-devices.ts.AGENTS.md` |
| `pairing.ts` | QR/copy-string pairing manager (D6/D12). `PairingManager({registry,getFingerprint,getReachableUrls,now?})`:… → see `pairing.ts.AGENTS.md` |
