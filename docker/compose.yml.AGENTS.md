# compose.yml — index

Base compose. Service `pi-dashboard`, `init:true`, env-driven ports, named volumes `pi-state`→`/home/pi/.pi` + `zrok-state`→`/home/pi/.zrok2`, tmpfs `/tmp`, healthcheck `/api/health`, mem limit. Three commented volume perf profiles (default/performance/ephemeral). Sets `PI_GATEWAY_TCP: "${PI_GATEWAY_TCP:-1}"` — the TCP listener is opt-in since the transport change; the container keeps it with bridge auth mandatory (D10b). See change: docker-packaging. See change: add-pi-gateway-transport-identity.
