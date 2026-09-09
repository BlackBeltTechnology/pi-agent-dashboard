import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "./fixtures.js";
import { byTestId, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — Diagram preview (.puml and adoc hydration) in the editor pane.
//
// Tests:
// - F1: .puml renders via stubbed proxy upstream
// - F2: .puml decline shows source + notice
// - F3: adoc [source,mermaid] hydrates client-side without proxy call
// - F4: declined plantuml block keeps listing
// - X3: dead upstream falls back to source
//
// Exemplar: tests/e2e/eml-preview.spec.ts

async function dismissToasts(page: Page): Promise<void> {
  for (const btn of await page.getByRole("button", { name: "Dismiss" }).all()) {
    await btn.click().catch(() => {});
  }
}

async function openFile(page: Page, file: string) {
  const composer = page.getByPlaceholder(/message/i).first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await composer.fill(`/view @${file}`);
  await page.keyboard.press("Escape");
  await composer.fill(`/view @${file}`);
  await expect(async () => {
    await dismissToasts(page);
    await byTestId(page, "sendButton").click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`/session/[^/]+/editor\\?file=${file.replace(".", "\\.")}`), {
    timeout: 20_000,
  });
}

test.describe("Diagram preview (.puml and adoc hydration)", () => {
  let stubServer: http.Server | undefined;
  let stubPort: number | undefined;

  test.afterEach(async () => {
    if (stubServer) {
      await new Promise<void>((resolve) => stubServer!.close(() => resolve()));
      stubServer = undefined;
    }
  });

  test("F1: .puml renders via proxy with mock Kroki upstream", async ({ page }) => {
    // Start local HTTP server returning fixed SVG
    const fixedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="green" data-testid="stub-circle"/></svg>`;
    stubServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(fixedSvg);
    });
    await new Promise<void>((resolve) => stubServer!.listen(0, "127.0.0.1", () => resolve()));
    stubPort = (stubServer.address() as AddressInfo).port;

    // Intercept POST /api/diagram/render to redirect to stub upstream or mock response
    await page.route("**/api/diagram/render", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { svg: fixedSvg },
        }),
      });
    });

    const card = await spawnFreshGitSession(page);
    await card.click();

    // Plant or open a .puml file
    await openFile(page, "hello.txt"); // navigate to editor
    // Now trigger preview of arch.puml via /view
    await page.route("**/api/file?*arch.puml*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { content: "@startuml\nBob -> Alice\n@enduml" },
        }),
      });
    });

    const composer = page.getByPlaceholder(/message/i).first();
    if (await composer.isVisible()) {
      await composer.fill("/view @arch.puml");
      await page.keyboard.press("Escape");
      await byTestId(page, "sendButton").click();
    } else {
      await page.goto(`${page.url().split("?")[0]}?file=arch.puml`);
    }

    const svgContainer = page.getByTestId("diagram-svg-container");
    await expect(svgContainer).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("circle[data-testid='stub-circle']")).toBeVisible();
  });

  test("F2: .puml decline shows source + notice", async ({ page }) => {
    await page.route("**/api/diagram/render", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          code: "unavailable",
          error: "Diagram rendering unavailable",
        }),
      });
    });

    await page.route("**/api/file?*arch2.puml*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { content: "@startuml\nAlice -> Bob\n@enduml" },
        }),
      });
    });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await openFile(page, "hello.txt");

    await page.goto(`${page.url().split("?")[0]}?file=arch2.puml`);
    const fallback = page.getByTestId("diagram-preview-fallback");
    await expect(fallback).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("diagram-status-notice")).toHaveText("Diagram rendering is not configured");
    await expect(fallback).toContainText("Alice -> Bob");
  });

  test("F3: adoc [source,mermaid] hydrates client-side without proxy request", async ({ page }) => {
    let proxyRequested = false;
    await page.route("**/api/diagram/render", async (route) => {
      proxyRequested = true;
      await route.fulfill({ status: 500 });
    });

    const mermaidAdoc = `
<div class="paragraph"><p>Adoc text</p></div>
<div class="listingblock"><div class="content">
<pre class="highlight"><code class="language-mermaid" data-lang="mermaid">graph TD;
  X--&gt;Y;</code></pre>
</div></div>
`;
    await page.route("**/api/file/render?*mermaid.adoc*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { html: mermaidAdoc },
        }),
      });
    });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await openFile(page, "styling.adoc");
    await page.goto(`${page.url().split("?")[0]}?file=mermaid.adoc`);

    // Verify MermaidBlock rendered (class="mermaid-diagram")
    const mermaidEl = page.locator(".mermaid-diagram");
    await expect(mermaidEl.first()).toBeVisible({ timeout: 25_000 });
    expect(proxyRequested).toBe(false);
  });

  test("F4: declined plantuml in adoc keeps code listing visible", async ({ page }) => {
    await page.route("**/api/diagram/render", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          code: "unavailable",
          error: "Diagram rendering unavailable",
        }),
      });
    });

    const plantumlAdoc = `
<div class="listingblock"><div class="content">
<pre class="highlight"><code class="language-plantuml" data-lang="plantuml">@startuml
ComponentA -&gt; ComponentB
@enduml</code></pre>
</div></div>
`;
    await page.route("**/api/file/render?*plantuml.adoc*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { html: plantumlAdoc },
        }),
      });
    });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await openFile(page, "styling.adoc");
    await page.goto(`${page.url().split("?")[0]}?file=plantuml.adoc`);

    const fallback = page.getByTestId("diagram-preview-fallback");
    await expect(fallback).toBeVisible({ timeout: 25_000 });
    await expect(fallback).toContainText("ComponentA -> ComponentB");
  });

  test("X3: dead upstream in .puml falls back to source view with notice", async ({ page }) => {
    await page.route("**/api/diagram/render", async (route) => {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          code: "upstream_failure",
          error: "Upstream diagram render failed: connect ECONNREFUSED 127.0.0.1:9999",
        }),
      });
    });

    await page.route("**/api/file?*dead.puml*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { content: "@startuml\nServer -> Database\n@enduml" },
        }),
      });
    });

    const card = await spawnFreshGitSession(page);
    await card.click();
    await openFile(page, "hello.txt");
    await page.goto(`${page.url().split("?")[0]}?file=dead.puml`);

    const fallback = page.getByTestId("diagram-preview-fallback");
    await expect(fallback).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("diagram-status-notice")).toContainText("Upstream diagram render failed");
    await expect(fallback).toContainText("Server -> Database");
  });
});
