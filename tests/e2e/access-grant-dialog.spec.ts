/**
 * E2E: add-access-grant-dialog, tasks 10.60-10.75 (test-plan #E32, #E42-#E46,
 * #E50, #E54-#E56, #F1-#F9).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suites pin the registry, the coordinator, the planes and every React
 * surface in jsdom. Only a REAL browser against the REAL server shows that the
 * socket-issued capability rides the page's own `fetch`, that a request is held
 * across the dialog, that a verdict converges on every connected browser, and
 * that a dropped socket reconciles.
 *
 * HARNESS STATE
 * -------------
 * Prompting needs `hostGate.mode = "enforce"` and `accessGrants.promptEnabled`.
 * Both are read live from `config.json`, so `beforeAll` flips them IN the
 * container and `afterAll` restores `config.json`, the grant store and the
 * refusal ledger byte-for-byte (specs share one container, workers = 1).
 *
 * Held requests are raised by `fetch` inside the page (the capability wrapper
 * adds `X-Pi-Grant-Channel`); `page.request` never carries it, so it raises a
 * recorded, unheld denial. Each test uses its own subject: D9's 120 s
 * post-settle backoff would otherwise swallow the next prompt.
 *
 * See change: add-access-grant-dialog.
 *
 * The final `outside text docs` describe (tests #S54, #S56, #S58) drives the chat-link → editor-pane
 * round trip for text docs OUTSIDE the session cwd: read denial flow, write prompt on save, and a read
 * grant never admitting a write. See change: fix-file-link-editor-routing.
 */
import { execSync } from "node:child_process";
import type { Browser, Page, WebSocketRoute } from "@playwright/test";
import { expect, narrowTrust, test } from "./fixtures.js";
import { ensureGitSession, FIXTURE_GIT, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

const ROOT = "/fixtures/__grant-e2e__";
/**
 * A git checkout so the ladder is bounded. A file denial names its DIRECTORY,
 * so each probe gets its own dir `repo/x/y/<name>`: rungs y -> x -> repo = 3.
 */
const REPO = `${ROOT}/repo`;
const CONFIG = "/home/pi/.pi/dashboard/config.json";
const STORES = [CONFIG, "/home/pi/.pi/dashboard/access-grants.json", "/home/pi/.pi/dashboard/access-refusals.json"];

function containerName(): string {
  return execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, { encoding: "utf8" })
    .trim()
    .split("\n")[0];
}

/** Run a node script in the container (as its default user) and return stdout. */
function inContainer(script: string): string {
  return execSync(`docker exec -i ${containerName()} node`, { input: script, encoding: "utf8" });
}

/** Merge `patch` into the container's config.json (top-level keys, atomic). */
function patchConfig(patch: Record<string, unknown>): void {
  inContainer(`
    const fs = require("node:fs");
    const p = ${JSON.stringify(CONFIG)};
    const cur = JSON.parse(fs.readFileSync(p, "utf8"));
    const patch = ${JSON.stringify(patch)};
    for (const [k, v] of Object.entries(patch)) {
      cur[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(cur[k] ?? {}), ...v } : v;
    }
    fs.writeFileSync(p + ".e2e.tmp", JSON.stringify(cur, null, 2));
    fs.renameSync(p + ".e2e.tmp", p);
  `);
}

/** Every IPv4 CIDR EXCEPT `ip`: trusts the host browser, never the container's own eth0. */
function complementOf(ip: string): string[] {
  const n = ip.split(".").reduce((a, o) => (a << 8n) | BigInt(Number(o)), 0n);
  const out: string[] = [];
  for (let len = 1; len <= 32; len++) {
    const bit = 1n << BigInt(32 - len);
    const prefix = (n ^ bit) & ~(bit - 1n) & 0xffffffffn;
    const q = [24n, 16n, 8n, 0n].map((s) => (prefix >> s) & 255n).join(".");
    out.push(`${q}/${len}`);
  }
  return out;
}

interface PromptsView {
  pending: { plane: string; subject: string }[];
  verdicts: { subject: string; outcome: string; answeredBy?: string }[];
  yolo: { session: { roots: unknown[] } | null };
}

