# 23-gateway-socket-fallback.sh — index

L2 (test-plan #X17 → task 12.46). A `$HOME` deep enough to overflow `sun_path` forces the loopback fallback: asserts `/api/health.piGatewayPort` is a NUMBER not a socket path, no socket file exists, the listener is on `127.0.0.1` (not `0.0.0.0`), `server.log` names the byte count and the limit, and nothing reached for discovery. Does NOT cover "filesystem cannot host a socket" — `dashboard-paths.ts` never probes the fs, so that half of task 2.1b has no implementation to test. See change: add-pi-gateway-transport-identity.
