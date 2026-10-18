/**
 * L3 — `network.trustMode: "pair"` end to end (test-plan #F10, #F11; change:
 * retire-trusted-networks-bypass).
 *
 * The docker harness boots with `trustedNetworks: ["0.0.0.0/0"]`, so the boot
 * decision stores `legacy` and every Playwright peer (a non-loopback address
 * behind the published port) is admitted. Each test flips the mode through the
 * canonical operator write path (`writeConfig`, the operator cookie + local
 * token) and ALWAYS flips it back before the test body ends: the reap fixture
 * and every sibling spec reach the harness credential-free and would be refused
 * under `pair`.
 *
 * F10  pair refuses a listed peer (denied bar + guarded 403) and a flip back to
 *      `legacy` admits it again, with no server restart.
 * F11  a browser paired at `control`+ previews a REAL in-container upstream
 *      (page, script, image, fetch, WebSocket) under the capability path in
 *      `pair` mode, and the upstream never sees a `pi_dash_*` cookie.
 */
import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { operatorHeaders } from "./helpers/bridge-credential.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { gotoDashboard, robustClick, spawnFreshGitSession } from "./helpers/index.js";
import { readBaselineFile, readConfig, writeConfig } from "./helpers/trust-access.js";
import { BASE_URL } from "./lifecycle.js";

/** The mode the harness is in right now (`legacy` when nothing is stored). */
async function currentMode(): Promise<"pair" | "legacy"> {
  const cfg = await readConfig(true);
  const network = cfg.data?.network as { trustMode?: string } | undefined;
  return network?.trustMode === "pair" ? "pair" : "legacy";
}

async function setMode(mode: "pair" | "legacy"): Promise<void> {
  const status = await writeConfig({ network: { trustMode: mode } });
  expect(status, `PUT /api/config network.trustMode=${mode}`).toBe(200);
}

test.describe("trust mode pair — end to end", () => {
  test.skip(
    () => !readBaselineFile()?.credential,
    "needs the operator credential (PI_E2E_OAUTH=1) to flip and restore the mode",
  );

  test("F10: pair refuses a listed peer, flipping back to legacy admits it without a restart", async ({
    page,
    request,
  }) => {
    const original = await currentMode();
    try {
      await setMode("pair");

      // Guarded API from this (non-loopback, listed by 0.0.0.0/0) peer: refused.
      // `/api/paired-devices` carries the per-route guard; the harness's OAuth seed
      // sets `auth.bypassUrls: ["/"]`, which exempts every path from the UNIVERSAL hook.
      const denied = await request.get(`${BASE_URL}/api/paired-devices`);
      expect(denied.status()).toBe(403);
      expect((await denied.json()).error).toBe("network_not_allowed");

      // The shell still loads but the dashboard does not: the refused browser sees
      // the denied bar with Request access. This harness seeds an OAuth provider
      // (`PI_E2E_OAUTH=1`), where the client shows its sign-in gate for the same
      // refusal instead; either way no dashboard renders in `pair`. The bar itself
      // is pinned at L1 (ConnectionStatusBanner F8).
      await page.goto("/");
      await expect(
        page.getByTestId("network-denied-request-access").or(page.getByText("Sign in to pi-dashboard")),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("headerAppBar")).toHaveCount(0);

      // Back to legacy: the very next request is admitted — same process.
      await setMode("legacy");
      const admitted = await request.get(`${BASE_URL}/api/paired-devices`);
      expect(admitted.status()).toBe(200);
      await gotoDashboard(page);
      await expect(page.getByTestId("network-denied-request-access")).toHaveCount(0);
      await expect(page.getByText("Sign in to pi-dashboard")).toHaveCount(0);
    } finally {
      await setMode(original);
    }
  });
});

// ── F11 — remote preview under the capability path ─────────────────────────

const FIXTURE_PORT = 5199;
const BEARER_KEY = "pi-dashboard:device-bearer";

