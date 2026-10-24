/**
 * E2E: stabilize-mdns-server-identity — task 6.8 (test-plan F5).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins the selector's mapping from a server-side probe status to a label in
 * jsdom with a stubbed API. Only a real browser against the real server shows
 * the whole chain: the browser's own health fetch to a dead `.local` name
 * fails, the selector asks the dashboard's operator-only probe, the REAL server
 * resolves the name (ENOTFOUND) and the row reads "Name not found" — not the
 * CORS-blocked hint the old LAN heuristic produced for every `.local` host.
 *
 * ACTORS
 * ------
 * The `page` fixture is the OPERATOR: specs reach the container through a
 * published port (docker-bridge peer, not loopback), so the context carries the
 * harness's REAL `X-Pi-Local-Token` — the same-host operator credential — on
 * every request. The known server is seeded through the operator API.
 *
 * Exemplars: access-grants-revoke.spec.ts (harness glue),
 * pairing-approval-dialog.spec.ts (operator context via helpers/bridge-credential).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { settingsSection } from "./fixtures/retro-ux/stubs.js";
import { expect, test } from "./fixtures.js";
import { operatorHeaders } from "./helpers/bridge-credential.js";
import { gotoDashboard } from "./helpers/index.js";
import { BASE_URL, DASHBOARD_PORT, harnessProject } from "./lifecycle.js";

const STALE_HOST = "stale-zz9-unresolvable.local";
const STALE_PORT = 8000;

test("a known server with a dead hostname reads 'Name not found', not CORS-blocked", async ({ page, request }) => {
  const headers = operatorHeaders();
  const seeded = await request.post("/api/known-servers", {
    data: { host: STALE_HOST, port: STALE_PORT, label: "Stale iMac" },
    headers,
  });
  expect((await seeded.json()).success).toBe(true);

  try {
    await page.context().setExtraHTTPHeaders(headers);
    await gotoDashboard(page);

    await page.getByTitle("Switch server").click();

    const row = page.getByRole("menuitemradio", { name: new RegExp(`${STALE_HOST}:${STALE_PORT}`) });
    await expect(row).toContainText("Name not found", { timeout: 15_000 });
    await expect(row).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("[data-cors-blocked]")).toHaveCount(0);
  } finally {
    await request.delete("/api/known-servers", { data: { host: STALE_HOST, port: STALE_PORT }, headers });
  }
});

/**
 * add-electron-server-windows — test-plan F4 / F5.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * L1 pins the selector's Electron branch in jsdom. Only a real browser against
 * the real dashboard shows the header dropdown driving it end to end: the
 * `window.piDashboard.openServerWindow` capability (stubbed via an init script,
 * as Electron's preload would define it) is called INSTEAD OF the transactional
 * in-page switch (host + port only), the entry shows its inline progress until the
 * app answers, no staging socket is opened, and the persisted last-used server is
 * never written. The failure toast's wording is pinned at L1. Without the capability (a plain browser) the same click still
 * runs the staging-socket switch.
 *
 * The "remote" is answered by the harness's own server through a Playwright route (`proxyToHarness`, CORS
 * added): a route is only "Available" once its signed identity challenge verifies (group-servers-by-identity D2),
 * so a bare `/api/health` stub no longer proves anything. The entry carries no fingerprint, so any valid proof
 * counts as proven.
 */
const REMOTE_HOST = "home-imac-e2e.test";
const REMOTE_PORT = 8000;

async function seedAvailableRemote(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext) {
  const headers = operatorHeaders();
  const seeded = await request.post("/api/known-servers", {
    data: { host: REMOTE_HOST, port: REMOTE_PORT, label: "home-imac" },
    headers,
  });
  expect((await seeded.json()).success).toBe(true);
  await proxyToHarness(page, REMOTE_HOST, REMOTE_PORT);
  await page.context().setExtraHTTPHeaders(headers);
  return headers;
}

