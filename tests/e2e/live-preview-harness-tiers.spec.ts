import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { harnessContainer } from "./helpers/folder-collapse.js";
import { byTestId, dismissToasts, FIXTURE_GIT, launchFromNewTabMenu, robustClick, spawnFreshGitSession } from "./helpers/index.js";

// ─────────────────────────────────────────────────────────────────────────
// serve-live-previews-on-capability-origin — the DOCKER harness (task 14.3). The browser reaches the dashboard as
// `http://localhost:<dashboardPort>` but the server sees the Docker bridge gateway as its peer: NOT a genuinely
// local peer, so tier 1 (`<label>.localhost`) must never be minted for it.
//   F2 (test-plan #F2): a port target mints tier 5 (`/preview/<pid>/`), a static target mints `legacy`; never tier 1;
//                       the frame renders under the dashboard origin.
//   F7 (test-plan #F7): a stale cached client (no `accept` in the capability POST) gets the legacy path and
//                       renders exactly as before, with no `origin`.
// F2 exemplar: tests/e2e/live-server-downloads.spec.ts; the static open mirrors tests/e2e/canvas-static-mockup.spec.ts.
// Lives OUTSIDE tests/e2e/live-preview/ (that dir is the host-run isolated-server suite).
// ─────────────────────────────────────────────────────────────────────────

/** Loopback port INSIDE the harness container the dashboard previews (the SSRF gate only admits loopback targets). */
const UPSTREAM_PORT = 5199;
const MOCKUP = "mockups/lp-harness-tiers";

/** Start a tiny HTTP upstream inside the container: every GET answers a page with `<h1 id="up">`; `/__quit` ends it. */
function startUpstream(): void {
  const script = `
    const http = require("node:http");
    const srv = http.createServer((req, res) => {
      if (req.url === "/__quit") { res.end("bye"); setTimeout(() => process.exit(0), 50); return; }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end('<!doctype html><h1 id="up">lp-harness upstream</h1>');
    });
    srv.listen(${UPSTREAM_PORT}, "127.0.0.1");
    setTimeout(() => process.exit(0), 15 * 60 * 1000);
  `;
  execFileSync("docker", ["exec", "-d", harnessContainer(), "node", "-e", script]);
}

function stopUpstream(): void {
  try {
    execFileSync("docker", ["exec", harnessContainer(), "node", "-e", `require("node:http").get("http://127.0.0.1:${UPSTREAM_PORT}/__quit", (r) => r.resume()).on("error", () => {})`]);
  } catch {
    /* already gone */
  }
}

/** Seed a static mockup inside the fixture checkout (an operator `/view @file` opens it as a STATIC live target). */
function seedMockup(): void {
  const script = `
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.join(${JSON.stringify(FIXTURE_GIT)}, ${JSON.stringify(MOCKUP)});
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "index.html"), '<!doctype html><html><body><h1 id="static-up">lp-harness static</h1></body></html>\\n');
  `;
  execFileSync("docker", ["exec", "-i", harnessContainer(), "node"], { input: script });
}

interface Mint {
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: mint bodies are untyped JSON
  body: any;
  postData: Record<string, unknown>;
}

/** Record every capability mint (`POST /api/live-server/:id/capability`) the page makes, with the request body it sent. */
function collectMints(page: import("@playwright/test").Page): Mint[] {
  const mints: Mint[] = [];
  page.on("response", async (res) => {
    const req = res.request();
    if (req.method() !== "POST" || !/\/api\/live-server\/[^/]+\/capability$/.test(new URL(res.url()).pathname)) return;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON */
    }
    let postData: Record<string, unknown> = {};
    try {
      postData = JSON.parse(req.postData() ?? "{}");
    } catch {
      /* none */
    }
    mints.push({ status: res.status(), body, postData });
  });
  return mints;
}

/** Open the viewer on a PORT target through the real UI (session → split → `+` → Live preview → URL → confirm). */
async function openPortPane(page: import("@playwright/test").Page): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await page.getByTestId("layout-mode-switch").waitFor({ state: "visible", timeout: 30_000 });
  await robustClick(page, "layout-mode-split");
  await launchFromNewTabMenu(page, "live-preview-launch");
  await page.getByTestId("live-url").fill(`http://127.0.0.1:${UPSTREAM_PORT}`);
  await robustClick(page, "live-confirm");
  await expect(page.getByTestId("live-iframe")).toBeAttached({ timeout: 20_000 });
}

/** Drop the targets this spec registered (they persist in the harness's preferences). */
async function removePortTargets(page: import("@playwright/test").Page): Promise<void> {
  const list = (await (await page.request.get("/api/live-server/list")).json()) as { data?: { servers?: { id: string; port: number }[] } };
  for (const t of list.data?.servers ?? []) if (t.port === UPSTREAM_PORT) await page.request.delete(`/api/live-server/${t.id}`);
}

