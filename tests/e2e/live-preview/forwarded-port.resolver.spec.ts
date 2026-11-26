import http from "node:http";
import { expect, test } from "./fixture.js";
import { startHeaderForwarder, startTcpForwarder } from "./forwarder.js";
import { pairDevice, revokeDevice } from "./tier5-helpers.js";

/**
 * L2 — `ssh -L` through a REAL forwarder. Node-level (raw HTTP like curl; no browser); named `.resolver.spec.ts` only so
 * the suite runs it once (the `chromium-resolver` project) instead of once per browser project.
 * Row: test-plan #X8. See change: serve-live-previews-on-capability-origin (D1: genuinely-local peer, forwarding headers).
 *
 *   - TCP forwarder `127.0.0.1:F → 127.0.0.1:<server>`: loopback peer, NO headers → tier 1, origin port = F, upstream body served.
 *   - HTTP forwarder that ADDS `X-Forwarded-For` → no tier 1, log `reason=forwarding-headers`.
 *   - A request to `<L>.localhost:<server port>` THROUGH the forwarder (wrong port for that capability) → 403.
 */
interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}
/** One raw HTTP request to `port` on 127.0.0.1 with an explicit Host (`curl --resolve <host>:<port>:127.0.0.1`). */
const raw = (port: number, host: string, opts: { path?: string; method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Res> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: opts.path ?? "/", method: opts.method ?? "GET", headers: { host, ...opts.headers } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end(opts.body);
  });

/** Sign in through `port` as `localhost:<port>` (one-time local-proof code) → the `Cookie` header value. */
async function signIn(port: number, code: string): Promise<string> {
  const res = await raw(port, `localhost:${port}`, { path: `/auth/local-proof?code=${code}` });
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]);
  expect(cookies.length, `local-proof redeemed through :${port} (status ${res.status})`).toBeGreaterThan(0);
  return cookies.join("; ");
}

/** `curl http://localhost:<port>/api/live-server/<id>/capability` with `accept` as the signed-in operator. */
const mint = (port: number, cookie: string, id: string, extra: Record<string, string> = {}): Promise<Res> =>
  raw(port, `localhost:${port}`, {
    path: `/api/live-server/${encodeURIComponent(id)}/capability`,
    method: "POST",
    headers: { cookie, origin: `http://localhost:${port}`, "content-type": "application/json", ...extra },
    body: JSON.stringify({ accept: ["origin", "preview"] }),
  });

test("T.X8 / #X8 TCP forwarder → tier 1 on the forwarded port and the upstream body is served; header-adding forwarder → no tier 1; wrong-port label → 403", async ({ isolatedServer, upstream }) => {
  const started = await isolatedServer.api("POST", "/api/live-server/start", { host: "127.0.0.1", port: upstream.port });
  expect(started.json?.success, JSON.stringify(started.json)).toBe(true);
  const id = (started.json.id ?? started.json.data?.id) as string;

  let device: Awaited<ReturnType<typeof pairDevice>> | undefined;
  const tcp = await startTcpForwarder({ targetPort: isolatedServer.port });
  const withHeaders = await startHeaderForwarder({ targetPort: isolatedServer.port, addHeaders: { "x-forwarded-for": "203.0.113.9" } });
  try {
    expect(tcp.port).not.toBe(isolatedServer.port);

    // ── TCP forwarder (what `ssh -L` does) ────────────────────────────────────────────────────────────────────
    const cookie = await signIn(tcp.port, await isolatedServer.mintLocalProofCode());
    const mark = isolatedServer.logMark();
    const minted = await mint(tcp.port, cookie, id);
    expect(minted.status, minted.body).toBe(200);
    const m = JSON.parse(minted.body) as { tier?: number | string; origin?: string; path?: string; entry?: string };
    expect(String(m.tier), "tier 1 through a loopback TCP forward").toBe("1");
    expect(m.origin, "origin port is the FORWARDED port").toMatch(new RegExp(`^http://[a-z2-7]{26}\\.localhost:${tcp.port}$`));
    expect(isolatedServer.livePreviewLog(mark).join("\n")).toMatch(/mint tier=1 /);

    const labelHost = new URL(m.origin as string).host; // <L>.localhost:<F>
    // curl --resolve <L>.localhost:F:127.0.0.1 http://<L>.localhost:F/
    const served = await raw(tcp.port, labelHost, { path: "/" });
    expect(served.status, "the capability origin answers through the forward").toBe(200);
    expect(served.body, "the upstream body is served").toContain("static upstream");

    // The same label on the SERVER's own port (`<L>.localhost:8000` in the row) through the forwarder: refused.
    const wrongPort = await raw(tcp.port, `${new URL(m.origin as string).hostname}:${isolatedServer.port}`, { path: "/" });
    expect(wrongPort.status, "label host on the wrong port → 403").toBe(403);
    expect(wrongPort.body).not.toContain("static upstream");

    // ── header-adding forwarder (a reverse proxy in front) ────────────────────────────────────────────────────
    // Behind a proxy that adds `X-Forwarded-For` the local-proof cookie no longer counts (the peer is not "genuinely local"),
    // so the operator authenticates the way a remote device does: a paired-device bearer.
    device = await pairDevice(isolatedServer, "x8-device", "control");
    const viaHeaders = (accept: string[]) =>
      raw(withHeaders.port, `localhost:${withHeaders.port}`, {
        path: `/api/live-server/${encodeURIComponent(id)}/capability`,
        method: "POST",
        headers: { authorization: `Bearer ${device?.token}`, "content-type": "application/json" },
        body: JSON.stringify({ accept }),
      });
    // A client that accepts origins only: the refusal of tier 1 is the whole story → legacy path, reason logged.
    const mark2 = isolatedServer.logMark();
    const originOnly = await viaHeaders(["origin"]);
    expect(originOnly.status, originOnly.body).toBe(200);
    const m2 = JSON.parse(originOnly.body) as { tier?: number | string; origin?: string; path?: string };
    expect(String(m2.tier), "forwarding headers → never tier 1").not.toBe("1");
    expect(m2.origin ?? "", "no http://<label>.localhost origin").not.toMatch(/\.localhost/);
    expect(isolatedServer.livePreviewLog(mark2).join("\n"), "the refusal reason is logged").toMatch(/reason=forwarding-headers/);
    // A client that also accepts `preview` falls through to tier 5 — still never tier 1.
    const withPreview = await viaHeaders(["origin", "preview"]);
    expect(withPreview.status, withPreview.body).toBe(200);
    expect(String(JSON.parse(withPreview.body).tier)).toBe("5");
  } finally {
    await tcp.close();
    await withHeaders.close();
    if (device) await revokeDevice(isolatedServer, device.id);
    await isolatedServer.api("DELETE", `/api/live-server/${encodeURIComponent(id)}`);
  }
});
