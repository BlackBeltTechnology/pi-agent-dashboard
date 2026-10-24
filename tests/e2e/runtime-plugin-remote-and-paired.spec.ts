import type { Browser, BrowserContext, Page, Response } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { pairBrowserBearer, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { expirePairedDevice } from "./helpers/expire-paired-device.js";
import { CANARY_ID, ensureCanaryState, runtimeListing } from "./helpers/runtime-canary.js";
import { BASE_URL, DASHBOARD_PORT } from "./lifecycle.js";

/**
 * L3 — runtime plugin code loading across client/server topologies (change: decouple-plugins-from-core;
 * test-plan #F13, #F14). Harness: default `trusted` canary (docker/test-up.sh, task 7.5).
 *
 * F13  a bearer-only paired device (no cookie) loads plugin code through `<script type="module">`/`import()`, which
 *      never carries an `Authorization` header — so `/plugin-assets/**` MUST be served under the same rule as
 *      `/assets/**` (task 6.9): it succeeds iff `/assets/*` loads, and no request for either carries a bearer.
 * F14  a client switched to ANOTHER dashboard (different origin ⇒ non-empty API base) loads no runtime plugin code:
 *      0 `/plugin-assets` requests, the Plugins tab says why, build-time claims still render. The "second dashboard"
 *      is the harness itself reached through its other loopback name (`127.0.0.1` vs `localhost`): a distinct origin
 *      that exercises exactly the remote-API-base rule the loader keys on.
 */

const BEARER_KEY = "pi-dashboard:device-bearer";
const LAST_SERVER_KEY = "pi-dashboard-last-server";

test.describe("runtime plugin loading — topologies", () => {
  test("F13: a bearer-only paired context loads the plugin entry with no Authorization header", async ({ browser, request }) => {
    await ensureCanaryState(request, "trusted");
    const context = await browser.newContext({ baseURL: BASE_URL }); // fresh: no cookie
    try {
      await context.addInitScript(([key]) => localStorage.setItem(key, "e2e-bearer-without-cookie"), [BEARER_KEY]);
      const page = await context.newPage();
      const modules: Array<{ url: string; status: number; auth: string | undefined }> = [];
      page.on("response", async (r) => {
        const url = r.url();
        if (url.includes("/plugin-assets/") || /\/assets\/[^/]+\.js$/.test(url)) {
          modules.push({ url, status: r.status(), auth: (await r.request().allHeaders()).authorization });
        }
      });
      await page.goto("/");
      await expect.poll(() => modules.some((m) => m.url.includes(`/plugin-assets/${CANARY_ID}/`) && m.url.endsWith("/index.js")), { timeout: 30_000 }).toBe(true);
      const assets = modules.filter((m) => !m.url.includes("/plugin-assets/"));
      const plugin = modules.filter((m) => m.url.includes("/plugin-assets/"));
      expect(assets.length, "the shell's own /assets/* loaded").toBeGreaterThan(0);
      // Same rule: the plugin module succeeds exactly when the host's own assets do.
      expect(plugin.every((m) => m.status === 200)).toBe(assets.every((m) => m.status === 200));
      expect(plugin.every((m) => m.status === 200), "plugin asset requests succeed").toBe(true);
      // A module request never carries the device bearer.
      expect(plugin.map((m) => m.auth)).toEqual(plugin.map(() => undefined));
      expect(assets.map((m) => m.auth)).toEqual(assets.map(() => undefined));
    } finally {
      await context.close();
    }
  });

  test("F14: a client targeting another dashboard loads no runtime plugin code and says why", async ({ browser, request }) => {
    // The remote-server topology needs cross-origin `fetch`; an ENFORCED `connect-src 'self' ws: wss:` refuses it,
    // so this runs on the report-only boot (the default), not the `PI_DASHBOARD_CSP=enforce` one.
    const csp = (await request.get("/")).headers()["content-security-policy"];
    test.skip(!!csp, "enforced CSP blocks the cross-origin API base this topology needs; run on the report-only harness");
    await ensureCanaryState(request, "trusted");
    expect((await runtimeListing(request)).map((p) => p.id), "the target dashboard admits the canary").toContain(CANARY_ID);
    const context = await browser.newContext({ baseURL: `http://localhost:${DASHBOARD_PORT}` });
    try {
      // The saved "last server" makes the client connect (WS + API base) to the OTHER origin.
      await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [LAST_SERVER_KEY, `127.0.0.1:${DASHBOARD_PORT}`]);
      const page = await context.newPage();
      const assetRequests: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/plugin-assets")) assetRequests.push(r.url());
      });
      await page.goto("/settings/plugins");
      await expect(page.getByTestId("plugins-runtime-notice-remote-server")).toBeVisible({ timeout: 30_000 });
      // Build-time claims stay: the shell and its settings rail render normally.
      await expect(page.getByTestId("settings-nav-rail")).toBeVisible();
      await expect(page.getByTestId("canary-settings")).toHaveCount(0);
      expect(assetRequests).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

/**
 * L3 — per-server browser bearer slots, rotation and expiry on the F14 topology (change:
 * harden-auth-credentials; test-plan #AF1–#AF5). The page is `http://localhost:<port>` and its API is the SAME
 * harness under its other loopback name `http://127.0.0.1:<port>` — a distinct origin, so the client keeps a
 * browser-held `{token, expiresAt}` in `pi-dashboard:device-bearer:<apiOrigin>`. Like F14 these need a cross-origin
 * `fetch`, so they run on the report-only boot, not under `PI_DASHBOARD_CSP=enforce`.
 */
const PAGE_ORIGIN = `http://localhost:${DASHBOARD_PORT}`;
const API_ORIGIN = `http://127.0.0.1:${DASHBOARD_PORT}`;
const slotKey = (origin: string) => `${BEARER_KEY}:${origin}`;
const ROTATE = "/api/paired-devices/rotate";

interface Slot {
  token: string;
  expiresAt?: number;
}

/** A context on the page origin whose saved server is the API origin, with `slots` seeded ONCE (reloads keep what the app wrote). */
async function crossOriginContext(browser: Browser, slots: Record<string, Slot>, legacy?: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: PAGE_ORIGIN });
  await context.addInitScript(
    ([lastKey, last, seeded, legacyKey, legacyValue]) => {
      // Seed once per origin: a later document (reload, re-pair landing, probe page) must see what the app left.
      if (localStorage.getItem("__e2e_seeded") !== null) return;
      localStorage.setItem("__e2e_seeded", "1");
      localStorage.setItem(lastKey as string, last as string);
      for (const [key, value] of Object.entries(seeded as Record<string, string>)) localStorage.setItem(key, value);
      if (legacyKey && legacyValue) localStorage.setItem(legacyKey as string, legacyValue as string);
    },
    [
      LAST_SERVER_KEY,
      `127.0.0.1:${DASHBOARD_PORT}`,
      Object.fromEntries(Object.entries(slots).map(([origin, slot]) => [slotKey(origin), JSON.stringify(slot)])),
      legacy ? BEARER_KEY : "",
      legacy ?? "",
    ],
  );
  return context;
}

/** Record every request's URL and `Authorization` header (resolved lazily; `allHeaders` is async). */
function recordRequests(page: Page): () => Promise<Array<{ url: string; auth: string | undefined }>> {
  const pending: Array<Promise<{ url: string; auth: string | undefined }>> = [];
  page.on("request", (r) => {
    // `allHeaders` never settles for a request the page aborted (reload / navigation) and rejects once the page is
    // gone: bound it, so one dead request cannot hold up the whole recording. The URL alone is still evidence.
    const url = r.url();
    const settled = r
      .allHeaders()
      .then((h) => ({ url, auth: h.authorization }))
      .catch(() => ({ url, auth: undefined }));
    const bound = new Promise<{ url: string; auth: string | undefined }>((resolve) => setTimeout(() => resolve({ url, auth: undefined }), 3000));
    pending.push(Promise.race([settled, bound]));
  });
  return () => Promise.all(pending);
}

const readSlot = (page: Page, origin: string): Promise<Slot | null> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), slotKey(origin));