/** The dashboard's view of pending prompts and verdicts (in-container, loopback). */
function promptsView(): PromptsView {
  return JSON.parse(
    inContainer(`
      fetch("http://127.0.0.1:${DASHBOARD_PORT}/api/access/prompts")
        .then((r) => r.json()).then((j) => process.stdout.write(JSON.stringify(j.data)));
    `),
  );
}

function grantedSubjects(): string[] {
  return JSON.parse(
    inContainer(`
      fetch("http://127.0.0.1:${DASHBOARD_PORT}/api/access/grants")
        .then((r) => r.json())
        .then((j) => process.stdout.write(JSON.stringify(((j.data ?? j).pathGrants ?? []).map((g) => g.subject))));
    `),
  );
}

const existsUrl = (cwd: string, p: string) =>
  `/api/file/exists?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(p)}`;

/** Start a HELD request from inside the page; returns a handle to its status. */
async function heldFetch(page: Page, url: string): Promise<() => Promise<number>> {
  const key = `k${Math.random().toString(36).slice(2)}`;
  await page.evaluate(
    ([u, k]) => {
      (window as unknown as Record<string, Promise<number>>)[k] = fetch(u).then((r) => r.status);
    },
    [url, key],
  );
  return () => page.evaluate((k) => (window as unknown as Record<string, Promise<number>>)[k], key);
}

/** A fresh probe under the bounded checkout; unique dir per test (D9 backoff). */
function probe(name: string): { file: string; subject: string } {
  const subject = `${REPO}/x/y/${name}`;
  const file = `${subject}/probe.txt`;
  inContainer(`
    const fs = require("node:fs");
    fs.mkdirSync(${JSON.stringify(subject)}, { recursive: true });
    fs.writeFileSync(${JSON.stringify(file)}, "probe\\n");
  `);
  return { file, subject };
}

/** Wait for the capability: a held denial needs it, and it arrives on the socket. */
async function openDashboard(page: Page): Promise<void> {
  await ensureGitSession(page);
  await expect.poll(async () => (await page.request.get("/api/health")).status()).toBe(200);
  // One round trip after the socket settled so `grant_channel` has landed.
  await page.waitForTimeout(500);
}

const dialog = (page: Page) => page.getByTestId("grant-dialog");

let saved: Record<string, string | null> = {};

