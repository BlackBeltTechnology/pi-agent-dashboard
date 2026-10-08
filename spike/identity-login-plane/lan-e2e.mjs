/**
 * LAN end-to-end check (D20 independent frontend): drives the whole login flow
 * the way a browser on ANOTHER device would — every hop addressed by the LAN IP,
 * no `localhost` allowed.
 *
 *   dashboard /identity-login/start  -> Keycloak authorize (LAN IP)
 *   POST credentials                 -> 302 back to /identity-login/callback?code
 *   callback                         -> 302 to /identity-login/app#access_token=…
 *                                       (plugin-owned fragment handoff, NOT the
 *                                        dashboard root; the app strips it)
 *   then use that bearer against the dashboard resource-server surface:
 *     GET  /api/sessions            (Bearer) + the no-bearer control
 *     POST /api/ws-ticket           {scope:"browser"}
 *     WS   /ws?ticket=…             sessions_snapshot + a sessions_page round-trip
 *     WS   /ws (no ticket)          must be refused
 *
 * Usage: node lan-e2e.mjs <lan-ip> [dashboard-port]
 *
 * HARD ASSERTIONS: every observable below is asserted, not merely logged — a
 * missing ticket, a non-2xx bearer call, a 2xx no-bearer control, a skipped
 * upgrade, a non-refused ticketless upgrade, or a non-plugin logout target all
 * FAIL the run (nonzero exit). Session counts are NEVER required to be nonzero
 * (an empty-but-owned list is valid).
 *
 * SCOPE: single principal — this run signs in as anna only. It does NOT exercise
 * two-user isolation (SM-5 needs a second real user, béla) and must not be cited
 * as evidence for a two-user claim.
 *
 * LIMITATION: this is a plain-HTTP, credentialed, DISPOSABLE smoke against a
 * real Keycloak. Run it only on a controlled LAN with disposable credentials.
 * The transport heartbeat is server-driven (30 s); set
 * PI_LAN_E2E_WAIT_HEARTBEAT=1 to actually wait one interval and observe a ping.
 */
import WebSocket from "ws";

const IP = process.argv[2];
if (!IP) throw new Error("usage: node lan-e2e.mjs <lan-ip> [dashboard-port]");
const PORT = process.argv[3] ?? "8010";
const DASH = `http://${IP}:${PORT}`;
const KC = `http://${IP}:18080/realms/pi-identity`;

const jar = new Map();
const hops = [];

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function absorb(res, url) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  hops.push(`${new URL(url).host}${new URL(url).pathname}`);
}
async function go(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: { ...(init.headers ?? {}), ...(jar.size ? { cookie: cookieHeader() } : {}) },
  });
  absorb(res, url);
  return res;
}

const redact = (s) => (s ?? "").replace(/access_token=[^&]+/g, "access_token=<redacted>").replace(/code=[^&]+/g, "code=<redacted>");

// ── 1. login plane → Keycloak authorize (PKCE S256 + binding cookie) ──────────
const startRes = await go(`${DASH}/identity-login/start`);
const authorize = startRes.headers.get("location");
if (!authorize?.startsWith(`${KC}/protocol/openid-connect/auth`)) {
  throw new Error(`start did not route to Keycloak authorize: ${startRes.status} ${authorize}`);
}
if (!/code_challenge_method=S256/.test(authorize)) throw new Error("authorize URL is missing PKCE S256");
if (!jar.has("pi_login_bind")) throw new Error("start did not set the browser-binding cookie");
console.log(`1. start        -> ${redact(authorize).slice(0, 78)}…`);

// ── 2. Keycloak login form ────────────────────────────────────────────────────
const formRes = await go(authorize);
const html = await formRes.text();
const action = html.match(/<form[^>]+action="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
if (!action) throw new Error("no login form action found (KC did not render the login page?)");
console.log(`2. login form   -> ${new URL(action).pathname}`);

// ── 3. authenticate as anna ───────────────────────────────────────────────────
const body = new URLSearchParams({ username: "anna", password: "anna-pw", credentialId: "" });
const authRes = await go(action, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: body.toString(),
});
const backToCallback = authRes.headers.get("location");
if (!backToCallback?.includes("/identity-login/callback")) {
  throw new Error(`expected a redirect back to the callback, got ${authRes.status} ${backToCallback}`);
}
console.log(`3. credentials  -> ${redact(backToCallback)}`);

