/**
 * E2E: Settings → Services (change: add-services-settings-ui, test-plan F1, F3,
 * F7–F15, X10–X12).
 *
 * Services here are user-origin `attached` definitions whose start command is a
 * `node -e` script inside the harness container, so no container runtime is
 * needed. The operator session (`OperatorSession`) gives the browser and REST
 * calls `operate` authority; ports are random per run so a re-run against the
 * same container never finds a stale listener.
 */
import { execFileSync } from "node:child_process";
import type { APIRequestContext, WebSocketRoute } from "@playwright/test";
import { expect, type Page, test } from "./fixtures.js";
import {
  buttonsWithoutFocusIndicator,
  contrastFailures,
  measureText,
  setThemeMode,
} from "./helpers/computed-contrast.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { gotoDashboard } from "./helpers/index.js";
import { OperatorSession } from "./helpers/operator-session.js";

const op = new OperatorSession();
const BASE_PORT = 47_000 + Math.floor(Math.random() * 900);
let portCursor = 0;
const nextPort = () => BASE_PORT + portCursor++;
const created = new Set<string>();

/** A `node -e` HTTP-less TCP listener that prints `print` and starts listening after `delayMs`. */
function script(port: number, delayMs: number, print = ""): string {
  return `${print}setTimeout(()=>require("net").createServer((s)=>s.end()).listen(${port},"127.0.0.1"),${delayMs});setInterval(()=>{},1e6);`;
}

function attachedDef(id: string, o: { delay?: number; print?: string; secret?: boolean; port?: number } = {}) {
  const port = o.port ?? nextPort();
  return {
    id,
    mode: "attached",
    endpoints: { http: `http://127.0.0.1:${port}` },
    lifecycle: { start: { linux: ["node", "-e", script(port, o.delay ?? 0, o.print ?? "")] } },
    health: { kind: "tcp", endpoint: "http" },
    ...(o.secret ? { secrets: { token: { env: "SVC_TOKEN" } } } : {}),
  };
}

async function add(request: APIRequestContext, def: { id: string }): Promise<void> {
  const res = await request.post("/api/services", { headers: op.headers(), data: { definition: def, dryRun: false } });
  expect(res.status(), await res.text()).toBe(200);
  created.add(def.id);
}

async function removeAll(request: APIRequestContext): Promise<void> {
  for (const id of created) await request.delete(`/api/services/${id}`, { headers: op.headers() }).catch(() => undefined);
  created.clear();
}

const exec = (script: string): string =>
  execFileSync("docker", ["exec", resolveContainer(), "sh", "-c", script], { encoding: "utf8" }).trim();

/** Up and answering: `healthy`, or `idle` once the 30 s tick has seen a lease-less start (both mean running). */
async function expectRunning(page: Page, id: string): Promise<void> {
  await expect.poll(() => pill(page, id).getAttribute("data-state"), { timeout: 30_000 }).toMatch(/^(healthy|idle)$/);
}

const row = (page: Page, id: string) => page.getByTestId(`service-row-${id}`);
const pill = (page: Page, id: string) => row(page, id).getByTestId("service-state-pill");

async function openList(page: Page): Promise<void> {
  await gotoDashboard(page);
  await page.goto("/settings/services");
  await expect(page.getByTestId("services-list-page")).toBeVisible({ timeout: 20_000 });
}

async function openDetail(page: Page, id: string): Promise<void> {
  await gotoDashboard(page);
  await page.goto(`/settings/services/${id}`);
  await expect(page.getByTestId("service-detail")).toBeVisible({ timeout: 20_000 });
}

/** AA failures of every visible text under the settings content at `target`. */
async function contrastFailuresAt(page: Page, target: string): Promise<string[]> {
  await page.goto(target);
  const scope = page.getByTestId("settings-content");
  await expect(scope).toBeVisible({ timeout: 20_000 });
  if (target.endsWith("runtimes")) await expect(page.getByTestId("runtimes-table")).toBeVisible({ timeout: 20_000 });
  else await expect(scope.locator("[data-testid]").first()).toBeVisible();
  const ms = await measureText(scope);
  expect(ms.length, `${target}: measured no text`).toBeGreaterThan(0);
  return contrastFailures(ms, 4.5);
}

/** Tab from the back button until every action button of the detail has had focus. */
async function expectEveryActionReachableByTab(page: Page): Promise<void> {
  const names = await page.getByTestId("service-actions").locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid") ?? ""));
  expect(names.length).toBeGreaterThan(0);
  const reached = new Set<string>();
  await page.getByTestId("service-back").focus();
  for (let i = 0; i < 40 && reached.size < names.length; i++) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");
    if (names.includes(id)) reached.add(id);
  }
  expect([...reached].sort()).toEqual([...names].sort());
}

