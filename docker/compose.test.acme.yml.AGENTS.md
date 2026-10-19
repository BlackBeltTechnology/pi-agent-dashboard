# compose.test.acme.yml — index

Opt-in ACME DNS-01 overlay. Layered through existing `TEST_EXTRA_COMPOSE` hook; no new switch. `PI_E2E_SEED=1 TEST_EXTRA_COMPOSE=compose.test.acme.yml docker/test-up.sh -d --build`. See change: add-acme-dns01-certs.

Services: `acme-certs` (one-shot `alpine/openssl:3.5.4`, runs `acme-test/gen-certs.sh` into volume `acme-certs`: root + `pebble.test` + `acme-dns.test` leaves), `pebble` (`ghcr.io/letsencrypt/pebble:2.8.0`, `-dnsserver challtestsrv.test:8053`, config `acme-test/pebble-config.json`), `challtestsrv` (`ghcr.io/letsencrypt/pebble-challtestsrv:2.8.0`, DNS `:8053`, mgmt `:8055`, http/tls challenge listeners off), `cf-shim` + `acme-dns` (`node:24-alpine`, `acme-test/*/server.mjs`, `:8080`); `acme-dns` also HTTPS `:8443` (`TLS_PORT`, leaf from `acme-certs` volume at `/certs`, depends on `acme-certs`). See change: add-acme-dns01-certs.

Aliases: `pebble.test`, `challtestsrv.test`, `cf-shim.test`, `acme-dns.test`; `pi-dashboard` gains `dash.test`. No host ports published; specs reach services via `docker compose -p <project> exec pi-dashboard node -e 'fetch(…)'`. See change: add-acme-dns01-certs.

`pi-dashboard` env: `PI_E2E_SEED=${PI_E2E_SEED:-1}`, `NODE_EXTRA_CA_CERTS=/acme-certs/root.pem` (listener root, overlay-only), `PI_E2E_CLOUDFLARE_API=http://cf-shim.test:8080/client/v4` (full API base; server appends `/user/tokens/verify`, `/zones`…), `PI_E2E_DNS_AUTHORITATIVE=challtestsrv.test:8053`; `depends_on` all overlay services. See change: add-acme-dns01-certs.

Pebble env: `PEBBLE_VA_NOSLEEP=1`, `PEBBLE_WFE_NONCEREJECT=0`, `PEBBLE_AUTHZREUSE=0`; retryAfter 1 s. Issuing root random per start → `https://pebble.test:15000/roots/0`. See change: add-acme-dns01-certs.

Fixed test values (header comment is the source of truth): zone `dash.test`; CF token `pi-e2e-cloudflare-token-0123456789abcdef`, zone id `0123456789abcdef0123456789abcdef`; acme-dns `server` `https://acme-dns.test:8443`, user `5f1e7b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b`, key `piE2eAcmeDnsTestKey0123456789abcdefABCD`, fulldomain `d420c923-bbd7-4056-ab64-c3ca54c9b3cf.auth.dash.test`. See change: add-acme-dns01-certs.

Verified: full apex + wildcard DNS-01 issuance via cf-shim → challtestsrv → Pebble. Teardown via state-file `extraCompose`; L2 `qa/tests/46-harness-acme-overlay-teardown.sh`. See change: add-acme-dns01-certs.
