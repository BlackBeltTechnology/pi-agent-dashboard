# DOX — tests/e2e/acme

L3 specs for the opt-in ACME DNS-01 Pebble overlay (`docker/compose.test.acme.yml`). Each skips when the overlay is absent. Run: `PI_E2E_SEED=1 TEST_EXTRA_COMPOSE=compose.test.acme.yml docker/test-up.sh -d --build`, then `PW_E2E_USE_RUNNING=1 PW_E2E_PORT=<dashboardPort> PW_GATEWAY_PORT=<gatewayPort> npx playwright test tests/e2e/acme/`. Glue: `../helpers/acme.ts`. See change: add-acme-dns01-certs.

| File | Purpose |
|------|---------|
| `acme-f1-group-convergence.spec.ts` | F1 (6.29): Gateway editor adds Pebble/Cloudflare source `pebble` → valid `dash.test` row, "Not advertised", token in no DOM. Needs `compose.test.acme.yml` overlay, else skips. See change: add-acme-dns01-certs. |
| `acme-f2-check-now.spec.ts` | F2 (6.30): acme-dns CNAME gate Check now — gate stays + newer `checkedAt:<name>`, then `/set-cname` → gate clears, row valid. Acme overlay. See change: add-acme-dns01-certs. |
| `acme-x10-x11-advertise-switch.spec.ts` | X10/X11 (6.40, 6.41), serial: custom dir unadvertised → served, absent from endpoints + pairing payload; editor Advertise Save → new serial + endpoint. Acme overlay. See change: add-acme-dns01-certs. |
| `acme-x9-dns01-advertised.spec.ts` | X9 (6.39): `advertise:true` issue → idle; handshake chains to Pebble `/roots/0`; endpoint `{kind:"domain",url:"https://dash.test:8443",tls:true}`; challenge TXT cleared. Acme overlay. See change: add-acme-dns01-certs. |