test("Electron: selecting an available remote asks the app (host+port) with inline progress; no in-page switch, no last-server write (F4)", async ({ page, request }) => {
  const headers = await seedAvailableRemote(page, request);
  try {
    await page.addInitScript(() => {
      const w = window as unknown as { __opened: unknown[]; piDashboard: unknown };
      w.__opened = [];
      w.piDashboard = {
        openServerWindow: (target: unknown) => {
          w.__opened.push(target);
          return new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: "identity_mismatch" }), 800));
        },
      };
    });
    const sockets: string[] = [];
    page.on("websocket", (ws) => sockets.push(ws.url()));
    await gotoDashboard(page);
    const lastServerBefore = await page.evaluate(() => localStorage.getItem("pi-dashboard-last-server"));
    const headerBefore = await page.getByTitle("Switch server").textContent();
    const socketsBefore = sockets.length;

    await page.getByTitle("Switch server").click();
    const row = page.getByRole("menuitemradio", { name: new RegExp(`${REMOTE_HOST}:${REMOTE_PORT}`) });
    await expect(row).toContainText("Available", { timeout: 15_000 });
    await row.click();

    // inline progress while the app resolves the request; the app is asked with host + port only
    await expect(row).toContainText("Switching");
    expect(await page.evaluate(() => (window as unknown as { __opened: unknown[] }).__opened)).toEqual([
      { host: REMOTE_HOST, port: REMOTE_PORT },
    ]);
    // once resolved the menu closes (the failure itself is reported through the selector's `onNotifyError`
    // toast — pinned at L1 in ServerSelector.electron.test.tsx; App-level toasts are not observable in this harness)
    await expect(row).toBeHidden({ timeout: 10_000 });

    // no in-page switch: no staging socket to the remote, nothing persisted, header still on the local server
    expect(sockets.slice(socketsBefore).some((u) => u.includes(`${REMOTE_HOST}:${REMOTE_PORT}`))).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("pi-dashboard-last-server"))).toBe(lastServerBefore);
    await expect(page.getByTitle("Switch server")).toHaveText(headerBefore ?? "");
  } finally {
    await request.delete("/api/known-servers", { data: { host: REMOTE_HOST, port: REMOTE_PORT }, headers });
  }
});

test("Browser: without the capability the in-page staging switch still runs (F5)", async ({ page, request }) => {
  const headers = await seedAvailableRemote(page, request);
  try {
    const sockets: string[] = [];
    page.on("websocket", (ws) => sockets.push(ws.url()));
    await gotoDashboard(page);
    expect(await page.evaluate(() => typeof (window as unknown as { piDashboard?: unknown }).piDashboard)).toBe("undefined");

    await page.getByTitle("Switch server").click();
    const row = page.getByRole("menuitemradio", { name: new RegExp(`${REMOTE_HOST}:${REMOTE_PORT}`) });
    await expect(row).toContainText("Available", { timeout: 15_000 });
    await row.click();

    // the transactional switch opens a staging socket at the target (it fails — the host is a stub — and is rolled back)
    await expect.poll(() => sockets.some((u) => u.includes(`${REMOTE_HOST}:${REMOTE_PORT}/ws`)), { timeout: 10_000 }).toBe(true);
  } finally {
    await request.delete("/api/known-servers", { data: { host: REMOTE_HOST, port: REMOTE_PORT }, headers });
  }
});

/**
 * group-servers-by-identity — test-plan F10 / F11 (L3). NOT RUN in the authoring session: they need the docker
 * harness (`docker/test-up.sh`), which that session did not have.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * F10: the REAL server challenges two addresses that both answer the harness's own identity, files them as two
 * routes of ONE entry, and the REAL browser then proves each route with a signed challenge: the selector shows one
 * `menuitemradio` with two route chips (kind + latency as text) and Settings ▸ Servers shows one card with two
 * route rows. The "two addresses" are the harness container's own IP and a `.local` alias (both resolve inside the
 * container, where the server listens on the dashboard port). The host browser cannot route to them, so each is
 * proxied to the published harness port with CORS added — the answers are still the real server's.
 * Open item (test-plan "New infra"): confirm the server inside the container may challenge its own address; when it
 * may not, F10 stays covered at L1 by F1/F7.
 *
 * F11: "Request access…" opens the peer's own `/pair?request` in a popup with no opener, and the opener page sends
 * nothing to that host once the action is activated (the knock is the landing's own same-origin call). The saved
 * route is an unresolvable `.local` name (kind `mdns`, on-link, no credential), as in the stale-name spec above.
 */
