# compose.test.peer.yml — index

Opt-in two-dashboard overlay. `PI_E2E_SEED=1 TEST_EXTRA_COMPOSE=compose.test.peer.yml docker/test-up.sh -d --build`. Needs NET_ADMIN + network at start (iproute2 installed on demand).

`pi-dashboard` gains `PI_DASHBOARD_NO_MDNS=0`, `PI_PEER_BRIDGE_ADDR=192.168.64.1/24`, `NET_ADMIN`, entrypoint `peer-entrypoint.sh`. `pi-dashboard-peer`: same image, own tmpfs volume `peer-state` (own `identity.key` ⇒ own fingerprint), mDNS on, same bridge address, NOT published; specs reach it via `docker exec`. See change: harden-peer-address-identity (test-plan #X6).
