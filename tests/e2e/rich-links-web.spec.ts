import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// Rendered web-link behaviour (change: rich-chat-links; test-plan F6, F10, F11, X12; tasks 9.1, 9.5, 9.6, 9.9).
//
// `[[faux:rich-links-web]]` streams three bare URLs; `[[faux:rich-links-pr]]` a bare GitHub PR URL. No spec
// here contacts the internet: remote origins are served by `context.route` fulfilments, and the framing
// verdict for `https://framed-allowed.test` comes from the harness's env-gated, test-only frame-policy
// verdict seam (`PI_E2E_FRAME_POLICY_VERDICTS`, docker/compose.test.yml; refused in production builds).

const URL_TAB = '[data-testid="editor-tab"]';

/** Answer every remote fixture origin locally so a browser-opened page never reaches the internet. */
async function stubRemote(context: BrowserContext, hosts: string[], hits: string[] = []): Promise<void> {
  for (const host of hosts) {
    await context.route(`https://${host}/**`, (route) => {
      hits.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>stub</title>stub" });
    });
  }
}

async function openSession(page: Page, scenario: string): Promise<void> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, `[[faux:${scenario}]] go`);
}

test.describe("rich-chat-links — web links (rendered)", () => {
  test("F6: a plain click opens a url: tab in the pane; a ctrl-click opens a browser page instead", async ({
    page,
    context,
  }) => {
    const remoteHits: string[] = [];
    await stubRemote(context, ["example.com"], remoteHits);
    // The pane probes the framing policy for an operator click; answer locally (no outbound request).
    await page.route("**/api/web/frame-policy", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verdict: "refused" }) }),
    );
    await openSession(page, "rich-links-web");

    const link = page.locator('a[href="https://example.com/docs"]').first();
    await expect(link).toBeVisible({ timeout: 30_000 });

    const popups: string[] = [];
    context.on("page", (p) => popups.push(p.url()));
    await link.click();

    await expect(page.locator(`${URL_TAB}[data-tab-path="url:https://example.com/docs"]`)).toHaveCount(1, {
      timeout: 15_000,
    });
    expect(popups).toEqual([]);
    const tabCount = await page.locator(URL_TAB).count();

    const opened = context.waitForEvent("page", { timeout: 15_000 });
    await link.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
    const newPage = await opened;
    expect(newPage).not.toBe(page);
    // The new page is the browser's own tab for the link (it is the only remote request for the URL).
    await expect.poll(() => remoteHits.filter((u) => u.endsWith("/docs")).length, { timeout: 15_000 }).toBe(1);
    await expect(page.locator(URL_TAB)).toHaveCount(tabCount);
    await expect(page.locator(`${URL_TAB}[data-tab-path="url:https://example.com/docs"]`)).toHaveCount(1);
  });

  test("F10: an allowed framed page is isolated — no popup, no top navigation, opaque origin, parent unreadable", async ({
    page,
    context,
  }) => {
    const popups: string[] = [];
    context.on("page", (p) => popups.push(p.url()));
    await page.addInitScript(() => {
      const w = window as unknown as { __framed: unknown[] };
      w.__framed = [];
      window.addEventListener("message", (e) => {
        if (e.data && typeof e.data === "object" && (e.data as { fixture?: string }).fixture === "framed") {
          w.__framed.push(e.data);
        }
      });
    });

    await openSession(page, "rich-links-web");
    const dash = new URL(page.url()).origin;
    const selfUrl = `${dash}/__e2e/framed-self.html`;

    // Local HTTPS fixture origin (virtual: fulfilled in the browser, never resolved). It calls window.open,
    // tries top.location, then navigates ITSELF to the dashboard origin.
    await context.route("https://framed-allowed.test/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><title>framed</title><script>
          const r = { fixture: "framed", step: "first" };
          try { r.popup = window.open("about:blank", "_blank") ? "opened" : "blocked"; } catch (e) { r.popup = "threw"; }
          try { top.location = "https://evil.test/"; r.top = "no-throw"; } catch (e) { r.top = "threw:" + e.name; }
          parent.postMessage(r, "*");
          setTimeout(() => { location.href = ${JSON.stringify(selfUrl)}; }, 200);
        </script>`,
      }),
    );
    // The dashboard-origin document the fixture navigates to: a sandboxed frame must still read origin "null".
    await page.route(selfUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><title>self</title><script>
          const r = { fixture: "framed", step: "self", origin: String(window.origin) };
          try { void parent.document.title; r.parentDoc = "readable"; } catch (e) { r.parentDoc = "threw:" + e.name; }
          parent.postMessage(r, "*");
        </script>`,
      }),
    );

    const before = page.url();
    await page.locator('a[href="https://framed-allowed.test/page"]').first().click();

    await expect(page.getByTestId("webpage-frame")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __framed: unknown[] }).__framed.length), {
        timeout: 20_000,
      })
      .toBe(2);
    const msgs = await page.evaluate(() => (window as unknown as { __framed: Array<Record<string, string>> }).__framed);
    const first = msgs.find((m) => m.step === "first");
    const self = msgs.find((m) => m.step === "self");

    expect(first?.popup).toBe("blocked");
    expect(self?.origin).toBe("null");
    expect(self?.parentDoc).toMatch(/^threw:/);
    expect(popups).toEqual([]);
    expect(page.url()).toBe(before);
  });

  test("F11: copying a selected shortened PR label puts the full URL on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openSession(page, "rich-links-pr");

    const link = page.locator('a[href="https://github.com/o/r/pull/123"]').first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    // The label is shortened (the full URL lives in data-copy-text / title).
    await expect(link).toContainText("o/r#123");

    await link.evaluate((el) => {
      const block = el.closest("p, div") ?? el;
      const range = document.createRange();
      range.selectNodeContents(block);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+C" : "Control+C");

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 })
      .toContain("https://github.com/o/r/pull/123");
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).not.toContain("o/r#123");
  });

  test("X12: an older server without the probe leaves a card with Open in browser and no embed", async ({
    page,
  }) => {
    await page.route("**/api/web/frame-policy", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Not Found" }) }),
    );
    await openSession(page, "rich-links-web");

    await page.locator('a[href="https://example.com/"]').first().click();

    await expect(page.getByTestId("webpage-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("webpage-open-in-browser")).toBeVisible();
    await expect(page.getByTestId("webpage-try-embed")).toHaveCount(0);
    await expect(page.getByTestId("webpage-check-embed")).toHaveCount(0);
    await expect(page.getByTestId("webpage-frame")).toHaveCount(0);
    await expect(page.locator("iframe")).toHaveCount(0);
  });
});