/**
 * A dependency-free upstream that runs INSIDE the harness container (the live
 * proxy only forwards to loopback): an HTML page that loads a script and an
 * image, `fetch`es JSON and opens a WebSocket — all with RELATIVE URLs, as an
 * app under `/live/<id>/~c/<token>/` must — and an endpoint reporting the
 * `Cookie` header the upstream last received.
 */
const UPSTREAM_JS = String.raw`
const http = require("node:http");
const crypto = require("node:crypto");
let seenCookie = "";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const PAGE = '<!doctype html><html><body><img id="pic" src="pic.png"><pre id="result">pending</pre><script src="app.js"></script></body></html>';
const APP = [
  "const out = { script: true, image: false, fetch: false, ws: false, wsMessage: '' };",
  "const done = () => { document.getElementById('result').textContent = JSON.stringify(out); window.__result = out; };",
  "document.getElementById('pic').addEventListener('load', () => { out.image = true; done(); });",
  "fetch('data.json', { mode: 'no-cors' }).then((r) => { out.fetch = r.type === 'opaque' || r.ok; done(); });",
  "const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + location.pathname + 'hmr');",
  "ws.onopen = () => { out.ws = true; done(); };",
  "ws.onmessage = (e) => { out.wsMessage = String(e.data); done(); };",
].join("\n");
const server = http.createServer((req, res) => {
  if (req.url === "/__seen") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ cookie: seenCookie })); }
  seenCookie = (req.headers.cookie || "") + " | " + seenCookie;
  if (req.url === "/" ) { res.setHeader("content-type", "text/html"); return res.end(PAGE); }
  if (req.url === "/app.js") { res.setHeader("content-type", "text/javascript"); return res.end(APP); }
  if (req.url === "/pic.png") { res.setHeader("content-type", "image/png"); return res.end(PNG); }
  if (req.url === "/data.json") { res.setHeader("content-type", "application/json"); return res.end('{"ok":true}'); }
  res.statusCode = 404; res.end("nope");
});
server.on("upgrade", (req, socket) => {
  seenCookie = (req.headers.cookie || "") + " | " + seenCookie;
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  const msg = Buffer.from("hmr-hello");
  socket.write(Buffer.concat([Buffer.from([0x81, msg.length]), msg]));
});
server.listen(${FIXTURE_PORT}, "127.0.0.1");
`;

function inContainer(container: string, script: string): string {
  return execFileSync("docker", ["exec", container, "sh", "-c", script], { encoding: "utf8", timeout: 30_000 }).trim();
}

/** Start the upstream detached in the container (idempotent: replaces a stale one). */
function startUpstream(container: string): void {
  const b64 = Buffer.from(UPSTREAM_JS).toString("base64");
  inContainer(container, `echo ${b64} | base64 -d > /tmp/live-upstream.js`);
  execFileSync("docker", ["exec", "-d", container, "node", "/tmp/live-upstream.js"], { timeout: 30_000 });
}

function stopUpstream(container: string): void {
  try {
    inContainer(
      container,
      `for d in /proc/[0-9]*; do tr '\\0' ' ' < "$d/cmdline" 2>/dev/null | grep -q live-upstream.js && kill "\${d#/proc/}"; done; true`,
    );
  } catch {
    /* best effort */
  }
}

/** Pair this browser through the real QR handshake while still in legacy mode. */
async function pairBrowser(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext) {
  const payloadJson = await (await request.get("/api/pair/payload", { headers: operatorHeaders() })).json();
  expect(payloadJson.success, JSON.stringify(payloadJson)).toBe(true);
  const payload = payloadJson.data as { code: string };
  const encoded = `pi:pair:v1.${Buffer.from(JSON.stringify(payloadJson.data)).toString("base64url")}`;
  await page.goto(`/pair#${encoded}`);
  const codeEl = page.getByTestId("pair-landing-confirm-code");
  await expect(codeEl).toBeVisible({ timeout: 20_000 });
  const confirmCode = (await codeEl.textContent())?.trim() ?? "";
  const approve = await (
    await request.post("/api/pair/approve", {
      data: { code: payload.code, confirmCode },
      headers: operatorHeaders(),
    })
  ).json();
  expect(approve.success, JSON.stringify(approve)).toBe(true);
  await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 20_000 });
  expect(await page.evaluate((k) => localStorage.getItem(k), BEARER_KEY), "no JS-readable bearer").toBeNull();
}

