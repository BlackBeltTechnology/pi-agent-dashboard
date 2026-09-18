# DOX — packages/chat-gateway/src/shared

Files in this directory. One row per source file. See change: add-chat-gateway.

| File | Purpose |
|------|---------|
| `types.ts` | The pure shared contract (no I/O, no host import): `ChatGatewayConfig` (mirrors `../configSchema.json`) + `ResolvedConfig` + `CONFIG_DEFAULTS`, `InboundMessage` (incl. `parentChannelId` — L4 treats an opted-in parent as opting in its threads), `BindingSource` (precedence-ordered), `Binding` + `bindingKey({platform,channelId,threadId})` (canonical, collision-free; thread keyed separately from its parent channel), `AuthAction`/`AuthDecision`. Also the TEAM-CONTROLS SURFACE wire shape + its two browser message names: `SurfaceRoleAssigners` (`assigners` | `unavailable{missingPermission}` — never an empty list meaning "cannot tell"), `SurfaceRoleMapping`, `SurfaceFolder` (with `inert`), `SurfaceBinding`, `SurfaceLogEntry`, `TeamSurfaceView`, and the `TEAM_SURFACE_MESSAGE`/`TEAM_CONFIG_MESSAGE` constants (defined here, not in the server entry, so the panel imports no server code). Every union is spelled out rather than imported to keep this file import-free. Imported by both the server component and the settings panel. |
| `index.ts` | Barrel re-export of `./types.js` — the `./shared` export subpath. |
