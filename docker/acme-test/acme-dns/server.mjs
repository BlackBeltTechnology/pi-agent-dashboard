// acme-dns double for the Pebble harness. `POST /register` returns FIXED test
// credentials; `POST /update` (X-Api-User / X-Api-Key) writes the TXT value to
// challtestsrv for `fulldomain`, keeping the two most recent values like real
// acme-dns. Wrong credentials or subdomain -> 401. Plain http on PORT (8080)
// plus HTTPS on TLS_PORT (8443, cert acme-dns.test from the acme-certs volume)
// because the server requires an https:// acme-dns `server`.
// Fixed values are documented in docker/compose.test.acme.yml.
// See change: add-acme-dns01-certs (design D10).
import { serve, setTxtValues } from "../challtestsrv.mjs";

const ACCOUNT = {
  username: "5f1e7b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
  password: "piE2eAcmeDnsTestKey0123456789abcdefABCD",
  subdomain: "d420c923-bbd7-4056-ab64-c3ca54c9b3cf",
  fulldomain: "d420c923-bbd7-4056-ab64-c3ca54c9b3cf.auth.dash.test",
  allowfrom: [],
};
let recent = []; // newest last, max 2

serve(Number(process.env.PORT || 8080), "acme-dns", async (req, url, body) => {
  if (req.method === "POST" && url.pathname === "/register") return [201, ACCOUNT];
  if (req.method === "POST" && url.pathname === "/update") {
    if (req.headers["x-api-user"] !== ACCOUNT.username || req.headers["x-api-key"] !== ACCOUNT.password) {
      return [401, { error: "forbidden" }];
    }
    if (body.subdomain !== ACCOUNT.subdomain) return [401, { error: "forbidden" }];
    if (typeof body.txt !== "string" || !body.txt) return [400, { error: "bad_txt" }];
    recent = [...recent, body.txt].slice(-2);
    await setTxtValues(ACCOUNT.fulldomain, recent);
    return [200, { txt: body.txt }];
  }
  if (req.method === "GET" && url.pathname === "/health") return [200, {}];
  return [404, { error: "not found" }];
}, process.env.TLS_PORT ? {
  port: Number(process.env.TLS_PORT),
  key: process.env.TLS_KEY || "/certs/acme-dns.key",
  cert: process.env.TLS_CERT || "/certs/acme-dns.pem",
} : undefined);
