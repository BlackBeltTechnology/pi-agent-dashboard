# DOX — packages/chat-gateway/src/shared

Files in this directory. One row per source file. See change: add-chat-gateway.

| File | Purpose |
|------|---------|
| `types.ts` | The pure shared contract (no I/O, no host import): `ChatGatewayConfig` (mirrors `../configSchema.json`) + `ResolvedConfig` + `CONFIG_DEFAULTS`, `InboundMessage` (incl. `parentChannelId` — L4 treats an opted-in parent as opting in its threads), `BindingSource` (precedence-ordered), `Binding` + `bindingKey({platform,channelId,threadId})` (canonical, collision-free; thread keyed separately from its parent channel), `AuthAction`/`AuthDecision`. Imported by both the server component and the settings panel. |
| `index.ts` | Barrel re-export of `./types.js` — the `./shared` export subpath. |