// ── 4. plugin callback → PLUGIN app (never the dashboard root) ────────────────
const cbRes = await go(backToCallback);
const handoff = cbRes.headers.get("location") ?? "";
if (!handoff) throw new Error(`callback returned no handoff redirect (${cbRes.status})`);
const handoffUrl = new URL(handoff);
if (handoffUrl.origin !== new URL(DASH).origin) {
  throw new Error(
    `callback handoff must stay on the dashboard origin ${new URL(DASH).origin} (host binding), got ${handoffUrl.origin}`,
  );
}
if (handoffUrl.pathname !== "/identity-login/app") {
  throw new Error(`callback handoff must target the plugin app, got ${handoffUrl.pathname}`);
}
if (handoffUrl.pathname === "/" || handoffUrl.href.startsWith(`${DASH}/#`)) {
  throw new Error("callback handed the token to the dashboard root (D20 non-goal)");
}
console.log(`4. callback     -> ${redact(handoff)}`);

const fragment = new URLSearchParams(handoffUrl.hash.slice(1));
const token = fragment.get("access_token");
const expiresIn = fragment.get("expires_in");
if (!token) throw new Error("no access_token in the plugin-app handoff fragment");
if (!expiresIn) throw new Error("no expires_in in the plugin-app handoff fragment");

// ── 5. resource server: bearer MUST be accepted (empty payload is valid) ──────
const apiRes = await fetch(`${DASH}/api/sessions`, { headers: { authorization: `Bearer ${token}` } });
const apiBody = await apiRes.text();
if (apiRes.status !== 200) {
  throw new Error(`GET /api/sessions with the handed-off bearer expected 200, got ${apiRes.status}: ${apiBody.slice(0, 160)}`);
}
let ownedCount = null;
try {
  const parsed = JSON.parse(apiBody);
  ownedCount = Array.isArray(parsed?.data) ? parsed.data.length : null;
} catch {
  /* non-JSON body is not a token; count stays unknown */
}
console.log(`5. GET /api/sessions with the handed-off bearer -> ${apiRes.status} · ${ownedCount ?? "?"} session(s) (empty is valid)`);

// ── 6. control: NO bearer MUST be refused (LAN origin is not loopback) ────────
const anonRes = await fetch(`${DASH}/api/sessions`);
const anonBody = await anonRes.text();
if (anonRes.status !== 401 && anonRes.status !== 403) {
  throw new Error(
    `no-bearer /api/sessions must be refused 401/403 on a LAN origin (not loopback), got ${anonRes.status}: ${anonBody.slice(0, 160)}`,
  );
}
console.log(`6. control: same call with NO bearer -> ${anonRes.status} (expected 401/403 — LAN is not loopback)`);

// ── 7. mint a browser-scope WS ticket with the bearer (MUST succeed) ──────────
const mintRes = await fetch(`${DASH}/api/ws-ticket`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ scope: "browser" }),
});
const mintJson = await mintRes.json().catch(() => null);
const ticket = mintJson?.data?.ticket ?? null;
if (mintRes.status !== 200) throw new Error(`POST /api/ws-ticket expected 200, got ${mintRes.status}`);
if (!ticket) throw new Error("POST /api/ws-ticket returned no browser-scope ticket");
console.log(`7. POST /api/ws-ticket {scope:"browser"} -> ${mintRes.status} · ticket minted`);

