# ACME DNS-01 domain certificates

Publicly trusted TLS cert for the dashboard on a private IP (ZeroTier, LAN, WireGuard, mesh). DNS-01 only. No inbound exposure.

See change: add-acme-dns01-certs. Architecture: [Built-in TLS listener](architecture.md#built-in-tls-listener-change-add-tailscale-cert-tls). Built-in HTTPS base: [HTTPS on the tailnet](faq.md#https-on-the-tailnet-built-in-tls-listener).

## Why

- Private-IP endpoint → CA cannot reach host → HTTP-01 and TLS-ALPN-01 fail.
- DNS-01 proves domain control via TXT record. Host needs no public port.
- Result: `https://dash.<domain>:8443` with CA-signed cert. Phones get secure context and pair.
- Dashboard never stores domain DNS creds in `config.json`. Solver secrets live in credential vault.

## Prerequisites

- Built-in HTTPS enabled: Gateway → Built-in HTTPS → on. See [HTTPS on the tailnet](faq.md#https-on-the-tailnet-built-in-tls-listener).
- Operator-owned domain. DNS hosted on Cloudflare, or any provider (via acme-dns).
- A record `dash.<domain>` → mesh IP (e.g. `10.147.17.5`). Operator's job. Dashboard does not manage A/AAAA. Readiness shows what public DNS returns.
- Outbound only: ACME directory (Let's Encrypt), Cloudflare API or acme-dns server, DoH resolver (`cloudflare-dns.com`, `dns.google`), authoritative DNS on UDP/TCP 53 (fallback below).

## Config shape

`tls.sources[]` entry. Written by the Gateway editor; hand-edit allowed.

```jsonc
{
  "type": "acme",
  "id": "home",
  "domains": ["dash.example.com", "*.lab.example.com"],
  "email": "ops@example.com",
  "agreeTos": true,
  "directory": "staging",
  "advertise": false,
  "solver": { "type": "cloudflare", "zoneId": "…32 hex…" }
}
```

- `id`: `^[a-z0-9][a-z0-9-]{0,31}$`, unique. `tailscale` reserved. Read-only after first save.
- `domains`: 1–20 entries. Lowercased, trailing dot stripped, deduped. LDH labels, ≤ 253 octets. `*.` prefix allowed (one label). No IP literals, ports, schemes, `_`, bare `*`, non-ASCII (use `xn--`).
- `agreeTos`: must be `true`.
- `directory`: `staging` (default), `production`, or `https://` URL. Let's Encrypt URLs canonicalize to keywords.
- `solver` allowlisted per type. Any other key (e.g. hand-written `token`) → 400. No secret in `config.json`.
- `solver.configured` is projected by `GET /api/config`. Never input.

## Step 1: Cloudflare solver

1. Cloudflare dashboard → My Profile → API Tokens → Create Token.
2. Permissions: **Zone → DNS → Edit**. Plus **Zone → Zone → Read** unless `zoneId` is set.
3. Zone resources: **one zone only** (least privilege; token can rewrite that zone).
4. Gateway → Built-in HTTPS → Domain certificates → Add domain certificate. Solver: Cloudflare. Optional zone id.
5. Paste token into the write-only field. Stored in vault (namespace `tls:<id>`, kind `tls-solver`, label `cloudflareToken`).
6. Save. Source writes `solver.configured: true` once token is present.

Without `zoneId`, zone lookup walks name suffixes (`GET /zones?name=…`, longest first). Exact match wins.

## Step 2: acme-dns solver (any DNS provider)

acme-dns holds one TXT slot pair per registration. Secret scope = one TXT value. Use when DNS host has no API or you want least privilege.

1. Register once: `POST <server>/register` (e.g. `https://auth.acme-dns.io/register`). Response: `subdomain`, `fulldomain`, `username`, `password`.
2. Editor → solver acme-dns. Fill `server` (must be `https://`), `subdomain`, `fulldomain`.
3. Enter `username` and `password` in write-only fields. Stored in vault as `acmeDnsUser`, `acmeDnsKey`.
4. At the DNS registrar, create one-time CNAME:

   ```
   _acme-challenge.<domain>   CNAME   <fulldomain>
   ```

   Wildcard `*.x` shares owner `_acme-challenge.x` with apex. One CNAME covers both.
5. Click **Check now** on the CNAME row. Gate clears when CNAME resolves at authoritative NS.

Pitfalls:
- acme-dns registration = one-at-a-time. Names issue serially. First issue ≈ 2–4 min per name (max 10 min each).
- Guidance: one acme-dns registration (one source) per few names. Two sources on the same `(server, subdomain)` → 400 from the Gateway route.
- Credential check writes a placeholder TXT only when the registration mutex is free and only after a credentials save or forced refresh. A 401/403 sets `credentials` gate.

## Step 3: staging → production

1. Leave `directory: "staging"` until a staging cert issues cleanly. Status shows `staging`.
2. Staging certs are served on the real name but **never advertised** (`advertise: false`). Browsers will warn. Expected.
3. Switch `directory` to `production`. Changing `directory` (or effective `advertise`) re-issues each name. Solver, email, endpoints do not re-issue.
4. Let's Encrypt production quota: 50 certs per registered domain per week. Keep staging until stable.

## Advertising

- `production` → advertised. Pairing payload carries the `domain` endpoint (`kind: "domain"`).
- `staging` → not advertised.
- Custom `https://` directory → advertised only with `advertise: true` (operator assertion).
- Wildcard names: served, **never listed** in endpoints or pairing. No concrete URL. Host admission takes exact names only. To use a subdomain under a wildcard, add it to `allowedHosts`.

## Let's Encrypt limits and retries

- Failed validations: limited per account per hostname per hour.
- `invalid` CA challenge → retry floor 1 h (`RetryAfterError`).
- **Try again now** bypasses the 1 h floor. Editor warns beside the button after a CA validation failure. Repeated clicks burn the hourly quota.
- Renewal runs when remaining validity < 1/3 of lifetime. Checked every 12 h.
- Gate-skipped names are not attempts. No failure counted. Re-check every 15 min and on reconcile.

## Disclosure

- Domain names appear in public **CT logs**. Opt-in by choosing a public CA.
- A record exposes the private mesh IP. Mesh IP is not reachable from the internet, but the name is public.
- Editor shows both before first save.

## Credential vault

- Namespace `tls:<sourceId>`. Kind `tls-solver` (not `key`). Never bindable, never delivered to sessions or plugins.
- Accounts tab lists them under "TLS certificates" with "Gateway source `<id>`". No rotate, no revoke. Revoke → 409.
- Removing the source → GC deletes `tls:<id>` namespace and orphaned account key files (`~/.pi/dashboard/tls/acme-account-*.key`).
- Downgrade: older builds preserve unknown kinds but deliver only `key`. Revoke check missing on older builds (vault page can revoke; source then reports `credentials` gate unmet).
- Unreadable vault → `credentials` gate hint `credential vault unavailable`. No CA or DNS call.
- Vault minimum 8 chars. Cloudflare tokens and acme-dns creds exceed it.

## REST surface

| Method | Path | Tier | Purpose |
|---|---|---|---|
| `PUT` | `/api/tls/acme/:sourceId` | operate | upsert one acme entry. Body `id` must equal path id. Clash on acme-dns `(server, subdomain)` → 400. |
| `DELETE` | `/api/tls/acme/:sourceId` | operate | remove entry. Unknown id → 404. |
| `PUT` | `/api/tls/acme/:sourceId/credentials` | operate + vault management | write solver secrets. Only the fields of that solver type. Unknown id → 404 before vault access. |
| `POST` | `/api/tls/issue` | operate | `{ sourceId, name? }`. Forced readiness refresh. 202. Single-flight. Used for Renew now, Try again now, Check now. |

- Per-entry routes: serialized with other config saves. Other sources untouched.
- Corrupt `config.json` → 409 (refuse; `writeConfigPartial` would otherwise rewrite from `{}`).
- `PUT /api/config` still works for acme entries. Same validator.

## Troubleshooting

| Symptom (UI / hint text) | Gate | Cause | Fix |
|---|---|---|---|
| "Cloudflare API token is not saved" | `credentials` | no token in vault | Paste token, Save |
| "Cloudflare rejected the API token (invalid, expired or revoked)" | `credentials` | token bad | new token, same scope |
| "Cloudflare token cannot read zones (needs Zone → Zone → Read, or set a zone id)" | `credentials` | missing Read | add Zone Read, or set `zoneId` |
| "No Cloudflare zone found for `<domain>`" | `dns-zone` | token zone scope | add that zone to token resources |
| "acme-dns credentials are not saved" | `credentials` | no user/key | enter registration `username`/`password` |
| "acme-dns rejected the credentials (HTTP 401)" | `credentials` | wrong user/key | re-enter; or re-register |
| "`<owner>` CNAME `<fulldomain>`" (missing) | `dns-cname` | no CNAME | create CNAME at registrar, Check now |
| "DNS propagation wait …" timeout (180 s) naming a server | (attempt fails) | that NS lagging or dead | wait; or fix the NS. Error names the server. Any dead NS fails attempt. |
| `propagationMode: "doh-fallback"` in status | (info) | port 53 blocked | functional but weaker: both DoH resolvers must agree. Open UDP/TCP 53 for direct check. |
| "Renewal blocked: `<gate>`" on a held cert | gate | renewal window, gate unmet | fix the gate; no failure count while blocked |
| "acme-dns registration busy" | (attempt fails) | another name holds the registration mutex, queue allowance exceeded | split names across registrations |
| "The CA reported the challenge as invalid" | (attempt fails) | CA could not validate TXT | check CNAME/zone; wait 1 h or Try again now (quota warning) |
| "credential vault unavailable" | `credentials` | vault unreadable | fix vault file; see [credential-vault.md](credential-vault.md) |
| "ACME attempt timed out after 10 min" | (attempt fails) | CA or API hang | retries with backoff; check `server.log` |

Logs: `server.log`, lines carry `{sourceId, domain, stage, status, problemType}`. Secrets redacted. No raw response bodies.

## Test seams (E2E only)

Not for production. Honoured only when:

- `PI_E2E_SEED=1`, and
- host is `localhost` or under `.test`.

Otherwise the server logs a refusal and ignores the override.

- `PI_E2E_CLOUDFLARE_API` — Cloudflare API base. Replaces `api.cloudflare.com/client/v4`.
- `PI_E2E_DNS_AUTHORITATIVE` — `host:port`. Replaces NS discovery.

Pebble overlay (ACME CA + DNS double):

```bash
PI_E2E_SEED=1 TEST_EXTRA_COMPOSE=compose.test.acme.yml docker/test-up.sh -d --build
docker/test-down.sh   # overlay list read from state file; no env var needed
```

Overlay file: `docker/compose.test.acme.yml`. Services: `pebble.test` (ACME CA), `challtestsrv.test` (DNS, `dash.test`), `cf-shim.test` (Cloudflare API shim), `acme-dns.test` (acme-dns double). Nothing host-published. Pebble root reaches Node through `NODE_EXTRA_CA_CERTS`, set only in the overlay container.
