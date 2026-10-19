# DOX — docker/acme-test

Source for `docker/compose.test.acme.yml` test doubles. Test-only; mounted `:ro` at `/acme-test`. Non-source area. See change: add-acme-dns01-certs.

| File | Purpose |
|------|---------|
| `acme-dns/server.mjs` | acme-dns double, `:8080`. `POST /register` → fixed `{username,password,subdomain,fulldomain,allowfrom}`. `POST /update` checks `X-Api-User`/`X-Api-Key` + `subdomain` (else 401), keeps last 2 TXT values on `fulldomain` in challtestsrv. Also HTTPS on `TLS_PORT` (8443; `TLS_KEY`/`TLS_CERT`, default `/certs/acme-dns.{key,pem}`) — server requires `https://` acme-dns `server`. See change: add-acme-dns01-certs. |
| `cf-shim/server.mjs` | Cloudflare API shim, `:8080`, Bearer `CF_SHIM_TOKEN` (default fixed test token, else 401). `GET /client/v4/user/tokens/verify`, `GET /client/v4/zones?name=` (exact, zone `dash.test`), `GET/POST /zones/<id>/dns_records`, `DELETE …/dns_records/<recId>`. Own per-host record set; DELETE clears host + re-sets siblings. See change: add-acme-dns01-certs. |
| `challtestsrv.mjs` | Shared helpers. `setTxtValues(host, values)` (clear-txt then set-txt each; FQDN trailing dot), `serve(port, name, handler, tls?)` tiny JSON server; `tls` `{port,key,cert}` adds HTTPS listener, same handler. Env `CHALLTESTSRV_URL`. See change: add-acme-dns01-certs. |
| `gen-certs.sh` | One-shot (`acme-certs` service). Writes throwaway listener root `root.pem` + leaves `pebble.test` (`pebble.pem`/`.key`) and `acme-dns.test` (`acme-dns.pem`/`.key`) into `/certs` via `leaf()`; root key deleted; idempotent (all five files present → reuse). See change: add-acme-dns01-certs. |
| `pebble-config.json` | Pebble config. Listener cert `/certs/pebble.pem`, `:14000` ACME, `:15000` mgmt, retryAfter 1 s. See change: add-acme-dns01-certs. |