test.describe.serial("access-grant prompt dialog (add-access-grant-dialog 10g)", () => {
  // Under the kill switch (task 9.2's whole-suite run) no dialog can exist by design.
  test.skip(process.env.PI_DASHBOARD_DISABLE_GRANT_PROMPT === "1", "prompting force-disabled by the kill switch");

  test.beforeAll(async ({ request }) => {
    saved = JSON.parse(
      inContainer(`
        const fs = require("node:fs");
        const out = {};
        for (const p of ${JSON.stringify(STORES)}) out[p] = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
        process.stdout.write(JSON.stringify(out));
      `),
    );
    execSync(
      `docker exec ${containerName()} sh -c 'rm -rf ${ROOT} && mkdir -p ${REPO}/x/y ${ROOT}/unknown-cwd && git -C ${REPO} init -q'`,
    );
    // Trust-bearing keys go through narrowTrust (describe scope: restored when the
    // next spec starts); only the non-trust `accessGrants` key is a raw write.
    await narrowTrust(request, { hostGate: { mode: "enforce" } });
    patchConfig({ accessGrants: { promptEnabled: true } });
  });

  test.afterAll(() => {
    inContainer(`
      fetch("http://127.0.0.1:${DASHBOARD_PORT}/api/access/yolo", { method: "DELETE" }).catch(() => {}).finally(() => {
        const fs = require("node:fs");
        const saved = ${JSON.stringify(saved)};
        for (const [p, body] of Object.entries(saved)) {
          if (body === null) { try { fs.unlinkSync(p); } catch {} }
          else { fs.writeFileSync(p + ".e2e.tmp", body); fs.renameSync(p + ".e2e.tmp", p); }
        }
      });
    `);
    execSync(`docker exec ${containerName()} rm -rf ${ROOT}`);
  });

  test("10.61 / 10.62a / 10.63: held filesystem prompt, ladder, nothing pre-selected or emphasised", async ({
    page,
  }) => {
    await openDashboard(page);
    const { file, subject } = probe("ladder");
    const status = await heldFetch(page, existsUrl(FIXTURE_GIT, file));

    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(dialog(page).getByTestId("grant-dialog-subject")).toHaveText(subject);
    await expect(dialog(page).getByTestId("grant-dialog-waiting")).toBeVisible();

    // #E44: the denied subject + exactly 3 rungs (y, x, repo root), narrowest checked, no free text.
    const radios = dialog(page).getByTestId("grant-dialog-ladder").locator('input[type="radio"]');
    await expect(radios).toHaveCount(4);
    await expect(radios.first()).toBeChecked();
    expect(
      await dialog(page).getByTestId("grant-dialog-ladder").locator("label").filter({ hasText: /level/ }).count(),
    ).toBe(3);
    await expect(radios.nth(3)).toHaveValue(REPO);
    await expect(dialog(page).locator('input[type="text"], textarea')).toHaveCount(0);

    // #E42/#E56: no answer is default-focused or styled differently from its peers.
    const once = dialog(page).getByTestId("grant-allow-once");
    const always = dialog(page).getByTestId("grant-allow-always");
    await expect(always).not.toBeFocused();
    await expect(once).not.toBeFocused();
    expect(await always.getAttribute("class")).toBe(await once.getAttribute("class"));
    expect(await always.getAttribute("autofocus")).toBeNull();

    await dialog(page).getByTestId("grant-deny").click();
    await expect(dialog(page)).toHaveCount(0);
    expect(await status()).toBe(403);
  });

  test("10.68 / #F2: Escape converges to denied, nothing persisted", async ({ page }) => {
    await openDashboard(page);
    const { file, subject } = probe("escape");
    const status = await heldFetch(page, existsUrl(FIXTURE_GIT, file));
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    expect(await status()).toBe(403);
    expect(grantedSubjects()).not.toContain(subject);
    expect(promptsView().verdicts.find((v) => v.subject === subject)?.outcome).toBe("deny");
  });

  test("10.69 / #F3: an unanswered held prompt expires, the dialog goes, nothing is written", async ({ page }) => {
    // The registry TTL (= the hold ceiling) is 120 s; no knob shortens it.
    test.setTimeout(200_000);
    await openDashboard(page);
    const { file, subject } = probe("expiry");
    const status = await heldFetch(page, existsUrl(FIXTURE_GIT, file));
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(dialog(page)).toHaveCount(0, { timeout: 150_000 });
    expect(await status()).toBe(403);
    expect(grantedSubjects()).not.toContain(subject);
    expect(promptsView().verdicts.find((v) => v.subject === subject)?.outcome).toBe("expired");
  });

  test("10.64 / #E45: an unknown-cwd prompt renders no ladder", async ({ page }) => {
    await openDashboard(page);
    const status = await heldFetch(page, existsUrl(`${ROOT}/unknown-cwd`, "a.txt"));
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(dialog(page).getByTestId("grant-dialog-subject")).toHaveText(`${ROOT}/unknown-cwd`);
    await expect(dialog(page).getByTestId("grant-dialog-ladder")).toHaveCount(0);
    await dialog(page).getByTestId("grant-deny").click();
    expect(await status()).toBe(403);
  });

  test("10.62 / 10.70 / #E43 #F4: network prompt is deferred, allow-once absent, no countdown", async ({
    page,
    request,
  }) => {
    await openDashboard(page);
    const ip = inContainer(`
      const nets = require("node:os").networkInterfaces();
      const a = Object.values(nets).flat().find((n) => n && n.family === "IPv4" && !n.internal);
      process.stdout.write(a.address);
    `).trim();
    // Test scope: restored by the reap fixture after the test, whatever happens.
    await narrowTrust(request, { trustedNetworks: complementOf(ip) });
    const code = inContainer(`
      fetch("http://${ip}:${DASHBOARD_PORT}/api/sessions").then((r) => process.stdout.write(String(r.status)));
    `);
    expect(code, "the container's own eth0 address must be untrusted").toBe("403");

    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await expect(dialog(page).getByTestId("grant-dialog-subject")).toHaveText(ip);
    await expect(dialog(page).getByTestId("grant-dialog-deferred")).toBeVisible();
    await expect(dialog(page).getByTestId("grant-allow-once")).toHaveCount(0);
    await expect(dialog(page).getByTestId("grant-dialog-waiting")).toHaveCount(0);
    await dialog(page).getByTestId("grant-deny").click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test("10.65 / #E46: a markup-bearing origin never reaches a dialog; a real origin renders as text", async ({
    page,
  }) => {
    await openDashboard(page);
    const send = (origin: string) =>
      inContainer(`
        const http = require("node:http");
        const req = http.request({ host: "127.0.0.1", port: ${DASHBOARD_PORT}, path: "/api/health",
          headers: { origin: ${JSON.stringify(origin)} } }, (res) => { res.resume(); res.on("end", () => process.stdout.write(String(res.statusCode))); });
        req.end();
      `);
    let alerted = false;
    page.on("dialog", async (d) => {
      alerted = true;
      await d.dismiss();
    });

    // The crafted value is not a URL origin: the cors plane refuses it as a subject.
    send("https://<img src=x onerror=alert(1)>.example.com");
    await page.waitForTimeout(1500);
    await expect(dialog(page)).toHaveCount(0);
    expect(promptsView().pending.filter((p) => p.plane === "cors")).toHaveLength(0);

    send("https://evil.example.com");
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    const subject = dialog(page).getByTestId("grant-dialog-subject");
    await expect(subject).toHaveText("https://evil.example.com");
    await expect(subject.locator("*")).toHaveCount(0);
    await expect(dialog(page).getByTestId("grant-allow-once")).toHaveCount(0);
    await dialog(page).getByTestId("grant-deny").click();
    await expect(page.locator("img[src='x']")).toHaveCount(0);
    expect(alerted).toBe(false);
  });

  test("10.67 / #F1: two browsers, A answers, B's dialog unmounts with no residual backdrop", async ({
    page,
    browser,
  }) => {
    await openDashboard(page);
    const b = await secondPage(browser);
    try {
      await openDashboard(b);
      const status = await heldFetch(page, existsUrl(FIXTURE_GIT, probe("two-browsers").file));
      await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
      await expect(dialog(b)).toBeVisible({ timeout: 15_000 });
      await dialog(page).getByTestId("grant-deny").click();
      expect(await status()).toBe(403);
      await expect(dialog(b)).toHaveCount(0);
      await expect(b.getByTestId("grant-dialog-overlay")).toHaveCount(0);
    } finally {
      await b.context().close();
    }
  });

  test("10.75 / #F9: a dropped socket reconciles - pending re-rendered, settled-meanwhile removed", async ({
    page,
    browser,
  }) => {
    const routes: WebSocketRoute[] = [];
    const state = { drop: false };
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      routes.push(ws);
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => {
        if (!state.drop) ws.send(m);
      });
    });
    await openDashboard(page);
    const b = await secondPage(browser);
    try {
      await openDashboard(b);
      // B holds the request, so A's socket can drop without aborting it.
      const status = await heldFetch(b, existsUrl(FIXTURE_GIT, probe("reconnect").file));
      await expect(dialog(page)).toBeVisible({ timeout: 15_000 });

      const cut = async () => {
        const n = routes.length;
        await routes[routes.length - 1].close();
        await expect.poll(() => routes.length, { timeout: 20_000 }).toBeGreaterThan(n);
      };

      // Pending across a reconnect: still (re-)rendered.
      await cut();
      await expect(dialog(page)).toBeVisible({ timeout: 15_000 });

      // Settled while A was not listening: A misses grant_dismiss...
      state.drop = true;
      await dialog(b).getByTestId("grant-deny").click();
      expect(await status()).toBe(403);
      await page.waitForTimeout(1000);
      await expect(dialog(page), "the dropped link hid the dismiss").toBeVisible();
      // ...and converges once it reconnects.
      state.drop = false;
      await cut();
      await expect(dialog(page)).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await b.context().close();
    }
  });

  test("10.66 / #E50 / #E15: no YOLO session, row 1 holds today's controls, untinted, no YOLO link", async ({ page }) => {
    inContainer(`fetch("http://127.0.0.1:${DASHBOARD_PORT}/api/access/yolo", { method: "DELETE" })`);
    await openDashboard(page);
    await expect(page.getByTestId("connection-chip").first()).toBeVisible();
    const row = page.getByTestId("header-app-bar");
    await expect(row).not.toHaveAttribute("data-yolo", /.*/);
    expect(await row.getAttribute("title")).toBeNull();
    await expect(page.getByTestId("yolo-bar-link")).toHaveCount(0);
    await expect(page.getByTestId("yolo-pill")).toHaveCount(0);
    await expect(page.getByTestId("yolo-composer-strip")).toHaveCount(0);
  });

  test("10.74 / #F8: YOLO from inside the dialog is not a verdict", async ({ page }) => {
    await openDashboard(page);
    const { file, subject } = probe("yolo-in-dialog");
    const status = await heldFetch(page, existsUrl(FIXTURE_GIT, file));
    await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
    await dialog(page).getByTestId("grant-dialog-yolo-toggle").click();
    await dialog(page).getByTestId("yolo-activate").click();
    await expect(dialog(page).getByTestId("yolo-activation-result")).toBeVisible({ timeout: 10_000 });
    // The pending denial still needs an explicit answer.
    await expect(dialog(page)).toBeVisible();
    expect(promptsView().pending.some((p) => p.subject === subject)).toBe(true);
    await dialog(page).getByTestId("grant-deny").click();
    expect(await status()).toBe(403);
    inContainer(`fetch("http://127.0.0.1:${DASHBOARD_PORT}/api/access/yolo", { method: "DELETE" })`);
  });

  test("10.60 / 10.73 / 10.72 / 10.71: directory-page activation, one session, undismissable indicators", async ({
    page,
  }) => {
    await openDashboard(page);
    await page.goto(`/folder/${Buffer.from(FIXTURE_GIT).toString("base64url")}/settings`);
    await page.getByTestId("directory-yolo-toggle").click();
    // #E32: exactly the shipped durations.
    await expect(page.getByTestId("yolo-durations").locator('input[type="radio"]')).toHaveCount(3);
    await expect(page.getByTestId("yolo-root-option").first()).toContainText(FIXTURE_GIT);
    await page.getByTestId("yolo-activate").click();
    await expect(page.getByTestId("yolo-activation-result")).toBeVisible({ timeout: 10_000 });

    // #F7: the Access page shows that same session, not a second one.
    await page.goto("/settings/access");
    await expect(page.getByTestId("yolo-access-active")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("yolo-access-root")).toHaveCount(1);
    await expect(page.getByTestId("yolo-access-root")).toContainText(FIXTURE_GIT);
    expect(promptsView().yolo.session?.roots).toHaveLength(1);

    // #F6: the tinted bar has no dismiss affordance and survives Escape; it adds no visible control.
    await page.goto("/");
    const row = page.getByTestId("header-app-bar");
    await expect(row).toHaveAttribute("data-yolo", "scoped", { timeout: 15_000 });
    await expect(row.locator("button", { hasText: /dismiss|close|hide/i })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(row).toHaveAttribute("data-yolo", "scoped");
    await expect(page.getByTestId("yolo-pill")).toHaveCount(0);

    // #F5: sidebar not rendered (mobile session view), the composer dock's YOLO footer
    // (`yolo-composer-strip`, one line above the card) still says so. See change: add-composer-dock.
    await page.getByTestId("session-card-desktop").first().click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("yolo-composer-strip").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("yolo-composer-strip").first()).toContainText(/\d+:\d\d/);
    await expect(page.getByTestId("composer-dock").locator('[data-testid="yolo-composer-strip"]')).toHaveCount(1);
    await expect(page.getByTestId("yolo-session-indicator")).toHaveCount(0);

    // End it from the Access page.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/settings/access");
    await page.getByTestId("yolo-end").click();
    await expect(page.getByTestId("yolo-access-active")).toHaveCount(0, { timeout: 15_000 });
  });

  test("10.62b / #E54: report mode states why, lists the denial, answerable, toggle inert", async ({
    page,
    request,
  }) => {
    await narrowTrust(request, { hostGate: { mode: "report" } });
    await openDashboard(page);
    const { file, subject } = probe("report-mode");
    const denied = await page.request.get(existsUrl(FIXTURE_GIT, file));
    expect(denied.status()).toBe(403);
    await page.goto("/settings/access");
    await expect(page.getByTestId("access-prompts-banner-report-mode")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("access-prompts-toggle")).toBeVisible();
    await expect(page.getByTestId("access-prompts-toggle")).toBeDisabled();
    const row = page.getByTestId("access-pending-row").filter({ hasText: subject });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByTestId("access-pending-deny").click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
    expect(promptsView().verdicts.find((v) => v.subject === subject)?.outcome).toBe("deny");
  });

  // harden-plugin-cwd-admission, test-plan #F11: a user-initiated plugin write for an
  // unpinned existing non-repo directory raises the cwd dialog, and "Always allow"
  // completes the SAME request. The page's own `fetch` carries the capability, so the
  // PUT is held exactly as the MCP editor's save is. (The folder page for an unknown
  // cwd renders "not tracked" with no editor, so the editor's request is driven directly.)
  test("F11: saving an MCP server for an unpinned folder asks; Always allow pins it and the save succeeds", async ({
    page,
  }) => {
    const dir = "/tmp/e2e-mcp-x";
    inContainer(`
      const fs = require("node:fs");
      fs.rmSync(${JSON.stringify(dir)}, { recursive: true, force: true });
      fs.mkdirSync(${JSON.stringify(dir)}, { recursive: true });
    `);
    const pinned = (): string[] =>
      JSON.parse(
        inContainer(`
          fetch("http://127.0.0.1:${DASHBOARD_PORT}/api/pinned-dirs")
            .then((r) => r.json()).then((j) => process.stdout.write(JSON.stringify(j.data)));
        `),
      );
    expect(pinned()).not.toContain(dir);
    try {
      await openDashboard(page);
      await page.goto(`/folder/${encodeURIComponent(dir)}/mcp`);
      await expect(page.getByTestId("mcp-folder-not-allowed")).toBeVisible({ timeout: 15_000 });

      const key = `k${Math.random().toString(36).slice(2)}`;
      await page.evaluate(
        ([k, d]) => {
          (window as unknown as Record<string, Promise<number>>)[k] = fetch("/api/mcp-client/servers/e2e", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ scope: "project", cwd: d, entry: { command: "echo", args: ["e2e"] }, create: true }),
          }).then((r) => r.status);
        },
        [key, dir],
      );
      await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
      await expect(dialog(page).getByTestId("grant-dialog-subject")).toHaveText(dir);
      await dialog(page).getByTestId("grant-allow-always").click();
      await expect(dialog(page)).toHaveCount(0);
      expect(await page.evaluate((k) => (window as unknown as Record<string, Promise<number>>)[k], key)).toBe(200);
      expect(pinned()).toContain(dir);
    } finally {
      // Leave the shared container as found: unpin (the same WS verb the sidebar's
      // unpin uses) and remove the directory, so the test is re-runnable.
      inContainer(`
        const ws = new WebSocket("ws://127.0.0.1:${DASHBOARD_PORT}/ws");
        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "unpin_directory", path: ${JSON.stringify(dir)} }));
          setTimeout(() => process.exit(0), 500);
        };
        setTimeout(() => process.exit(0), 5000);
      `);
      inContainer(`require("node:fs").rmSync(${JSON.stringify(dir)}, { recursive: true, force: true });`);
    }
  });

  test("10.62c / #E55: a browser issued no capability is told it will not receive dialogs", async ({ page }) => {
    await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => {
        if (typeof m === "string" && m.includes('"type":"grant_channel"')) return;
        ws.send(m);
      });
    });
    await ensureGitSession(page);
    await page.goto("/settings/access");
    await expect(page.getByTestId("access-prompts-banner-no-channel")).toBeVisible({ timeout: 15_000 });
  });
});