test.describe("trust mode pair — live preview capability (F11)", () => {
  test.skip(
    () => !readBaselineFile()?.credential,
    "needs the operator credential (PI_E2E_OAUTH=1) to flip and restore the mode",
  );

  test("F11: a paired browser previews a real upstream under /live/<id>/~c/<token>/ with HMR in pair mode", async ({
    page,
    request,
  }) => {
    const container = resolveContainer();
    const original = await currentMode();
    let targetId: string | undefined;
    try {
      startUpstream(container);
      await pairBrowser(page, request);
      const card = await spawnFreshGitSession(page);
      await card.click();
      await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });

      // From here the harness is `pair`: the paired browser's device cookie is
      // its only credential, and the preview frame has none at all.
      await setMode("pair");

      const framed: string[] = [];
      const fetchStatus: number[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/~c/")) framed.push(`${r.resourceType()} ${new URL(r.url()).pathname}`);
      });
      page.on("response", (r) => {
        if (r.url().includes("/~c/") && r.url().endsWith("/data.json")) fetchStatus.push(r.status());
      });
      const sockets: string[] = [];
      page.on("websocket", (w) => sockets.push(w.url()));

      await robustClick(page, "layout-mode-split");
      await robustClick(page, "live-preview-launch");
      await page.getByTestId("live-url").fill(`http://127.0.0.1:${FIXTURE_PORT}`);
      await robustClick(page, "live-confirm");

      const iframe = page.getByTestId("live-iframe");
      await expect(iframe).toBeAttached({ timeout: 20_000 });
      const src = (await iframe.getAttribute("src")) ?? "";
      const match = /^\/live\/([^/]+)\/~c\/[A-Za-z0-9_-]{22,}\/$/.exec(src);
      expect(match, `iframe src is a capability path (got ${src})`).toBeTruthy();
      targetId = match?.[1];

      const frame = page.frameLocator('[data-testid="live-iframe"]');
      await expect(frame.locator("#result")).toContainText('"fetch":true', { timeout: 30_000 });
      const result = JSON.parse((await frame.locator("#result").textContent()) ?? "{}");
      expect(result).toMatchObject({ script: true, image: true, fetch: true, ws: true, wsMessage: "hmr-hello" });

      // Every sub-resource went through the capability prefix: document, script,
      // image, fetch and the HMR socket.
      const kinds = new Set(framed.map((s) => s.split(" ")[0]));
      for (const kind of ["document", "script", "image", "fetch"]) expect(kinds, `${kind} under /~c/`).toContain(kind);
      // The frame is opaque-origin, so it cannot READ the fetch body (no CORS); the
      // browser's own network log is what proves the fetch was admitted: 2xx.
      expect(fetchStatus, "fetch answered 2xx under the capability path").toEqual([200]);
      expect(sockets.some((u) => u.includes("/~c/")), "WebSocket under the capability path").toBe(true);

      // The previewed app never saw a dashboard cookie.
      const seen = inContainer(container, `node -e "require('http').get('http://127.0.0.1:${FIXTURE_PORT}/__seen',r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>console.log(b))})"`);
      expect(seen).not.toContain("pi_dash_");
    } finally {
      await setMode(original);
      if (targetId) {
        await request.delete(`${BASE_URL}/api/live-server/${targetId}`, { headers: operatorHeaders() }).catch(() => undefined);
      }
      stopUpstream(container);
    }
  });
});
