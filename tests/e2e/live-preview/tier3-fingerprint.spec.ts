import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import { expect, test } from "./fixture.js";
import { lanIPv4, registerTarget } from "./tier5-helpers.js";

/**
 * L2 — D5 live-vs-closed fingerprint (threat T8), host-run isolated server. A real tier-3 pool listener is opened (login-session
 * principal on a LAN IP the dashboard is bound to); then an UNAUTHENTICATED prober walks every port of the pool:
 *   live port   → 404 `{"error":"not_found"}`, identical for every path, carrying NONE of the dashboard's headers
 *                 (`Server`, CSP / report endpoints, CORS, cookies);
 *   closed port → TCP connection refused.
 * Accepted residual (spec scenario "A live listener is distinguishable from a closed port"): an observer can tell WHICH pool
 * ports are open from refused-vs-answered; this is asserted, not hidden. A wrong `Host` on the live port gets the distinct
 * fixed-binding 403 (design D5, step 0) — it too leaks no dashboard header.
 * Row: test-plan #X30. See change: serve-live-previews-on-capability-origin (task 7.3).
 */

/** HS256 JWT exactly as the dashboard signs a login session (`signToken`): enough to be a `session` principal. */
function sessionJwt(secret: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ sub: "x30@example.test", name: "X30", username: "x30", provider: "github", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}
/** One request to `127.0.0.1:<port>` with an explicit `Host` and optional extra headers (no credential). */
const probe = (port: number, host: string, path: string, headers: Record<string, string> = {}): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers: { host, ...headers }, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });

/** `connected` | the socket error code (`ECONNREFUSED` for a closed port). */
const connect = (port: number): Promise<string> =>
  new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      resolve("connected");
    });
    s.once("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
  });

/** Response headers that would identify the dashboard (or open a reporting channel to it). */
const DASHBOARD_HEADERS = [
  "server",
  "x-powered-by",
  "content-security-policy",
  "content-security-policy-report-only",
  "report-to",
  "reporting-endpoints",
  "nel",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "set-cookie",
  "strict-transport-security",
];

test("T.X30 / #X30 pool probe: the live port answers an identical 404, every other pool port refuses; no dashboard header leaks", async ({ isolatedServer, upstream }) => {
  test.setTimeout(120_000);
  const lan = lanIPv4();
  if (!lan) throw new Error("X30 needs a non-loopback IPv4 interface on this machine (tier 3 pool listeners are only offered on a LAN IP)");
  const secret = crypto.randomBytes(24).toString("hex");
  try {
    // Tier 3 needs (a) a login-session principal and (b) a Host IP the bind address can answer: bind 0.0.0.0 and enable a
    // provider so the session cookie verifies. Restored by `restart({reset:true})` below.
    await isolatedServer.restart({
      patch: { bindHost: "0.0.0.0", auth: { secret, providers: { github: { clientId: "x30", clientSecret: "x30" } }, allowedUsers: ["x30@example.test"] } },
    });
    const targetId = await registerTarget(isolatedServer, upstream.port, "x30");
    const body = JSON.stringify({ accept: ["origin", "preview"], egress: "restricted", viewerId: "x30x30x30x30x30x30" });
    const minted = await new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: isolatedServer.port,
          path: `/api/live-server/${targetId}/capability`,
          method: "POST",
          headers: { host: `${lan}:${isolatedServer.port}`, "content-type": "application/json", "content-length": Buffer.byteLength(body), cookie: `pi_dash_token=${sessionJwt(secret)}` },
        },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(b) }));
        },
      );
      req.on("error", reject);
      req.end(body);
    });
    expect(minted.json.tier, `a login session on the LAN IP mints tier 3 (got ${JSON.stringify(minted.json)})`).toBe(3);
    const liveOrigin = new URL(minted.json.origin as string);
    const livePort = Number(liveOrigin.port);
    const { from, to } = isolatedServer.pool;
    expect(livePort, "the listener sits inside the configured pool").toBeGreaterThanOrEqual(from);
    expect(livePort).toBeLessThanOrEqual(to);

    // The prober holds no credential and asks for the address it scanned (`<lan-ip>:<port>`).
    const scannedHost = `${lan}:${livePort}`;
    const unknownPath = await probe(livePort, scannedHost, "/no/such/path-x30");
    expect(unknownPath.status).toBe(404);
    for (const path of ["/", "/api/health", "/api/sessions", "/ws", "/live/anything/", "/preview/aaaaaaaaaaaaaaaaaaaaaa/", "/auth/status", "/?k=wrong", "/__pi/x"]) {
      const a = await probe(livePort, scannedHost, path);
      expect(a.status, `live pool port, ${path}`).toBe(404);
      expect(a.body, `${path} is byte-identical to an unknown path`).toBe(unknownPath.body);
      expect(a.headers["content-type"], path).toBe(unknownPath.headers["content-type"]);
      for (const h of DASHBOARD_HEADERS) expect(a.headers[h], `no ${h} on ${path}`).toBeUndefined();
    }
    // A request carrying a foreign Origin / cookie never changes the answer either (no oracle for a credential).
    const withJunk = await probe(livePort, scannedHost, "/", { origin: "http://evil.test", cookie: "pi_dash_token=nope; pi_dash_pool_1=nope" });
    expect(withJunk.status).toBe(404);
    expect(withJunk.body).toBe(unknownPath.body);

    // Residual: the Host binding (fixed to the minted origin) answers a distinct 403 — still no dashboard header, no banner.
    const wrongHost = await probe(livePort, `127.0.0.1:${livePort}`, "/");
    expect(wrongHost.status).toBe(403);
    expect(wrongHost.body).not.toBe(unknownPath.body);
    for (const h of DASHBOARD_HEADERS) expect(wrongHost.headers[h], `no ${h} on the wrong-Host answer`).toBeUndefined();

    // Every OTHER pool port is closed: connection refused, never an answer.
    const others: Record<number, string> = {};
    for (let p = from; p <= to; p++) if (p !== livePort) others[p] = await connect(p);
    expect(Object.keys(others)).toHaveLength(to - from);
    expect(Object.values(others).every((c) => c === "ECONNREFUSED"), `closed pool ports refuse: ${JSON.stringify(others)}`).toBe(true);
    expect(await connect(livePort), "the live port accepts the connection (the accepted, documented residual)").toBe("connected");
  } finally {
    await isolatedServer.restart({ reset: true });
  }
  // Rolled back: the dashboard dropped the listener with the instance restart — the whole pool refuses again.
  const { from, to } = isolatedServer.pool;
  for (let p = from; p <= to; p++) expect(await connect(p), `pool port ${p} after reset`).toBe("ECONNREFUSED");
});
