# __tests__/remote-bridge-ticket-origin.test.ts — index

#E14: remote bridge on the real two-port topology. `createTestServer` + paired-device bearer; `resolveDashboardHttpOrigin` → `mintBridgeTicket` → `withTicket` → dial gateway opens; control arm minting from the gateway port gives `wrong-origin` (426). See change: fix-remote-bridge-ticket-origin.
