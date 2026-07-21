# tunnel-endpoints.ts — index

"Accessible at" enumeration — `collectEndpoints` merges provider endpoints + manual `pairing.publicBaseUrls` + LAN/local into tagged `{kind,url,tls}`; `manualEndpoints`/`localEndpoints`/`toReachableUrlStrings`. `tls` advisory; the https/wss gate stays authoritative in `pairing.reachableUrls()`. See change: add-tunnel-providers.