const TWIN_LABEL = "Harness twin";
const PEER_HOST = "studio-zz9-unresolvable.local";
const PEER_LABEL = "Studio ZZ9";

/** A second name the harness container answers to. The server admits only IPs and `.local` names as a Host header (`host_not_allowed`), so the container's bare hostname cannot be challenged. */
const TWIN_ALIAS = "harness-twin-zz9.local";

/**
 * Two addresses of the harness container, as the server inside it sees them: its own IP and `TWIN_ALIAS`, an
 * /etc/hosts entry added here (root exec) so the server resolves and challenges it. `[]` when docker is unavailable.
 */
function harnessAliases(): string[] {
  try {
    const id = execFileSync(
      "docker",
      ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`, "--filter", "label=com.docker.compose.service=pi-dashboard"],
      { encoding: "utf8", timeout: 30_000 },
    )
      .trim()
      .split("\n")[0];
    if (!id) return [];
    const run = (...cmd: string[]) => execFileSync("docker", ["exec", "-u", "0", id, ...cmd], { encoding: "utf8", timeout: 30_000 }).trim();
    const ip = run("hostname", "-i").split(/\s+/)[0];
    if (!ip) return [];
    run("sh", "-c", `grep -q " ${TWIN_ALIAS}$" /etc/hosts || echo "${ip} ${TWIN_ALIAS}" >> /etc/hosts`);
    return [ip, TWIN_ALIAS];
  } catch {
    return [];
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

/** Answer `http://<host>:<port>/…` with the harness's real server (same path), CORS added: the host browser cannot route to the alias. */
async function proxyToHarness(page: Page, host: string, port: number): Promise<void> {
  await page.route(
    (url) => url.hostname === host && url.port === String(port),
    async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const url = new URL(request.url());
      const response = await route.fetch({ url: `${BASE_URL}${url.pathname}${url.search}` });
      return route.fulfill({ response, headers: { ...response.headers(), ...CORS } });
    },
  );
}

/** The harness server's own fingerprint, as its public identity challenge proves it (SHA-256 of the SPKI key). */
async function ownFingerprint(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post("/api/pair/challenge", { data: { nonce: "f10-fingerprint-probe-nonce" } });
  const publicKey = (await res.json()).data.publicKey as string;
  return `sha256:${createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("base64url")}`;
}

/**
 * Seed ONE pinned entry with a route per address straight into the container's config. The add API refuses an
 * address that reaches the server's OWN dashboard (`409 self_address`, harden-peer-address-identity) and the harness
 * has no second dashboard, so the twin entry — one identity under two addresses — is written the way a restored
 * config would carry it. Everything the test asserts (selector row, route chips, Settings card) is browser-side.
 */
function seedTwinEntry(hosts: string[], fingerprint: string): void {
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`, "--filter", "label=com.docker.compose.service=pi-dashboard"],
    { encoding: "utf8", timeout: 30_000 },
  )
    .trim()
    .split("\n")[0];
  const entry = {
    host: hosts[0],
    port: DASHBOARD_PORT,
    label: TWIN_LABEL,
    addedAt: new Date().toISOString(),
    fingerprint,
    routes: hosts.map((host) => ({ host, port: DASHBOARD_PORT, scheme: "http", source: "saved" })),
  };
  const script = `const fs=require("fs");const p="/home/pi/.pi/dashboard/config.json";let c={};try{c=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}c.knownServers=[...(c.knownServers||[]).filter(e=>e.fingerprint!==${JSON.stringify(fingerprint)}),${JSON.stringify(entry)}];fs.writeFileSync(p,JSON.stringify(c,null,2));`;
  execFileSync("docker", ["exec", id!, "node", "-e", script], { timeout: 30_000 });
}

test("F10: one identity under two addresses is ONE selector row with two route chips and ONE Settings card", async ({ page, request }) => {
  const aliases = harnessAliases();
  test.skip(aliases.length < 2, "needs two names for the harness container (docker harness)");
  const headers = operatorHeaders();
  const fingerprint = await ownFingerprint(request);
  try {
    seedTwinEntry(aliases, fingerprint);
    await page.context().setExtraHTTPHeaders(headers);
    for (const host of aliases) await proxyToHarness(page, host, DASHBOARD_PORT);
    await gotoDashboard(page);

    await page.getByTitle("Switch server").click();
    const menu = page.getByRole("menu");
    const rows = menu.getByRole("menuitemradio", { name: new RegExp(TWIN_LABEL) });
    await expect(rows).toHaveCount(1, { timeout: 15_000 });
    await expect(menu.getByText("Checking…")).toHaveCount(0, { timeout: 15_000 });
    const chips = rows.getByTestId("route-chip");
    await expect(chips).toHaveCount(2);
    for (const chip of await chips.all()) await expect(chip).toHaveText(/\S.*\d+ ms/); // kind and latency, as text
    await page.keyboard.press("Escape");

    await page.goto("/settings/remote");
    const section = settingsSection(page, "Servers");
    const card = section.getByRole("article", { name: TWIN_LABEL });
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("route-row")).toHaveCount(2);
  } finally {
    await request.delete("/api/known-servers", { data: { fingerprint }, headers });
  }
});

test("F11: Request access opens the peer's own /pair?request in a popup with no opener, and the opener sends nothing to it", async ({ page, request }) => {
  const headers = operatorHeaders();
  const peerUrl = `http://${PEER_HOST}:8000/pair?request`;
  try {
    const seeded = await request.post("/api/known-servers", { data: { host: PEER_HOST, port: 8000, label: PEER_LABEL }, headers });
    expect((await seeded.json()).success).toBe(true);
    await page.context().setExtraHTTPHeaders(headers);
    // The popup must load: answer the peer's page (the host does not resolve). Route checks of the list get this too.
    await page.context().route(`http://${PEER_HOST}:8000/**`, (route) =>
      route.fulfill({ status: 200, headers: CORS, contentType: "text/html", body: "<title>peer request page</title>" }),
    );
    const sent: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).hostname === PEER_HOST) sent.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await gotoDashboard(page);

    const activate = async (open: () => Promise<void>, click: () => Promise<void>) => {
      await open();
      const before = sent.length;
      const [popup] = await Promise.all([page.waitForEvent("popup"), click()]);
      await popup.waitForLoadState();
      expect(popup.url()).toBe(peerUrl);
      expect(await popup.evaluate(() => window.opener)).toBeNull();
      expect(sent.slice(before)).toEqual([]); // the opener page sent nothing to that host after the click
      await popup.close();
    };

    // 1) the header selector
    const menu = page.getByRole("menu");
    await activate(
      async () => {
        await page.getByTitle("Switch server").click();
        await expect(menu.getByText("Checking…")).toHaveCount(0, { timeout: 15_000 });
      },
      () => menu.getByRole("menuitem", { name: /Request access/ }).click(),
    );

    // 2) Settings ▸ Servers
    const section = settingsSection(page, "Servers");
    await activate(
      async () => {
        await page.goto("/settings/remote");
        await section.waitFor({ state: "visible" });
        await expect(section.getByText("Checking…")).toHaveCount(0, { timeout: 15_000 });
      },
      () => section.getByRole("button", { name: new RegExp(`^Request access… ${PEER_LABEL}`) }).click(),
    );
  } finally {
    await request.delete("/api/known-servers", { data: { host: PEER_HOST, port: 8000 }, headers });
  }
});
