# bridge-ticket-eligibility.ts — index

WHO may mint a `bridge`-scoped WS ticket. `decideBridgeTicketMint({authorization,ip,headers,verifyDeviceBearer})` — allows a paired-device durable bearer or a genuinely-local caller ONLY; a cookie session or trusted-network host is refused, because the bridge surface (session registration + event attribution) is more privileged than `/ws`. Enforced in `server.ts::/api/ws-ticket`. See change: add-pi-gateway-transport-identity (task 6.2, @review Audit).

D2: `verifyDeviceBearer` returns `{id, tier}`; only `tier >= operate` mints as a device, a below-operate bearer falls through to the genuinely-local branch or is refused (`belowOperate` on the verdict feeds the rate-limited `[auth] bridge ticket refused: tier=<t> device=<8-char prefix>` line, `formatBridgeTicketRefusalLine`). See change: harden-bridge-session-claim.
