import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "./fixtures.js";
import { REPO_ROOT } from "./lifecycle.js";

// Electron bundled renderer pages under an ENFORCED `require-trusted-types-for
// 'script'` meta CSP (change: harden-client-sinks, task 9.2, test-plan #F6).
// The pages load as `file://` in Chromium with `addInitScript`-stubbed preload
// bridges (no Electron, no docker harness needed by the page itself). Hostile
// data — a server URL / label carrying `"><img src=x onerror=f()>` — must render
// as text, every page must raise 0 TT violations, and the loading page must
// report its loopback server reachable (handoff through `navigateToServer`).
// Exemplar for harness glue: tests/e2e/csp.spec.ts.

const EVIL = '"><img src=x onerror=f()>';
const ELECTRON = path.join(REPO_ROOT, "packages", "electron");
const fileUrl = (rel: string) => pathToFileURL(path.join(ELECTRON, rel)).href;

async function trackViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __ttv: string[] };
    w.__ttv = [];
    window.addEventListener("securitypolicyviolation", (e) => w.__ttv.push(`${e.effectiveDirective} ${e.sample}`));
  });
}
const violations = (page: Page) => page.evaluate(() => (window as unknown as { __ttv: string[] }).__ttv);

/** The meta CSP really enforces TT: a raw innerHTML assignment throws (run LAST — it records a violation). */
async function expectEnforced(page: Page): Promise<void> {
  const threw = await page.evaluate(() => {
    try {
      document.createElement("div").innerHTML = "<b>x</b>";
      return false;
    } catch {
      return true;
    }
  });
  expect(threw, "require-trusted-types-for 'script' must be enforced").toBe(true);
}

async function expectNoInjectedImg(page: Page): Promise<void> {
  await expect(page.locator("img")).toHaveCount(0);
}

test.describe("Electron bundled pages enforce Trusted Types (F6)", () => {
  test("doctor.html renders a hostile report as text, 0 violations", async ({ page }) => {
    await trackViolations(page);
    await page.addInitScript((evil) => {
      (window as unknown as Record<string, unknown>).electron = {
        doctor: {
          run: async () => ({
            generatedAt: Date.now(),
            summary: { ok: 1, warnings: 0, errors: 1 },
            checks: [
              { section: "runtime", name: "Node", status: "ok", message: "fine" },
              { section: "server", name: `Server ${evil}`, status: "error", message: evil, detail: evil, suggestion: `see [docs](javascript:alert(1)) ${evil}` },
            ],
          }),
        },
      };
    }, EVIL);
    await page.goto(fileUrl("src/renderer/doctor.html"));
    await expect(page.locator("#content")).toContainText("onerror=f()", { timeout: 10_000 });
    await expectNoInjectedImg(page);
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
    expect(await violations(page)).toEqual([]);
    await expectEnforced(page);
  });

  test("loading.html shows hostile known-server labels as text and hands off to the loopback server", async ({ page }) => {
    await trackViolations(page);
    await page.route("http://127.0.0.1:59871/api/health", (route) =>
      route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: '{"ok":true}' }),
    );
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__nav = null;
      w.piDashboard = {
        navigateToServer: async (t: string) => {
          w.__nav = t;
          return { navigated: true };
        },
        onStatus: () => {},
        readServerLog: async () => "",
      };
    });
    const ks = Buffer.from(JSON.stringify([{ host: "10.0.0.9", port: 8000, label: EVIL }])).toString("base64");
    const serverUrl = "http://127.0.0.1:59871";
    await page.goto(`${fileUrl("resources/loading.html")}?serverUrl=${encodeURIComponent(serverUrl)}&knownServers=${encodeURIComponent(ks)}`);
    await expect(page.locator("#known-servers")).toContainText("onerror=f()");
    await expectNoInjectedImg(page);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __nav: string | null }).__nav), { timeout: 10_000 }).toBe(serverUrl);
    expect(await violations(page)).toEqual([]);
    await expectEnforced(page);
  });

  test("remote-connect.html renders hostile recent URLs as text, 0 violations", async ({ page }) => {
    await trackViolations(page);
    await page.addInitScript((evil) => {
      const ok = async () => ({ ok: true });
      (window as unknown as Record<string, unknown>).remoteConnect = {
        getState: async () => ({ mode: "remote", remoteUrl: "http://10.0.0.9:8000", recent: [{ url: evil, lastUsed: new Date().toISOString() }] }),
        listServers: async () => ({
          paired: [{ fingerprint: "fp", label: evil, host: "10.0.0.9", shortFp: "ab:cd", state: "paired" }],
          discovered: [],
          recent: [],
        }),
        onServersChanged: () => {},
        probe: ok, connect: ok, useLocal: ok, forget: ok, close: ok,
        openServer: ok, connectServer: ok, openInWindow: ok, forgetServer: ok, pairAgain: ok,
      };
    }, EVIL);
    await page.goto(fileUrl("src/renderer/remote-connect.html"));
    await expect(page.locator("#server-list")).toContainText("onerror=f()", { timeout: 10_000 });
    await expect(page.locator("#paired-list")).toContainText("onerror=f()");
    await expectNoInjectedImg(page);
    // setStatus() builds its spinner with DOM APIs under enforcement.
    await page.getByRole("button", { name: /test/i }).first().click().catch(() => {});
    expect(await violations(page)).toEqual([]);
    await expectEnforced(page);
  });

  test("connecting.html renders a hostile label as text, 0 violations", async ({ page }) => {
    await trackViolations(page);
    await page.addInitScript((evil) => {
      const state = { phase: "unreachable", label: evil, host: "10.0.0.9:8000", message: evil };
      (window as unknown as Record<string, unknown>).connecting = {
        onState: () => {},
        ready: async () => state,
        sendRequest: () => {}, stopWaiting: () => {}, pairAgain: () => {}, close: () => {},
      };
    }, EVIL);
    await page.goto(fileUrl("src/renderer/connecting.html"));
    await expect(page.locator("#title")).toContainText("onerror=f()", { timeout: 10_000 });
    await expectNoInjectedImg(page);
    expect(await violations(page)).toEqual([]);
    await expectEnforced(page);
  });
});