test.describe("Settings → Services", () => {
  test.beforeEach(async ({ request, context }) => {
    await op.arm(request, context);
  });
  test.afterEach(async ({ request }) => {
    await removeAll(request);
  });

  test("F1 — a Start converges starting → healthy without a reload, no probing detail GET", async ({ page, request }) => {
    await add(request, attachedDef("e2e-slow", { delay: 2_000 }));
    const detailGets: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "GET" && new URL(r.url()).pathname === "/api/services/e2e-slow") detailGets.push(r.url());
    });
    await openList(page);
    await expect(pill(page, "e2e-slow")).toHaveAttribute("data-state", "stopped");
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    const start = request.post("/api/services/e2e-slow/start", { headers: op.headers() }); // resolves once healthy
    await expect(pill(page, "e2e-slow")).toHaveAttribute("data-state", "starting", { timeout: 15_000 });
    await expectRunning(page, "e2e-slow");
    await start;
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
    expect(detailGets).toEqual([]);
  });

  test("F3 — a change made while the socket was down appears after reconnect, no reload", async ({ page, request }) => {
    await add(request, attachedDef("e2e-recon"));
    const routes: WebSocketRoute[] = [];
    const gate = { drop: false };
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      routes.push(ws);
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => {
        if (!gate.drop) ws.send(m);
      });
    });
    await openList(page);
    await expect(pill(page, "e2e-recon")).toHaveAttribute("data-state", "stopped");
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    gate.drop = true; // the page no longer hears the server …
    const res = await request.post("/api/services/e2e-recon/start", { headers: op.headers() });
    expect(res.ok()).toBe(true);
    await page.waitForTimeout(1_000);
    await expect(pill(page, "e2e-recon")).toHaveAttribute("data-state", "stopped"); // … so it is stale

    gate.drop = false;
    routes[routes.length - 1].close(); // drop the socket; the client reconnects
    await expectRunning(page, "e2e-recon");
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  });

  test("F7 — add: a dry run first, then Confirm; prefetch is never sent unless ticked", async ({ page }) => {
    const def = attachedDef("e2e-added");
    created.add("e2e-added");
    const posts: Array<{ dryRun: boolean }> = [];
    const prefetches: string[] = [];
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (r.method() === "POST" && p === "/api/services") posts.push(JSON.parse(r.postData() ?? "{}"));
      if (r.method() === "POST" && p.endsWith("/prefetch")) prefetches.push(p);
    });
    await openList(page);
    await page.getByTestId("services-add-open").click();
    await page.getByTestId("service-add-source-paste").click();
    await page.getByTestId("service-add-json").fill(JSON.stringify(def));
    await page.getByTestId("service-add-review-button").click();
    await expect(page.getByTestId("service-add-review")).toBeVisible();
    await page.getByTestId("service-add-confirm").click();
    await expect(page.getByTestId("service-add-done")).toBeVisible();
    expect(posts.map((b) => b.dryRun)).toEqual([true, false]);
    expect(prefetches).toEqual([]);
    await page.getByTestId("service-add-open").click();
    await expect(page.getByTestId("service-detail")).toHaveAttribute("data-service", "e2e-added");
  });

  test("F8 — an unknown key is listed, Add stays unavailable, nothing is written", async ({ page, request }) => {
    await add(request, attachedDef("e2e-anchor")); // a services.json to compare against
    await openList(page);
    await page.getByTestId("services-add-open").click();
    await page.getByTestId("service-add-source-paste").click();
    await page.getByTestId("service-add-json").fill(JSON.stringify({ ...attachedDef("e2e-bad"), privileged: true }));
    await page.getByTestId("service-add-review-button").click();
    const errors = page.getByTestId("service-add-errors");
    await expect(errors).toBeVisible();
    await expect(errors.getByRole("listitem").first()).toContainText("privileged");
    await expect(page.getByTestId("service-add-confirm")).toHaveCount(0);
    const list = (await (await request.get("/api/services", { headers: op.headers() })).json()) as { data: { services: Array<{ id: string }> } };
    expect(list.data.services.map((s) => s.id)).not.toContain("e2e-bad");
  });

  test("F9 — a secret is write-only: the input clears and the value is nowhere in the page or the network", async ({ page, request }) => {
    const VALUE = "f9-secret-value-ZZZZ";
    await add(request, attachedDef("e2e-secret", { secret: true }));
    const bodies: string[] = [];
    page.on("response", async (res) => {
      if (res.url().includes("/api/services")) bodies.push(await res.text().catch(() => ""));
    });
    await openDetail(page, "e2e-secret");
    await expect(page.getByTestId("service-secret-badge-token")).toHaveText("Not set");
    await page.getByTestId("service-secret-input-token").fill(VALUE);
    await page.getByTestId("service-secret-save-token").click();
    await expect(page.getByTestId("service-secret-input-token")).toHaveValue("");
    await expect(page.getByTestId("service-secret-badge-token")).toHaveText("Set");
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toContain(VALUE);
    expect((await page.locator("body").textContent()) ?? "").not.toContain(VALUE);
  });

  test("F10 — Reset data needs the exact id typed; Remove without the tick sends no purgeData", async ({ page, request }) => {
    const def = {
      id: "e2e-vol",
      mode: "managed",
      drivers: ["oci:docker"],
      oci: { image: `ghcr.io/example/e2e@sha256:${"a".repeat(64)}`, ports: { http: { container: 80, protocol: "http" } }, volumes: { "e2e-vol-data": "/data" } },
      health: { kind: "http", endpoint: "http", path: "/" },
    };
    await add(request, def);
    const deletes: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "DELETE") deletes.push(r.url());
    });
    await openDetail(page, "e2e-vol");
    await page.getByTestId("service-action-reset-data").click();
    const confirm = page.getByTestId("service-reset-confirm");
    await expect(confirm).toBeDisabled();
    await page.getByTestId("service-reset-typed").fill("e2e-v");
    await expect(confirm).toBeDisabled();
    await page.getByTestId("service-reset-typed").fill("e2e-vol");
    await expect(confirm).toBeEnabled();
    await page.getByTestId("service-reset-cancel").click();

    await page.getByTestId("service-action-remove").click();
    await expect(page.getByTestId("service-remove-purge")).not.toBeChecked();
    await page.getByTestId("service-remove-confirm").click();
    await expect(page.getByTestId("services-list-page")).toBeVisible({ timeout: 15_000 });
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).not.toContain("purgeData");
    created.delete("e2e-vol");
  });

  test("F11 — prune previews first and confirms exactly the previewed ids", async ({ page, request }) => {
    await add(request, attachedDef("e2e-keep")); // services.json must exist for prune
    exec('mkdir -p "$HOME/.pi/dashboard/services-run/orphan-e2e"');
    const prunes: Array<{ dryRun: boolean; ids?: string[] }> = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/services/prune") prunes.push(JSON.parse(r.postData() ?? "{}"));
    });
    await openList(page);
    await page.getByTestId("services-prune-open").click();
    const candidates = page.getByTestId("service-prune-candidates");
    await expect(candidates).toContainText("orphan-e2e");
    expect(prunes).toEqual([{ dryRun: true }]);
    await page.getByTestId("service-prune-confirm").click();
    await expect(page.getByTestId("service-prune-removed")).toBeVisible();
    expect(prunes[1]).toEqual({ dryRun: false, ids: ["orphan-e2e"] });
    expect(exec('[ -d "$HOME/.pi/dashboard/services-run/orphan-e2e" ] && echo yes || echo no')).toBe("no");
  });

  test("F12 — an observer-tier session sees every action disabled, one banner, and sends no logs request", async ({ page, request }) => {
    await add(request, attachedDef("e2e-ro"));
    const logs: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.endsWith("/logs")) logs.push(r.url());
    });
    // The list the server would give a caller below operate.
    await page.route("**/api/services", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const body = (await res.json()) as { data: { canOperate?: boolean } };
      body.data.canOperate = false;
      return route.fulfill({ response: res, json: body });
    });
    await openDetail(page, "e2e-ro");
    await expect(page.getByTestId("services-readonly-banner")).toHaveCount(1);
    for (const b of await page.getByTestId("service-actions").locator("button").all()) await expect(b).toBeDisabled();
    await expect(page.getByTestId("service-action-remove")).toBeDisabled();
    await expect(page.getByTestId("service-logs-readonly")).toBeVisible();
    expect(logs).toEqual([]);
  });

  test("F13 — output is shown as text and the secret as a marked redaction", async ({ page, request }) => {
    const SECRET = "f13-secret-value-QQQQ";
    const def = attachedDef("e2e-logs", { secret: true, print: 'console.log("<script>window.__xss=1</script>");console.log("token="+process.env.SVC_TOKEN);' });
    await add(request, def);
    expect((await request.put("/api/services/e2e-logs/secrets/token", { headers: op.headers(), data: { value: SECRET } })).ok()).toBe(true);
    expect((await request.post("/api/services/e2e-logs/start", { headers: op.headers() })).ok()).toBe(true);
    await openDetail(page, "e2e-logs");
    await page.getByTestId("service-logs-load").click();
    const pre = page.getByTestId("service-logs-lines");
    await expect(pre).toContainText("<script>window.__xss=1</script>");
    await expect(pre.getByTestId("service-log-mark")).toHaveText("«secret:token»");
    expect(await pre.textContent()).not.toContain(SECRET);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("F14 — a lease holder renders as literal text, never markup", async ({ page, request }) => {
    const HOLDER = "<img src=x onerror=window.__holderXss=1>";
    await add(request, attachedDef("e2e-lease"));
    expect((await request.post("/api/services/e2e-lease/ensure", { headers: op.headers(), data: { holder: HOLDER } })).ok()).toBe(true);
    const imgRequests: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.endsWith("/x")) imgRequests.push(r.url());
    });
    await openDetail(page, "e2e-lease");
    await expect(page.getByTestId("service-lease-holder")).toHaveText(HOLDER);
    expect(imgRequests).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __holderXss?: number }).__holderXss)).toBeUndefined();
  });

  test("F15 — list, detail and runtimes: AA contrast in base dark and light; every action is reachable by Tab with a focus indicator", async ({ page, request }) => {
    await add(request, attachedDef("e2e-a11y"));
    expect((await request.post("/api/services/e2e-a11y/start", { headers: op.headers() })).ok()).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const mode of ["dark", "light"] as const) {
      await openList(page);
      await setThemeMode(page, mode);
      for (const target of ["/settings/services", "/settings/services/e2e-a11y", "/settings/runtimes"]) {
        expect(await contrastFailuresAt(page, target), `${target} ${mode}`).toEqual([]);
      }
      await page.goto("/settings/services/e2e-a11y");
      await expect(page.getByTestId("service-actions")).toBeVisible({ timeout: 20_000 });
      expect(await buttonsWithoutFocusIndicator(page, page.getByTestId("service-detail"))).toEqual([]);
      await expectEveryActionReachableByTab(page);
    }
  });

  test("X10 — a refused action shows the server's code and hint at the action", async ({ page, request }) => {
    await add(request, attachedDef("e2e-x10"));
    await page.route("**/api/services/e2e-x10/start", (route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ success: false, error: "lifecycle-lock-timeout", message: "another start is in progress" }) }),
    );
    await openDetail(page, "e2e-x10");
    await page.getByTestId("service-action-start").click();
    const err = page.getByTestId("service-action-error");
    await expect(err).toContainText("lifecycle-lock-timeout");
    await expect(err).toContainText("another start is in progress");
    await expect(page.getByTestId("toast-action")).toHaveCount(0);
  });

  test("X11 — operate_required shows its reason and remedies at the action", async ({ page, request }) => {
    await add(request, attachedDef("e2e-x11"));
    expect((await request.post("/api/services/e2e-x11/start", { headers: op.headers() })).ok()).toBe(true);
    await page.route("**/api/services/e2e-x11/stop", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ success: false, error: "operate_required", message: "service mutations need an operate-tier credential or a locally trusted caller", reason: "no-credential", remedies: ["use-host", "sign-in"] }),
      }),
    );
    await openDetail(page, "e2e-x11");
    await page.getByTestId("service-action-stop").click();
    const callout = page.getByTestId("service-action-error-operate");
    await expect(callout).toBeVisible();
    await expect(callout.locator("[data-remedy]")).toHaveCount(2);
  });

  test("X12 — corrupt definitions: the banner names the backup path and prune is refused", async ({ page, request }) => {
    await add(request, attachedDef("e2e-corrupt"));
    created.delete("e2e-corrupt"); // the file is replaced below
    exec('printf "{ not json" > "$HOME/.pi/dashboard/services.json"');
    // A write attempt quarantines the corrupt file and names its backup.
    const refused = await request.post("/api/services", { headers: op.headers(), data: { definition: attachedDef("e2e-after"), dryRun: false } });
    expect(refused.status()).toBe(409);
    try {
      await openList(page);
      const banner = page.getByTestId("services-definitions-corrupt");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("services.json");
      await page.getByTestId("services-prune-open").click();
      await expect(page.getByTestId("service-action-error")).toContainText("definitions-corrupt");
    } finally {
      exec('rm -f "$HOME/.pi/dashboard/services.json"');
    }
  });
});
