// Cloudflare-API shim for the Pebble harness. Maps the four calls the DNS-01
// solver makes onto pebble-challtestsrv. Keeps its OWN per-host record set:
// challtestsrv `/clear-txt` drops the whole host, so a DELETE clears the host
// and re-sets the remaining values (apex + wildcard share one owner name).
// Fixed values are documented in docker/compose.test.acme.yml.
// See change: add-acme-dns01-certs (design D10).
import { randomBytes } from "node:crypto";
import { serve, setTxtValues } from "../challtestsrv.mjs";

const TOKEN = process.env.CF_SHIM_TOKEN || "pi-e2e-cloudflare-token-0123456789abcdef";
const ZONES = [{ id: "0123456789abcdef0123456789abcdef", name: "dash.test", status: "active" }];
const records = new Map(); // id -> { id, zoneId, type, name, content, ttl }

const ok = (result, extra = {}) => [200, { success: true, errors: [], messages: [], result, ...extra }];
const fail = (status, code, message) => [status, { success: false, errors: [{ code, message }], messages: [], result: null }];
const host = (name) => name.replace(/\.$/, "").toLowerCase();
const valuesFor = (name) => [...records.values()].filter((r) => host(r.name) === host(name)).map((r) => r.content);

serve(Number(process.env.PORT || 8080), "cf-shim", async (req, url, body) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return fail(401, 10000, "Authentication error");
  const p = url.pathname.replace(/\/+$/, "");
  if (req.method === "GET" && p === "/client/v4/user/tokens/verify") {
    return ok({ id: "pi-e2e-token", status: "active" });
  }
  if (req.method === "GET" && p === "/client/v4/zones") {
    const name = url.searchParams.get("name");
    const result = ZONES.filter((z) => !name || z.name === host(name));
    return ok(result, { result_info: { page: 1, per_page: 50, count: result.length, total_count: result.length } });
  }
  const m = p.match(/^\/client\/v4\/zones\/([^/]+)\/dns_records(?:\/([^/]+))?$/);
  if (!m) return fail(404, 7003, "No route for that URI");
  const [, zoneId, recId] = m;
  if (!ZONES.some((z) => z.id === zoneId)) return fail(404, 7003, "Could not route to zone");
  if (req.method === "GET" && !recId) {
    const name = url.searchParams.get("name");
    const result = [...records.values()].filter((r) => r.zoneId === zoneId && (!name || host(r.name) === host(name)));
    return ok(result, { result_info: { page: 1, per_page: 100, count: result.length, total_count: result.length } });
  }
  if (req.method === "POST" && !recId) {
    if (body.type !== "TXT" || !body.name || !body.content) return fail(400, 1004, "TXT name and content required");
    const rec = { id: randomBytes(16).toString("hex"), zoneId, type: "TXT", name: host(body.name), content: String(body.content).replace(/^"|"$/g, ""), ttl: body.ttl ?? 60 };
    records.set(rec.id, rec);
    await setTxtValues(rec.name, valuesFor(rec.name));
    return ok(rec);
  }
  if (req.method === "DELETE" && recId) {
    const rec = records.get(recId);
    if (!rec || rec.zoneId !== zoneId) return fail(404, 81044, "Record does not exist");
    records.delete(recId);
    await setTxtValues(rec.name, valuesFor(rec.name)); // siblings survive
    return ok({ id: recId });
  }
  return fail(405, 10405, "Method not allowed");
});
