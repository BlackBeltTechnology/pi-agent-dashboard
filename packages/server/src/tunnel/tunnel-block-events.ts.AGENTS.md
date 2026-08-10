# tunnel-block-events.ts — index

`BlockEventBuffer` (+ `blockEvents` singleton) — bounded, anti-poisoning ring buffer of network-guard denials. Dedupes by socket-peer IP, caps distinct IPs, marks loopback/proxy-terminated peers `trustable:false`. Powers `GET /api/tunnel/block-events` + the Trust-this-network banner. Never mutates trustedNetworks. See change: add-tunnel-providers.
