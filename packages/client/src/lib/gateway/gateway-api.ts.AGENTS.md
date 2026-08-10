# gateway-api.ts — index

Client fetch helpers for the Gateway surfaces. Exports `getBlockEvents`, `runEnrollStep`, `getConfig`, `putConfig`, `getTunnelStatus`, `connectTunnel`, `disconnectTunnel`, `BlockEvent`, `EnrollResult`. Wraps `/api/tunnel/{endpoints,block-events,enroll}` + `/api/config` + `/api/tunnel-{status,connect,disconnect}`. See change: add-tunnel-providers.