// ── 8. authenticated upgrade + sessions_snapshot + a harmless round-trip ─────
// The ticket is hard-asserted present above, so this block ALWAYS runs — a
// missing ticket throws in step 7, it never silently skips the upgrade.
let snapshotCount = null;
let pageReplied = false;
let heartbeatSeen = false;
{
  const wsBase = DASH.replace(/^http/, "ws");
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws?ticket=${encodeURIComponent(ticket)}`, { headers: { Origin: DASH } });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("timed out waiting for sessions_snapshot / sessions_page_result"));
    }, 15_000);
    ws.on("ping", () => {
      heartbeatSeen = true; // ws auto-responds with pong
    });
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "sessions_snapshot") {
        snapshotCount = Array.isArray(msg.sessions) ? msg.sessions.length : 0;
        ws.send(JSON.stringify({ type: "sessions_page", cwd: msg.sessions?.[0]?.cwd ?? "/", offset: 0 }));
      } else if (msg.type === "sessions_page_result") {
        pageReplied = true;
        if (process.env.PI_LAN_E2E_WAIT_HEARTBEAT === "1") {
          setTimeout(() => {
            clearTimeout(timer);
            ws.close();
            resolve();
          }, 35_000);
        } else {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      }
    });
    ws.on("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`ws upgrade refused: ${res.statusCode}`));
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
if (snapshotCount === null) throw new Error("WS: no sessions_snapshot received on the authenticated socket");
if (!pageReplied) throw new Error("WS: no sessions_page_result received for the harmless round-trip");
console.log(`8. WS upgrade   -> sessions_snapshot ${snapshotCount} session(s) (empty is valid), sessions_page_result received`);

// ── 9. a ticketless upgrade MUST be refused ──────────────────────────────────
const refused = await new Promise((resolve) => {
  const wsBase = DASH.replace(/^http/, "ws");
  let settled = false;
  const ws = new WebSocket(`${wsBase}/ws`, { headers: { Origin: DASH } });
  const done = (v) => {
    if (settled) return;
    settled = true;
    try {
      ws.close();
    } catch {}
    resolve(v);
  };
  ws.on("open", () => done("opened (unexpected)"));
  ws.on("unexpected-response", (_req, res) => done(`refused ${res.statusCode}`));
  ws.on("error", () => done("refused"));
  ws.on("close", (code) => done(`closed ${code}`));
  setTimeout(() => done("no verdict within 6s"), 6_000);
});
if (!refused.startsWith("refused") && !refused.startsWith("closed")) {
  throw new Error(`ticketless WS upgrade must be refused, got verdict: ${refused}`);
}
console.log(`9. WS no ticket -> ${refused}`);

// ── 10. logout returns to the PLUGIN login, not the dashboard root ───────────
const logoutRes = await go(`${DASH}/identity-login/logout/perform`);
const endSession = logoutRes.headers.get("location");
if (!endSession) throw new Error(`logout/perform returned no redirect (${logoutRes.status})`);
const plru = new URL(endSession).searchParams.get("post_logout_redirect_uri");
if (plru !== `${DASH}/identity-login/`) {
  throw new Error(`logout must return to the plugin login (${DASH}/identity-login/), got ${plru}`);
}
console.log(`10. logout      -> ${new URL(endSession).origin} (post_logout → ${plru})`);

// ── assertions summary ───────────────────────────────────────────────────────
const rootRedirect = hops.some((p) => p === `${new URL(DASH).host}/`);
const usedLocalhost = hops.some((p) => p.includes("localhost") || p.includes("127.0.0.1"));
const issuer = JSON.parse(await (await fetch(`${KC}/.well-known/openid-configuration`)).text()).issuer;
if (usedLocalhost) throw new Error("localhost appeared in the hop chain — the LAN run would break on another device");
if (rootRedirect) throw new Error("a hop redirected to the dashboard root (D20 violation)");
console.log("");
console.log(`token lifetime : ${expiresIn}s`);
console.log(`kc issuer      : ${issuer}`);
console.log(`localhost used : no`);
console.log(`root redirect  : no`);
console.log(`heartbeat      : ${heartbeatSeen ? "ping observed" : "server-driven 30s (not waited)"}`);
console.log(`api payload    : ${apiBody.slice(0, 80)}…`);
console.log("");
console.log("ALL ASSERTIONS PASSED");