/** The `{token, expiresAt}` of a 200 rotate answer (bare or enveloped). */
async function rotated(res: Response): Promise<Slot> {
  const body = await res.json();
  return (body?.data ?? body) as Slot;
}

/**
 * Record rotate answers inside the page (status + parsed body): Playwright cannot read the body of a cross-origin
 * response that a route handler continued, so the spec observes them where the client does.
 */
const RECORD_ROTATE_ANSWERS = (rotatePath: string) => {
  const w = window as unknown as { __rotateAnswers: Array<{ status: number; body: unknown }> };
  w.__rotateAnswers = [];
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith(rotatePath)) {
      const body = await res
        .clone()
        .json()
        .catch(() => null);
      w.__rotateAnswers.push({ status: res.status, body });
    }
    return res;
  };
};

/**
 * In-page recorder for AF4, kept in `localStorage` (read back from a probe page: the re-pair navigation changes
 * origin). Every outgoing call is numbered in dispatch order with its `Authorization`; the first 401 answer from
 * `apiOrigin` freezes the call counter at that instant, so "issued after the 401" is exact (Playwright's own
 * request/response event order is not).
 */
const RECORD_CALLS_AND_401S = (apiOrigin: string) => {
  const original = window.fetch.bind(window);
  const read = <T>(key: string, fallback: T): T => JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback)) as T;
  window.fetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const calls = read<Array<string | null>>("__e2e_calls", []);
    localStorage.setItem("__e2e_calls", JSON.stringify([...calls, headers.get("authorization")]));
    const res = await original(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (res.status === 401 && url.startsWith(`${apiOrigin}/api/`)) {
      const body = (await res
        .clone()
        .json()
        .catch(() => null)) as { code?: string } | null;
      if (localStorage.getItem("__e2e_first401") === null) localStorage.setItem("__e2e_first401", String(read<unknown[]>("__e2e_calls", []).length));
      localStorage.setItem("__e2e401", JSON.stringify([...read<Array<string | null>>("__e2e401", []), body?.code ?? null]));
    }
    return res;
  };
};