// ── outside text docs: link → editor pane → read denial / write prompt (fix-file-link-editor-routing) ──
const outsideDir = (name: string) => `${ROOT}/${name}`;
const outsideLink = (page: Page, name: string) =>
  page.getByText(`${outsideDir(name)}/${name === "lk-missing" ? "missing" : "doc"}.md`, { exact: true }).first();

/** Create `<ROOT>/<name>/doc.md` inside the container with a marker line. */
function seedOutsideDoc(name: string, marker: string): string {
  const file = `${outsideDir(name)}/doc.md`;
  inContainer(`
    const fs = require("node:fs");
    fs.mkdirSync(${JSON.stringify(outsideDir(name))}, { recursive: true });
    fs.writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(`# outside\n${marker}\n`)});
  `);
  return file;
}

function readInContainer(file: string): string {
  return inContainer(`process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(file)}, "utf8"));`);
}

/** A fresh git session whose chat carries the five outside links. */
async function openOutsideLinks(page: Page): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, "[[faux:text-outside-links]] go");
  await expect(outsideLink(page, "lk-deny")).toBeVisible({ timeout: 30_000 });
}

/**
 * Get to the grant dialog for the open tab's refused read. The dialog is either already up (the load
 * carried the capability) or the tab shows `DenialNotice` with an "Ask for access" control that re-runs
 * the load eligibly - never both a stale notice and no way forward.
 */
async function reachReadDialog(page: Page): Promise<void> {
  const notice = page.getByTestId("denial-notice");
  await expect(notice.or(dialog(page)).first()).toBeVisible({ timeout: 20_000 });
  if (!(await dialog(page).isVisible())) await notice.getByRole("button", { name: /ask/i }).click();
  await expect(dialog(page)).toBeVisible({ timeout: 15_000 });
}

async function typeIntoEditor(page: Page, text: string): Promise<void> {
  await page.getByTestId("md-edit-toggle").click();
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.type(text);
}

test.describe.serial("outside text docs (fix-file-link-editor-routing L3)", () => {
  test.skip(process.env.PI_DASHBOARD_DISABLE_GRANT_PROMPT === "1", "prompting force-disabled by the kill switch");

  test.beforeAll(async ({ request }) => {
    saved = JSON.parse(
      inContainer(`
        const fs = require("node:fs");
        const out = {};
        for (const p of ${JSON.stringify(STORES)}) out[p] = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
        process.stdout.write(JSON.stringify(out));
      `),
    );
    execSync(`docker exec ${containerName()} sh -c 'rm -rf ${ROOT} && mkdir -p ${ROOT}'`);
    await narrowTrust(request, { hostGate: { mode: "enforce" } });
    patchConfig({ accessGrants: { promptEnabled: true } });
  });

  test.afterAll(() => {
    inContainer(`
      const fs = require("node:fs");
      const saved = ${JSON.stringify(saved)};
      for (const [p, body] of Object.entries(saved)) {
        if (body === null) { try { fs.unlinkSync(p); } catch {} }
        else { fs.writeFileSync(p + ".e2e.tmp", body); fs.renameSync(p + ".e2e.tmp", p); }
      }
    `);
    execSync(`docker exec ${containerName()} rm -rf ${ROOT}`);
  });

  // #S54 — an ungranted outside link opens a tab that shows the denial flow, never the bytes, never "not found".
  test("S54: ungranted outside link -> denial flow, no bytes before the grant; Deny keeps it; Allow once renders", async ({
    page,
  }) => {
    seedOutsideDoc("lk-deny", "OUTSIDE-DENY-MARKER");
    await openDashboard(page);
    await openOutsideLinks(page);

    const link = outsideLink(page, "lk-deny");
    await link.click();
    await expect(page.getByTestId("split-editor-pane").first()).toBeVisible({ timeout: 20_000 });
    await reachReadDialog(page);
    await expect(page.getByText("OUTSIDE-DENY-MARKER")).toHaveCount(0);
    await expect(link).not.toHaveAttribute("data-not-found", "true");

    await dialog(page).getByTestId("grant-deny").click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByTestId("denial-notice")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("OUTSIDE-DENY-MARKER")).toHaveCount(0);

    // Re-click (same tab) and allow once: the content renders.
    await link.click();
    await reachReadDialog(page);
    await dialog(page).getByTestId("grant-allow-once").click();
    await expect(page.getByText("OUTSIDE-DENY-MARKER")).toBeVisible({ timeout: 30_000 });
    await expect(link).not.toHaveAttribute("data-not-found", "true");
  });

  // #S56 — edit + save an outside file: a WRITE prompt, allow-once saves, a later save prompts again and Deny keeps the buffer.
  test("S56: edit+save an outside .md raises a write prompt; allow once saves; deny keeps the dirty buffer", async ({
    page,
  }) => {
    const file = seedOutsideDoc("lk-write", "OUTSIDE-WRITE-MARKER");
    await openDashboard(page);
    await openOutsideLinks(page);
    await outsideLink(page, "lk-write").click();
    await reachReadDialog(page);
    await dialog(page).getByTestId("grant-allow-always").click(); // read grant for the folder
    await expect(page.getByText("OUTSIDE-WRITE-MARKER")).toBeVisible({ timeout: 30_000 });

    // The Edit toggle is offered on the outside tab (no editable-gating on the cwd).
    await expect(page.getByTestId("md-edit-toggle")).toBeVisible();
    await typeIntoEditor(page, "FIRST-EDIT");
    await page.getByTestId("md-save-btn").click();
    await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
    await expect(dialog(page)).toContainText("A write was blocked");
    expect(readInContainer(file)).not.toContain("FIRST-EDIT");
    await dialog(page).getByTestId("grant-allow-once").click();
    await expect(page.getByTestId("md-dirty-dot")).toHaveCount(0, { timeout: 20_000 });
    expect(readInContainer(file)).toContain("FIRST-EDIT");

    // Allow once persisted nothing: the next save asks again; Deny leaves disk alone and the buffer dirty.
    await page.locator(".monaco-editor").first().click();
    await page.keyboard.type("SECOND-EDIT");
    await page.getByTestId("md-save-btn").click();
    await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
    await dialog(page).getByTestId("grant-deny").click();
    await expect(page.getByTestId("md-save-error")).toContainText(/write not granted/i, { timeout: 15_000 });
    await expect(page.getByTestId("md-dirty-dot")).toBeVisible();
    await expect(page.locator(".monaco-editor").first()).toContainText("SECOND-EDIT");
    expect(readInContainer(file)).not.toContain("SECOND-EDIT");
  });

  // #S58 — a read grant never admits a write.
  test("S58: an existing read grant does not admit a save - the write prompt still appears", async ({ page }) => {
    const file = seedOutsideDoc("lk-readonly", "OUTSIDE-READONLY-MARKER");
    await openDashboard(page);
    await openOutsideLinks(page);
    await outsideLink(page, "lk-readonly").click();
    await reachReadDialog(page);
    await dialog(page).getByTestId("grant-allow-always").click();
    await expect(page.getByText("OUTSIDE-READONLY-MARKER")).toBeVisible({ timeout: 30_000 });

    await typeIntoEditor(page, "SNEAKY-EDIT");
    await page.getByTestId("md-save-btn").click();
    await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
    await expect(dialog(page)).toContainText("A write was blocked");
    expect(readInContainer(file), "file unchanged until the write is allowed").not.toContain("SNEAKY-EDIT");
    await dialog(page).getByTestId("grant-deny").click();
  });
});

async function secondPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: `http://localhost:${DASHBOARD_PORT}` });
  return ctx.newPage();
}
