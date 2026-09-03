# endpoint-resolution.ts — index

Pure endpoint decision logic for the bridge. The ONLY place an endpoint is chosen.

## Exports

- `resolveEndpoint(inputs): EndpointResolution` — D3 precedence ladder, highest first: `PI_DASHBOARD_SOCKET` → `PI_DASHBOARD_URL` → pinned instance (all three PINNED) → rendezvous record → paired remote. mDNS/discovery is a `suggestion` field and NEVER selected. Absent record → `{available:false}` with reason "no local dashboard available", never a discovered substitute.
- `decideRetarget(input): RetargetDecision` — D4 stickiness. Re-target requires unpinned AND failed AND identityVerified, conjunctively. Same-instanceId candidate is a re-address, not a drift. Every refusal reason names BOTH endpoints (task 10.2).

Tests: `__tests__/endpoint-resolution.test.ts` (test-plan E7, E8, E9, E12).
See change: add-pi-gateway-transport-identity (D3, D4).

`isLoopbackHost(host)` / `isLoopbackEndpoint(url)` (fix-bridge-mdns-migration-hijack): PURE lexical loopback classification — `localhost`/`*.localhost`/`127.x`/`::1` are loopback; everything else, including every `*.local` mDNS name, is remote. Deliberately no DNS: the ambiguous "`.local` resolves loopback" shape is removed at the source by the advertisement gate, and strictness can only decline a migration, never adopt a wrong endpoint. Default classifier injected into `ConnectionManager` (D3 invariant).
