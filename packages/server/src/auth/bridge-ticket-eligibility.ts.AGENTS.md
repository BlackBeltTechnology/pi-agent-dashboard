# bridge-ticket-eligibility.ts — index

WHO may mint a `bridge`-scoped WS ticket. `decideBridgeTicketMint({authorization,ip,headers,verifyDeviceBearer})` — allows a paired-device durable bearer or a genuinely-local caller ONLY; a cookie session or trusted-network host is refused, because the bridge surface (session registration + event attribution) is more privileged than `/ws`. Enforced in `server.ts::/api/ws-ticket`. See change: add-pi-gateway-transport-identity (task 6.2, @review Audit).
