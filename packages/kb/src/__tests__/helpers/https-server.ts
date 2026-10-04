// Local https test server for kb net-guard tests (change:
// harden-untrusted-content-ingestion, task 0.2). Uses the committed test-only
// self-signed cert; clients pass `testTls` (ca + servername) and the address
// policy seam so the first hop — reached as host `localhost`, pinned to
// 127.0.0.1 — is admitted while the default policy still blocks everything
// else (e.g. a redirect whose Location is the literal https://127.0.0.1:<p>/).

import dns from "node:dns";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:https";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type GuardedFetchOptions, isNonPublicAddress, type LookupAll } from "../../net-guard.js";

const TLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "tls");
const cert = readFileSync(join(TLS_DIR, "cert.pem"));
const key = readFileSync(join(TLS_DIR, "key.pem"));

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;
export interface TestServer {
  port: number;
  /** First-hop URL (host `localhost`, admitted by the test policy). */
  url: (path?: string) => string;
  /** Literal-IP URL (blocked by the test policy — use as a redirect target). */
  literalUrl: (path?: string) => string;
  connections: () => number;
  close: () => Promise<void>;
}

export async function startHttpsServer(handler: Handler, host = "127.0.0.1"): Promise<TestServer> {
  let conns = 0;
  const srv: Server = createServer({ cert, key }, handler);
  srv.on("connection", () => conns++);
  await new Promise<void>((r) => srv.listen(0, host, r));
  const port = (srv.address() as AddressInfo).port;
  return {
    port,
    url: (path = "/") => `https://localhost:${port}${path}`,
    literalUrl: (path = "/") => `https://127.0.0.1:${port}${path}`,
    connections: () => conns,
    close: () => new Promise<void>((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }),
  };
}

/** Trust the fixture cert. */
const testTls: GuardedFetchOptions["tls"] = { ca: cert, servername: "localhost" };

/** Admits ONLY 127.0.0.1 reached as host `localhost`. */
const admitLoopback = (addr: string, host: string): boolean =>
  host === "localhost" && addr === "127.0.0.1" ? false : isNonPublicAddress(addr);

/** `localhost` → 127.0.0.1 only (avoids a `::1` answer tripping the all-addresses check). */
const testLookup: LookupAll = (host, opts, cb) =>
  host === "localhost" ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : dns.lookup(host, { ...opts, all: true }, cb as never);

/** Options bundle for guardedFetch against the test server. */
export const testFetchOpts: GuardedFetchOptions = { tls: testTls, isBlocked: admitLoopback, lookup: testLookup };
