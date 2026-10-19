// Shared helpers for the ACME test doubles (cf-shim, acme-dns double).
// challtestsrv semantics (verified against pebble-challtestsrv 2.8.0):
// `/set-txt` APPENDS a value to a host, `/clear-txt` drops EVERY value of the
// host. Hosts are FQDNs with a trailing dot. See change: add-acme-dns01-certs.
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

const CTS = process.env.CHALLTESTSRV_URL || "http://challtestsrv.test:8055";
const fqdn = (h) => (h.endsWith(".") ? h : `${h}.`).toLowerCase();

async function cts(path, body) {
  const r = await fetch(CTS + path, { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`challtestsrv ${path} -> ${r.status}`);
}

/** Make `host` answer exactly `values` (clear, then re-set each one). */
export async function setTxtValues(host, values) {
  await cts("/clear-txt", { host: fqdn(host) });
  for (const value of values) await cts("/set-txt", { host: fqdn(host), value });
}

/**
 * Tiny JSON server: `handler(req, url, body)` returns `[status, json]`.
 * `tls` = `{ port, key, cert }` (PEM paths) adds an HTTPS listener with the same handler.
 */
export function serve(port, name, handler, tls) {
  const onRequest = async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let status = 500;
    let json = { error: "internal" };
    try {
      const body = raw ? JSON.parse(raw) : {};
      [status, json] = await handler(req, new URL(req.url, "http://x"), body);
    } catch (err) {
      json = { error: String(err?.message ?? err) };
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(json));
    console.log(`[${name}] ${req.method} ${req.url} -> ${status}`);
  };
  http.createServer(onRequest).listen(port, () => console.log(`[${name}] listening on :${port}`));
  if (tls) {
    https
      .createServer({ key: readFileSync(tls.key), cert: readFileSync(tls.cert) }, onRequest)
      .listen(tls.port, () => console.log(`[${name}] listening on https :${tls.port}`));
  }
}