test.describe("serve-live-previews-on-capability-origin — docker harness tiers", () => {
  test("T.F2 / #F2 a local user reaching the harness through the Docker bridge gets tier 5 (port) / legacy (static), never tier 1", async ({ page }) => {
    const mints = collectMints(page);
    startUpstream();
    seedMockup();
    try {
      // ── port target → tier 5 ──────────────────────────────────────────────
      await openPortPane(page);
      await expect.poll(() => mints.find((m) => m.body?.tier === 5), { message: "the port mint is tier 5", timeout: 20_000 }).toBeTruthy();
      const port = mints.find((m) => m.body?.tier === 5);
      expect(port?.status).toBe(200);
      expect(port?.body.path, "tier 5 is the /preview/<pid>/ path").toMatch(/^\/preview\/[A-Za-z0-9_-]{22}\/$/);
      expect(port?.body.origin, "tier 5 carries no capability origin").toBeUndefined();
      expect(port?.postData.accept, "the viewer negotiates tiers").toEqual(expect.arrayContaining(["origin", "preview"]));

      const iframe = page.getByTestId("live-iframe");
      const src = (await iframe.getAttribute("src")) ?? "";
      expect(src, "the frame is the dashboard-origin /preview/<pid>/ path").toBe(port?.body.path);
      expect(new URL(src, page.url()).origin, "…rendered under the dashboard origin").toBe(new URL(page.url()).origin);
      expect(await iframe.getAttribute("sandbox"), "tier 5 stays opaque").not.toContain("allow-same-origin");
      await expect(page.frameLocator('[data-testid="live-iframe"]').locator("#up")).toBeVisible({ timeout: 20_000 });

      // ── static target → legacy ────────────────────────────────────────────
      const composer = page.getByPlaceholder(/message/i).first();
      await composer.waitFor({ state: "visible", timeout: 30_000 });
      const before = mints.length;
      await composer.fill(`/view @${MOCKUP}/index.html`);
      await page.keyboard.press("Escape");
      await composer.fill(`/view @${MOCKUP}/index.html`);
      await expect(async () => {
        await dismissToasts(page);
        await byTestId(page, "sendButton").click({ timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await expect.poll(() => mints.slice(before).find((m) => m.body?.tier === "legacy"), { message: "the static mint is legacy", timeout: 30_000 }).toBeTruthy();
      const stat = mints.slice(before).find((m) => m.body?.tier === "legacy");
      expect(stat?.body.path, "legacy capability path").toMatch(/^\/live\/[^/]+\/~c\/[^/]+\/$/);
      expect(stat?.body.origin).toBeUndefined();
      await expect(page.frameLocator('[data-testid="live-iframe"]').locator("#static-up")).toBeVisible({ timeout: 30_000 });
      expect(await page.getByTestId("live-iframe").getAttribute("sandbox")).not.toContain("allow-same-origin");

      // A non-genuinely-local peer never gets a capability origin, for either target kind.
      expect(mints.filter((m) => m.body?.tier === 1 || m.body?.origin !== undefined), "never tier 1 (nor any origin tier)").toHaveLength(0);
    } finally {
      stopUpstream();
      await removePortTargets(page);
    }
  });

  test("T.F7 / #F7 a stale client (no `accept` in the capability POST) gets the legacy path and renders as before", async ({ page }) => {
    const mints = collectMints(page);
    // Strip `accept` from the body the viewer sends: exactly what a cached pre-upgrade client does.
    await page.route("**/api/live-server/*/capability", async (route) => {
      const sent = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      delete sent.accept;
      await route.continue({ postData: JSON.stringify(sent) });
    });
    startUpstream();
    try {
      await openPortPane(page);
      await expect.poll(() => mints.length, { timeout: 20_000 }).toBeGreaterThan(0);
      const mint = mints[0];
      expect(mint.postData.accept, "the route really removed `accept` from the body the server received").toBeUndefined();
      expect(mint.body.tier, "no accept ⇒ legacy").toBe("legacy");
      expect(mint.body.path).toMatch(/^\/live\/[^/]+\/~c\/[^/]+\/$/);
      expect(mint.body.origin, "no origin for a legacy mint").toBeUndefined();

      const iframe = page.getByTestId("live-iframe");
      expect(await iframe.getAttribute("src")).toBe(mint.body.path);
      const sandbox = (await iframe.getAttribute("sandbox")) ?? "";
      expect(sandbox, "the legacy sandbox").not.toContain("allow-same-origin");
      await expect(page.frameLocator('[data-testid="live-iframe"]').locator("#up")).toBeVisible({ timeout: 20_000 });
      // …and no tier-5 base hint (that is a tier-5 surface).
      await expect(page.getByTestId("live-hint-base-path")).toHaveCount(0);
    } finally {
      stopUpstream();
      await page.unroute("**/api/live-server/*/capability");
      await removePortTargets(page);
    }
  });
});