const isRotate = (res: Response) => res.url() === `${API_ORIGIN}${ROTATE}` && res.request().method() === "POST";

test.describe("browser bearer slots — F14 topology", () => {
  test.beforeEach(async ({ request }) => {
    const csp = (await request.get("/")).headers()["content-security-policy"];
    test.skip(!!csp, "enforced CSP blocks the cross-origin API base this topology needs; run on the report-only harness");
  });

  test("AF1: the legacy global bearer is discarded, never sent, and nothing is re-created before a new pairing", async ({ browser }) => {
    const context = await crossOriginContext(browser, {}, "legacy-e2e-tok");
    try {
      const page = await context.newPage();
      const requests = recordRequests(page);
      await page.goto("/");
      await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), BEARER_KEY)).toBeNull();
      await expect.poll(async () => (await requests()).some((r) => r.url.startsWith(`${API_ORIGIN}/api/`)), { timeout: 30_000 }).toBe(true);
      const recorded = await requests();
      expect(recorded.filter((r) => r.auth?.includes("legacy-e2e-tok"))).toEqual([]);
      const slots = await page.evaluate((prefix) => Object.keys(localStorage).filter((k) => k.startsWith(`${prefix}:`)), BEARER_KEY);
      expect(slots, "no per-origin slot before a new pairing completes").toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("AF2: two tabs rotating at once converge on one bearer (one 200, one 409, no re-pair, no 401)", async ({ browser }) => {
    const paired = await pairBrowserBearer(API_ORIGIN, { label: "af2-two-tabs" });
    const context = await crossOriginContext(browser, { [API_ORIGIN]: paired });
    try {
      // Hold both tabs' startup rotations until both are in flight, then release them together.
      let inFlight = 0;
      let release!: () => void;
      const bothHeld = new Promise<void>((r) => {
        release = r;
      });
      await context.addInitScript(RECORD_ROTATE_ANSWERS, ROTATE);
      await context.route(`**${ROTATE}`, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        if (++inFlight === 2) release();
        await bothHeld;
        await route.continue();
      });
      const pages = [await context.newPage(), await context.newPage()];
      const rotateResponses: Response[] = [];
      const unauthorised: string[] = [];
      for (const page of pages) {
        page.on("response", (res) => {
          if (isRotate(res)) rotateResponses.push(res);
          if (res.url().startsWith(`${API_ORIGIN}/api/`) && res.status() === 401) unauthorised.push(res.url());
        });
      }
      await Promise.all(pages.map((p) => p.goto("/")));
      await expect.poll(() => rotateResponses.length, { timeout: 30_000 }).toBe(2);
      const statuses = rotateResponses.map((r) => r.status()).sort();
      expect(statuses).toEqual([200, 409]);
      const answers = (
        await Promise.all(pages.map((p) => p.evaluate(() => (window as unknown as { __rotateAnswers: Array<{ status: number; body: unknown }> }).__rotateAnswers)))
      ).flat();
      const loser = answers.find((a) => a.status === 409);
      expect(loser?.body).toMatchObject({ code: "bearer_superseded" });
      const winnerBody = answers.find((a) => a.status === 200)?.body as { data?: Slot } & Slot;
      const fresh = (winnerBody?.data ?? winnerBody) as Slot;
      for (const page of pages) {
        await expect.poll(async () => (await readSlot(page, API_ORIGIN))?.token).toBe(fresh.token);
      }
      // The next REST call in each tab carries that same token.
      const sent: Array<string | null> = [];
      for (const page of pages) {
        const req = page.waitForRequest((r) => r.url() === `${API_ORIGIN}/api/sessions`);
        await page.evaluate((url) => fetch(url), `${API_ORIGIN}/api/sessions`);
        sent.push((await (await req).allHeaders()).authorization ?? null);
      }
      expect(sent).toEqual([`Bearer ${fresh.token}`, `Bearer ${fresh.token}`]);
      expect(unauthorised).toEqual([]);
      for (const page of pages) expect(page.url()).not.toContain("/pair");
    } finally {
      await context.close();
    }
  });

  test("AF3: a rotated bearer survives reloads — the slot always holds the last 200's token and it authenticates", async ({ browser, request }) => {
    const paired = await pairBrowserBearer(API_ORIGIN, { label: "af3-reload" });
    const context = await crossOriginContext(browser, { [API_ORIGIN]: paired });
    try {
      const page = await context.newPage();
      let previous = paired.token;
      for (let load = 0; load < 3; load++) {
        const [res] = await Promise.all([page.waitForResponse(isRotate, { timeout: 30_000 }), load === 0 ? page.goto("/") : page.reload()]);
        expect(res.status(), `rotation on load #${load + 1}`).toBe(200);
        const fresh = await rotated(res);
        expect(fresh.token).not.toBe(previous);
        await expect.poll(async () => (await readSlot(page, API_ORIGIN))?.token).toBe(fresh.token);
        const check = await request.get(`${API_ORIGIN}/api/sessions`, { headers: { Authorization: `Bearer ${fresh.token}` } });
        expect(check.status(), "the newest bearer authenticates").toBe(200);
        previous = fresh.token;
      }
    } finally {
      await context.close();
    }
  });

  test("AF4: an expired bearer is answered 401 bearer_expired, the slot is removed and the bearer is not retried", async ({ browser }) => {
    const paired = await pairBrowserBearer(API_ORIGIN, { label: "af4-expired" });
    await expirePairedDevice("af4-expired");
    // The client still believes it has days left: only the server knows the row aged out.
    const context = await crossOriginContext(browser, { [API_ORIGIN]: paired });
    try {
      await context.addInitScript(RECORD_CALLS_AND_401S, API_ORIGIN);
      const page = await context.newPage();
      await page.goto("/");
      await expect(page).toHaveURL(/\/pair\?request/, { timeout: 30_000 }); // the pairing landing, reached once
      // The landing is on the API origin; the slot and the recorded answers live on the page origin.
      const probe = await context.newPage();
      await probe.goto(`${PAGE_ORIGIN}/api/health`);
      const codes = await probe.evaluate(() => JSON.parse(localStorage.getItem("__e2e401") ?? "[]"));
      expect(codes, "the first 401 is the distinct expiry answer").toContain("bearer_expired");
      expect((await readSlot(probe, API_ORIGIN)) ?? "removed").toBe("removed");
      // The startup burst is already in flight when the first 401 lands (cross-origin-client: "concurrent expired
      // responses re-pair once"), so "not retried" means: no call is DISPATCHED with the expired bearer after that 401.
      const calls = await probe.evaluate(() => JSON.parse(localStorage.getItem("__e2e_calls") ?? "[]") as Array<string | null>);
      const first401 = Number(await probe.evaluate(() => localStorage.getItem("__e2e_first401")));
      expect(first401, "a 401 was observed").toBeGreaterThan(0);
      const retried = calls.slice(first401).filter((auth) => auth === `Bearer ${paired.token}`);
      expect(retried, "calls dispatched with the expired bearer after the 401").toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("AF5: switching servers presents each request only its own server's bearer and leaves the other slot intact", async ({ browser }) => {
    // The harness is ONE server reached under two loopback names, and the ServerSelector groups routes of one
    // identity into a single row — so there is no second selector row to click here. The client's server choice is
    // the persisted last server (what the selector writes, read at boot): A → B → A is driven through it + reload.
    // Server A = the page's own origin (same-origin slot, no expiry); server B = the other name (browser holder).
    const tokenA = await pairDeviceBearer(PAGE_ORIGIN);
    const tokenB = await pairBrowserBearer(API_ORIGIN, { label: "af5-server-b" });
    const context = await crossOriginContext(browser, { [PAGE_ORIGIN]: { token: tokenA }, [API_ORIGIN]: tokenB });
    try {
      const page = await context.newPage();
      const requests = recordRequests(page);
      const select = async (hostPort: string) => {
        await page.evaluate(([key, value]) => localStorage.setItem(key, value), [LAST_SERVER_KEY, hostPort]);
        await page.reload();
        await expect(page.getByTestId("connection-chip")).toBeVisible({ timeout: 30_000 });
      };
      await page.goto("/"); // saved server = B (seeded)
      await expect(page.getByTestId("connection-chip")).toBeVisible({ timeout: 30_000 });
      await select(`localhost:${DASHBOARD_PORT}`); // B → A
      await select(`127.0.0.1:${DASHBOARD_PORT}`); // A → B
      const slotB = await readSlot(page, API_ORIGIN);
      const recorded = (await requests()).filter((r) => r.url.includes("/api/") && r.auth);
      const toA = recorded.filter((r) => r.url.startsWith(PAGE_ORIGIN));
      const toB = recorded.filter((r) => r.url.startsWith(API_ORIGIN));
      expect(toA.length, "the switch actually exercised A").toBeGreaterThan(0);
      expect(toB.length, "the switch actually exercised B").toBeGreaterThan(0);
      expect(toA.every((r) => r.auth === `Bearer ${tokenA}`), "A requests carry only A's bearer").toBe(true);
      // B's bearer is rotated on every startup against B, so B requests carry B's current lineage, which is never A's.
      expect(toB.every((r) => r.auth !== `Bearer ${tokenA}`), "B requests never carry A's bearer").toBe(true);
      expect(await page.evaluate((k) => localStorage.getItem(k), slotKey(PAGE_ORIGIN))).toBe(JSON.stringify({ token: tokenA }));
      expect(slotB?.token, "B's slot holds a bearer of its own").toBeTruthy();
      expect(slotB?.token).not.toBe(tokenA);
      expect(await page.evaluate((k) => localStorage.getItem(k), slotKey(PAGE_ORIGIN))).not.toContain(String(slotB?.token));
    } finally {
      await context.close();
    }
  });
});
